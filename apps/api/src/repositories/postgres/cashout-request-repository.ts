import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { withTransaction } from "../../db/transactions.js";
import type { Clock } from "../../domain/session-service.js";
import {
  deriveCashoutIdempotencyKey,
  type CashoutCommitInput,
  type CashoutCommitResult,
  type CashoutRequestRepository,
  type CashoutRequestStatus
} from "../../domain/cashout-request-service.js";
import { ApiHttpError } from "../../middleware/error-handler.js";

interface CashoutRow {
  id: string;
  player_id: string;
  tevi_subject: string;
  amount: string;
  wallet_transaction_id: string;
  idempotency_key: string;
  payload_fingerprint: string;
  status: CashoutRequestStatus;
}

interface WalletBalanceRow {
  balance: string;
}

const starterBalance = 1000;

export class PostgresCashoutRequestRepository implements CashoutRequestRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly clock: Clock = { now: () => new Date() }
  ) {}

  public async findByRequestId(requestId: string): Promise<CashoutCommitResult | null> {
    const result = await this.pool.query<CashoutRow & { balance_after: string }>(
      `SELECT cr.id, cr.player_id, cr.tevi_subject, cr.amount, cr.wallet_transaction_id,
              cr.idempotency_key, cr.payload_fingerprint, cr.status, wt.balance_after
       FROM cashout_requests cr
       JOIN wallet_transactions wt ON wt.id = cr.wallet_transaction_id
       WHERE cr.request_id = $1
       ORDER BY cr.created_at DESC, cr.id DESC
       LIMIT 1`,
      [requestId]
    );
    const row = result.rows[0];
    return row ? rowToCommitResult(row, false) : null;
  }

  public async findByIdempotencyKey(idempotencyKey: string): Promise<CashoutCommitResult | null> {
    const result = await this.pool.query<CashoutRow & { balance_after: string }>(
      `SELECT cr.id, cr.player_id, cr.tevi_subject, cr.amount, cr.wallet_transaction_id,
              cr.idempotency_key, cr.payload_fingerprint, cr.status, wt.balance_after
       FROM cashout_requests cr
       JOIN wallet_transactions wt ON wt.id = cr.wallet_transaction_id
       WHERE cr.idempotency_key = $1`,
      [idempotencyKey]
    );
    const row = result.rows[0];
    return row ? rowToCommitResult(row, false) : null;
  }

  public async commitCashoutDebit(input: CashoutCommitInput): Promise<CashoutCommitResult> {
    return withTransaction(this.pool, async (client) => {
      const existing = await client.query<CashoutRow & { balance_after: string }>(
        `SELECT cr.id, cr.player_id, cr.tevi_subject, cr.amount, cr.wallet_transaction_id,
                cr.idempotency_key, cr.payload_fingerprint, cr.status, wt.balance_after
         FROM cashout_requests cr
         JOIN wallet_transactions wt ON wt.id = cr.wallet_transaction_id
         WHERE cr.request_id = $1
         FOR UPDATE`,
        [input.requestId]
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        return rowToCommitResult(existingRow, true);
      }

      const cashoutRequestId = `cashout_${randomUUID()}`;
      const idempotencyKey = deriveCashoutIdempotencyKey(cashoutRequestId);
      const now = input.createdAt;

      await client.query(
        `INSERT INTO wallets (player_id, balance, created_at, updated_at)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT (player_id) DO NOTHING`,
        [input.playerId, starterBalance, now]
      );

      const walletResult = await client.query<WalletBalanceRow>(
        `SELECT balance FROM wallets WHERE player_id = $1 FOR UPDATE`,
        [input.playerId]
      );
      const walletRow = walletResult.rows[0];
      if (!walletRow) {
        throw new ApiHttpError(404, {
          code: "PLAYER_NOT_FOUND",
          message: "Player wallet could not be found.",
          details: { playerId: input.playerId }
        });
      }

      const balanceBefore = parseSafeInteger(walletRow.balance);
      if (balanceBefore < input.amount) {
        const error = new ApiHttpError(409, {
          code: "INSUFFICIENT_BALANCE",
          message: "Cashout amount exceeds withdrawable balance.",
          details: { playerId: input.playerId, balance: balanceBefore, amount: input.amount }
        });
        throw error;
      }

      const balanceAfter = balanceBefore - input.amount;
      const walletTransactionId = `txn_${randomUUID()}`;

      await client.query(
        `UPDATE wallets SET balance = $2, updated_at = $3 WHERE player_id = $1`,
        [input.playerId, balanceAfter, now]
      );
      await client.query(
        `INSERT INTO wallet_transactions (
           id, player_id, transaction_type, amount, balance_before, balance_after,
           actor, source, correlation_id, spin_id, metadata_json, created_at
         ) VALUES ($1, $2, 'debit', $3, $4, $5, $6, $7, $8, NULL, $9, $10)`,
        [
          walletTransactionId,
          input.playerId,
          input.amount,
          balanceBefore,
          balanceAfter,
          "cashout-request",
          "tevi_cashout",
          input.requestId,
          JSON.stringify({ cashoutRequestId, teviSubject: input.teviSubject }),
          now
        ]
      );
      await client.query(
        `INSERT INTO cashout_requests (
           id, player_id, tevi_subject, amount, wallet_transaction_id, idempotency_key,
           payload_fingerprint, status, dispatch_attempt_count, failure_reason,
           provider_status_code, provider_metadata_json, request_id, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 0, NULL, NULL, '{}'::jsonb, $8, $9, $9)`,
        [
          cashoutRequestId,
          input.playerId,
          input.teviSubject,
          input.amount,
          walletTransactionId,
          idempotencyKey,
          input.payloadFingerprint,
          input.requestId,
          now
        ]
      );

      return {
        cashoutRequestId,
        walletTransactionId,
        balanceAfter,
        status: "pending",
        idempotencyKey,
        payloadFingerprint: input.payloadFingerprint,
        alreadyExists: false
      };
    });
  }

  public async recordDispatchOutcome(
    cashoutRequestId: string,
    outcome: {
      status: CashoutRequestStatus;
      failureReason: string | null;
      providerStatusCode: number | null;
      providerMetadata: Record<string, unknown>;
      dispatchedAt: Date | null;
    }
  ): Promise<void> {
    const now = this.clock.now();
    await this.pool.query(
      `UPDATE cashout_requests
       SET status = $2,
           dispatch_attempt_count = dispatch_attempt_count + 1,
           failure_reason = $3,
           provider_status_code = $4,
           provider_metadata_json = $5,
           updated_at = $6,
           dispatched_at = COALESCE($7, dispatched_at)
       WHERE id = $1`,
      [
        cashoutRequestId,
        outcome.status,
        outcome.failureReason,
        outcome.providerStatusCode,
        JSON.stringify(outcome.providerMetadata),
        now,
        outcome.dispatchedAt
      ]
    );
  }
}

function rowToCommitResult(
  row: CashoutRow & { balance_after: string },
  alreadyExists: boolean
): CashoutCommitResult {
  return {
    cashoutRequestId: row.id,
    walletTransactionId: row.wallet_transaction_id,
    balanceAfter: parseSafeInteger(row.balance_after),
    status: row.status,
    idempotencyKey: row.idempotency_key,
    payloadFingerprint: row.payload_fingerprint,
    alreadyExists
  };
}

function parseSafeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Unsafe integer value read from PostgreSQL.");
  }
  return parsed;
}
