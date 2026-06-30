import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../../db/transactions.js";
import type { Clock } from "../../domain/session-service.js";
import type {
  TeviWebhookCreditInput,
  TeviWebhookCreditPort,
  TeviWebhookCreditResult
} from "../../domain/tevi-webhook-service.js";
import { teviProviderName } from "../../domain/tevi-webhook-service.js";
import { ApiHttpError } from "../../middleware/error-handler.js";

// Matches PostgresWalletRepository's wallet bootstrap balance so the webhook credit path is consistent with
// the rest of the system. The per-top-up credit transaction records exactly the credited amount regardless.
const starterBalance = 1000;

interface IdempotencyLockRow {
  status: string;
}

interface WalletBalanceRow {
  balance: string;
}

export class PostgresTeviWebhookCreditRepository implements TeviWebhookCreditPort {
  public constructor(
    private readonly pool: Pool,
    private readonly clock: Clock = { now: () => new Date() }
  ) {}

  // Single transaction (AC3): lock the idempotency row, then either preserve a prior completion (AC4) or
  // lock the wallet, insert the credit transaction, update the balance, and mark the record completed — all
  // committed together so a failure in any step rolls back the credit, the transaction row, and the completion.
  public async creditTopupAtomically(input: TeviWebhookCreditInput): Promise<TeviWebhookCreditResult> {
    return withTransaction(this.pool, async (client) => {
      const now = this.clock.now();

      const lockResult = await client.query<IdempotencyLockRow>(
        `SELECT status FROM provider_top_up_idempotency_records
         WHERE provider_name = $1 AND provider_event_id = $2
         FOR UPDATE`,
        [teviProviderName, input.providerEventId]
      );
      const lockedRow = lockResult.rows[0];
      if (!lockedRow) {
        throw new ApiHttpError(500, {
          code: "TEVI_WEBHOOK_IDEMPOTENCY_RECORD_MISSING",
          message: "Top-up idempotency record disappeared before crediting.",
          details: { providerEventId: input.providerEventId }
        });
      }

      if (lockedRow.status === "completed") {
        return { credited: false, alreadyCompleted: true, balanceAfter: await readBalance(client, input.playerId), transactionId: null };
      }
      if (lockedRow.status !== "pending") {
        // Terminal non-credit state (failed/ignored/duplicate): never credit.
        return { credited: false, alreadyCompleted: false, balanceAfter: await readBalance(client, input.playerId), transactionId: null };
      }

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
          message: "Player wallet could not be created because the player does not exist.",
          details: { playerId: input.playerId }
        });
      }

      const balanceBefore = parseSafeInteger(walletRow.balance);
      const balanceAfter = balanceBefore + input.amount;
      if (!Number.isSafeInteger(balanceAfter)) {
        throw new ApiHttpError(400, {
          code: "INVALID_BALANCE_RESULT",
          message: "Wallet credit would produce an unsafe integer balance.",
          details: { playerId: input.playerId }
        });
      }

      const transactionId = `txn_${randomUUID()}`;
      await client.query(
        `UPDATE wallets SET balance = $2, updated_at = $3 WHERE player_id = $1`,
        [input.playerId, balanceAfter, now]
      );
      await client.query(
        `INSERT INTO wallet_transactions (
           id, player_id, transaction_type, amount, balance_before, balance_after,
           actor, source, correlation_id, spin_id, metadata_json, created_at
         ) VALUES ($1, $2, 'credit', $3, $4, $5, $6, $7, $8, NULL, $9, $10)`,
        [
          transactionId,
          input.playerId,
          input.amount,
          balanceBefore,
          balanceAfter,
          "tevi-webhook",
          "tevi_topup",
          input.correlationId,
          // Safe correlation only — no raw provider payload, no secrets/signatures.
          JSON.stringify({ providerEventId: input.providerEventId, correlationId: input.correlationId }),
          now
        ]
      );
      await client.query(
        `UPDATE provider_top_up_idempotency_records
         SET status = 'completed', completed_at = $3, last_seen_at = $3, failure_reason = NULL
         WHERE provider_name = $1 AND provider_event_id = $2`,
        [teviProviderName, input.providerEventId, now]
      );

      return { credited: true, alreadyCompleted: false, balanceAfter, transactionId };
    });
  }
}

async function readBalance(client: PoolClient, playerId: string): Promise<number> {
  const result = await client.query<WalletBalanceRow>(`SELECT balance FROM wallets WHERE player_id = $1`, [playerId]);
  const row = result.rows[0];
  return row ? parseSafeInteger(row.balance) : 0;
}

function parseSafeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Unsafe wallet balance value read from PostgreSQL.");
  }
  return parsed;
}
