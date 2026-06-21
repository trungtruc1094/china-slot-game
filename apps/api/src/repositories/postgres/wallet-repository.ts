import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../../db/transactions.js";
import type { Clock } from "../../domain/session-service.js";
import {
  type Wallet,
  type WalletOperations,
  type WalletTransactionBatchCommitOptions,
  type WalletTransactionBatchResult,
  type WalletTransactionRecord,
  type WalletTransactionRequest,
  type WalletTransactionSearchFilters,
  type WalletTransactionSearchResult,
  type WalletTransactionResult,
  type WalletServiceTestHooks,
  type WalletTransactionType
} from "../../domain/wallet-service.js";
import { ApiHttpError } from "../../middleware/error-handler.js";

interface WalletRow {
  player_id: string;
  balance: string;
}

interface WalletTransactionRow {
  id: string;
  player_id: string;
  transaction_type: WalletTransactionType;
  amount: string;
  balance_before: string;
  balance_after: string;
  actor: string;
  source: string;
  correlation_id: string | null;
  spin_id: string | null;
  metadata_json: Record<string, unknown>;
  created_at: Date;
}

const starterBalance = 1000;

export class PostgresWalletRepository implements WalletOperations {
  public constructor(
    private readonly pool: Pool,
    private readonly clock: Clock = { now: () => new Date() },
    private readonly testHooks: WalletServiceTestHooks = {}
  ) {}

  public async getWallet(playerId: string): Promise<Wallet> {
    return withTransaction(this.pool, async (client) => this.getOrCreateWallet(client, playerId, true));
  }

  public async getTransactions(playerId: string): Promise<WalletTransactionRecord[]> {
    const result = await this.pool.query<WalletTransactionRow>(
      `SELECT id, player_id, transaction_type, amount, balance_before, balance_after, actor, source, correlation_id, spin_id, metadata_json, created_at
       FROM wallet_transactions
       WHERE player_id = $1
      ORDER BY sequence_number`,
      [playerId]
    );

    return result.rows.map(rowToTransaction);
  }

  public async listTransactions(): Promise<WalletTransactionRecord[]> {
    const result = await this.pool.query<WalletTransactionRow>(
      `SELECT id, player_id, transaction_type, amount, balance_before, balance_after, actor, source, correlation_id, spin_id, metadata_json, created_at
       FROM wallet_transactions
      ORDER BY sequence_number`
    );

    return result.rows.map(rowToTransaction);
  }

  public async searchTransactions(filters: WalletTransactionSearchFilters): Promise<WalletTransactionSearchResult> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.playerId) {
      values.push(filters.playerId);
      conditions.push(`player_id = $${values.length}`);
    }
    if (filters.type) {
      values.push(filters.type);
      conditions.push(`transaction_type = $${values.length}`);
    }
    if (filters.source) {
      values.push(filters.source);
      conditions.push(`source = $${values.length}`);
    }
    if (filters.spinId) {
      values.push(filters.spinId);
      conditions.push(`spin_id = $${values.length}`);
    }
    if (filters.createdFrom) {
      values.push(filters.createdFrom);
      conditions.push(`created_at >= $${values.length}`);
    }
    if (filters.createdTo) {
      values.push(filters.createdTo);
      conditions.push(`created_at <= $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countResult = await this.pool.query<{ total_count: string }>(
      `SELECT count(*)::text AS total_count
       FROM wallet_transactions
       ${whereClause}`,
      values
    );
    values.push(filters.limit, filters.offset);
    const limitParameter = values.length - 1;
    const offsetParameter = values.length;
    const result = await this.pool.query<WalletTransactionRow>(
      `SELECT id, player_id, transaction_type, amount, balance_before, balance_after, actor, source, correlation_id, spin_id, metadata_json, created_at
       FROM wallet_transactions
       ${whereClause}
       ORDER BY created_at DESC, sequence_number DESC
       LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
      values
    );

    return {
      records: result.rows.map(rowToTransaction),
      total: Number(countResult.rows[0]?.total_count ?? "0")
    };
  }

  public async applyTransaction(request: WalletTransactionRequest): Promise<WalletTransactionResult> {
    const result = await this.applyTransactionBatch([request]);
    const transaction = result.transactions[0];

    if (!transaction) {
      throw new ApiHttpError(500, {
        code: "WALLET_TRANSACTION_FAILED",
        message: "Wallet transaction could not be committed.",
        details: {}
      });
    }

    return { wallet: result.wallet, transaction };
  }

  public async applyTransactionBatch(
    requests: WalletTransactionRequest[],
    commitOptions: WalletTransactionBatchCommitOptions = {}
  ): Promise<WalletTransactionBatchResult> {
    const firstRequest = requests[0];

    if (!firstRequest || requests.some((request) => request.playerId !== firstRequest.playerId)) {
      throw new ApiHttpError(400, {
        code: "INVALID_WALLET_BATCH",
        message: "Wallet transaction batch must target one player.",
        details: {}
      });
    }

    return withTransaction(this.pool, async (client) => {
      for (const request of requests) {
        this.validateRequest(request);
      }

      const wallet = await this.getOrCreateWallet(client, firstRequest.playerId, true);
      let balance = wallet.balance;
      const transactions: WalletTransactionRecord[] = [];

      for (const request of requests) {
        const balanceBefore = balance;
        const balanceAfter = this.calculateBalanceAfter(balance, request);
        await client.query(
          `UPDATE wallets SET balance = $2, updated_at = $3 WHERE player_id = $1`,
          [request.playerId, balanceAfter, this.clock.now()]
        );
        balance = balanceAfter;

        if (this.testHooks.failAfterBalanceUpdate?.(request) === true) {
          throw new ApiHttpError(500, {
            code: "WALLET_TRANSACTION_FAILED",
            message: "Wallet transaction could not be committed.",
            details: {}
          });
        }

        const metadata = cloneMetadata(request.metadata ?? {});
        const transaction: WalletTransactionRecord = {
          transactionId: `txn_${randomUUID()}`,
          playerId: request.playerId,
          type: request.type,
          amount: request.amount,
          balanceBefore,
          balanceAfter,
          actor: request.actor,
          source: request.source,
          correlationId: request.correlationId ?? metadataCorrelationId(metadata),
          createdAt: this.clock.now().toISOString(),
          metadata
        };
        await insertTransaction(client, transaction);
        transactions.push(transaction);
      }

      const result = {
        wallet: { playerId: firstRequest.playerId, balance },
        transactions
      };
      commitOptions.afterBalanceCommit?.(result);
      await persistCallbackMetadata(client, result.transactions);
      return result;
    });
  }

  private async getOrCreateWallet(client: PoolClient, playerId: string, lock: boolean): Promise<Wallet> {
    const now = this.clock.now();
    await client.query(
      `INSERT INTO wallets (player_id, balance, created_at, updated_at)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (player_id) DO NOTHING`,
      [playerId, starterBalance, now]
    );
    const result = await client.query<WalletRow>(
      `SELECT player_id, balance FROM wallets WHERE player_id = $1 ${lock ? "FOR UPDATE" : ""}`,
      [playerId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiHttpError(404, {
        code: "PLAYER_NOT_FOUND",
        message: "Player wallet could not be created because the player does not exist.",
        details: { playerId }
      });
    }

    return rowToWallet(row);
  }

  private validateRequest(request: WalletTransactionRequest): void {
    if (!Number.isSafeInteger(request.amount) || request.amount <= 0) {
      throw new ApiHttpError(400, {
        code: "INVALID_TRANSACTION_AMOUNT",
        message: "Wallet transaction amount must be a positive integer.",
        details: { amount: request.amount }
      });
    }
  }

  private calculateBalanceAfter(balance: number, request: WalletTransactionRequest): number {
    const balanceAfter = request.type === "debit"
      ? balance - request.amount
      : balance + request.amount;

    if (!Number.isSafeInteger(balanceAfter)) {
      throw new ApiHttpError(400, {
        code: "INVALID_BALANCE_RESULT",
        message: "Wallet transaction would produce an unsafe integer balance.",
        details: {
          playerId: request.playerId,
          balance,
          amount: request.amount
        }
      });
    }

    if (balanceAfter < 0) {
      throw new ApiHttpError(409, {
        code: "INSUFFICIENT_BALANCE",
        message: "Insufficient balance for this transaction.",
        details: {
          playerId: request.playerId,
          balance,
          amount: request.amount
        }
      });
    }

    return balanceAfter;
  }
}

async function insertTransaction(client: PoolClient, transaction: WalletTransactionRecord): Promise<void> {
  await client.query(
    `INSERT INTO wallet_transactions (
       id, player_id, transaction_type, amount, balance_before, balance_after,
       actor, source, correlation_id, spin_id, metadata_json, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      transaction.transactionId,
      transaction.playerId,
      transaction.type,
      transaction.amount,
      transaction.balanceBefore,
      transaction.balanceAfter,
      transaction.actor,
      transaction.source,
      transaction.correlationId,
      metadataSpinId(transaction.metadata),
      cloneMetadata(transaction.metadata),
      transaction.createdAt
    ]
  );
}

async function persistCallbackMetadata(client: PoolClient, transactions: WalletTransactionRecord[]): Promise<void> {
  for (const transaction of transactions) {
    const correlationId = transaction.correlationId ?? metadataCorrelationId(transaction.metadata);
    const result = await client.query(
      `UPDATE wallet_transactions
       SET correlation_id = $2, spin_id = $3, metadata_json = $4
       WHERE id = $1`,
      [transaction.transactionId, correlationId, metadataSpinId(transaction.metadata), cloneMetadata(transaction.metadata)]
    );
    if (result.rowCount !== 1) {
      throw new ApiHttpError(500, {
        code: "WALLET_TRANSACTION_FAILED",
        message: "Wallet transaction metadata could not be committed.",
        details: { transactionId: transaction.transactionId }
      });
    }
    transaction.correlationId = correlationId;
  }
}

function rowToWallet(row: WalletRow): Wallet {
  return {
    playerId: row.player_id,
    balance: parseSafeInteger(row.balance, "wallet balance")
  };
}

function rowToTransaction(row: WalletTransactionRow): WalletTransactionRecord {
  return {
    transactionId: row.id,
    playerId: row.player_id,
    type: row.transaction_type,
    amount: parseSafeInteger(row.amount, "wallet transaction amount"),
    balanceBefore: parseSafeInteger(row.balance_before, "wallet transaction balance_before"),
    balanceAfter: parseSafeInteger(row.balance_after, "wallet transaction balance_after"),
    actor: row.actor,
    source: row.source,
    correlationId: row.correlation_id,
    createdAt: row.created_at.toISOString(),
    metadata: withSpinIdFallback(row.metadata_json, row.spin_id)
  };
}

function withSpinIdFallback(metadata: Record<string, unknown>, spinId: string | null): Record<string, unknown> {
  const cloned = cloneMetadata(metadata);
  if (spinId && typeof cloned.spinId !== "string") {
    cloned.spinId = spinId;
  }
  return cloned;
}

function parseSafeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Unsafe ${label} value read from PostgreSQL.`);
  }
  return parsed;
}

function cloneMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(metadata) as Record<string, unknown>;
}

function metadataCorrelationId(metadata: Record<string, unknown> | undefined): string | null {
  return typeof metadata?.correlationId === "string" ? metadata.correlationId : null;
}

function metadataSpinId(metadata: Record<string, unknown> | undefined): string | null {
  return typeof metadata?.spinId === "string" ? metadata.spinId : null;
}