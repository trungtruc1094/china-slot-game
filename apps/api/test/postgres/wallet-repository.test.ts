import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/pool.js";
import { MigrationRunner } from "../../src/db/migrations.js";
import { PostgresWalletRepository } from "../../src/repositories/postgres/wallet-repository.js";
import type { Clock } from "../../src/domain/session-service.js";
import type { WalletTransactionType } from "../../src/domain/wallet-service.js";
import type { ApiEnvelope } from "../../src/schemas/api-envelope.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;
let pool: ReturnType<typeof createPostgresPool> | undefined;

class MutableClock implements Clock {
  public current = new Date("2026-06-21T08:00:00.000Z");

  public now(): Date {
    return this.current;
  }
}

beforeEach(async () => {
  if (!testDatabaseUrl) {
    return;
  }

  assertSafeTestDatabaseUrl(testDatabaseUrl);
  pool = createPostgresPool(testDatabaseUrl);
  await resetPublicSchema();
  await new MigrationRunner({ pool }).migrateUp();
});

afterEach(async () => {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
});

describePostgres("PostgresWalletRepository", () => {
  it("persists debits, credits, reward awards, adjustments, and callback metadata", async () => {
    const clock = new MutableClock();
    const repository = new PostgresWalletRepository(requirePool(), clock);
    await createPlayer("player-wallet");

    const debit = await repository.applyTransaction({
      playerId: "player-wallet",
      type: "debit",
      amount: 250,
      actor: "spin-service",
      source: "sess-wallet",
      correlationId: "req-wallet-1",
      metadata: { clientSpinId: "client-spin-1", correlationId: "req-wallet-1" }
    });
    const credit = await repository.applyTransaction({
      playerId: "player-wallet",
      type: "credit",
      amount: 125,
      actor: "spin-service",
      source: "sess-wallet",
      metadata: { clientSpinId: "client-spin-1" }
    });
    const awardTypes: WalletTransactionType[] = ["free_spin_award", "jackpot_award", "adjustment"];
    for (const [index, type] of awardTypes.entries()) {
      await repository.applyTransaction({
        playerId: "player-wallet",
        type,
        amount: 10 + index,
        actor: "reward-service",
        source: `reward:${type}`,
        metadata: { rewardModel: "mvp_non_cash" }
      });
    }
    const batch = await repository.applyTransactionBatch([
      {
        playerId: "player-wallet",
        type: "debit",
        amount: 5,
        actor: "spin-service",
        source: "sess-wallet",
        metadata: { clientSpinId: "client-spin-2" }
      },
      {
        playerId: "player-wallet",
        type: "credit",
        amount: 15,
        actor: "spin-service",
        source: "sess-wallet",
        metadata: { clientSpinId: "client-spin-2" }
      }
    ], {
      afterBalanceCommit: (result) => {
        for (const transaction of result.transactions) {
          transaction.metadata = { ...transaction.metadata, spinId: "spin_persisted", correlationId: "req-wallet-2" };
        }
      }
    });

    const transactions = await repository.getTransactions("player-wallet");

    expect(debit.wallet).toEqual({ playerId: "player-wallet", balance: 750 });
    expect(debit.transaction).toMatchObject({
      type: "debit",
      amount: 250,
      balanceBefore: 1000,
      balanceAfter: 750,
      correlationId: "req-wallet-1"
    });
    expect(credit.transaction).toMatchObject({ type: "credit", balanceBefore: 750, balanceAfter: 875 });
    expect(batch.wallet.balance).toBe(918);
    expect(transactions).toHaveLength(7);
    expect(transactions.map((transaction) => transaction.type)).toEqual([
      "debit",
      "credit",
      "free_spin_award",
      "jackpot_award",
      "adjustment",
      "debit",
      "credit"
    ]);
    expect(transactions.slice(-2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ metadata: expect.objectContaining({ spinId: "spin_persisted" }), correlationId: "req-wallet-2" })
    ]));
    expect(await repository.getWallet("player-wallet")).toEqual({ playerId: "player-wallet", balance: 918 });
  });

  it("creates wallets idempotently and serializes concurrent updates", async () => {
    const repository = new PostgresWalletRepository(requirePool(), new MutableClock());
    await createPlayer("player-concurrent");

    const firstUseResults = await Promise.all([
      repository.getWallet("player-concurrent"),
      repository.getWallet("player-concurrent"),
      repository.getWallet("player-concurrent")
    ]);
    const updateResults = await Promise.allSettled([
      repository.applyTransaction({ playerId: "player-concurrent", type: "debit", amount: 700, actor: "spin-service", source: "sess-1" }),
      repository.applyTransaction({ playerId: "player-concurrent", type: "debit", amount: 700, actor: "spin-service", source: "sess-2" }),
      repository.applyTransaction({ playerId: "player-concurrent", type: "credit", amount: 100, actor: "reward-service", source: "reward" })
    ]);
    const walletCount = await requirePool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM wallets WHERE player_id = 'player-concurrent'`
    );

    expect(firstUseResults).toEqual([
      { playerId: "player-concurrent", balance: 1000 },
      { playerId: "player-concurrent", balance: 1000 },
      { playerId: "player-concurrent", balance: 1000 }
    ]);
    expect(walletCount.rows[0]?.count).toBe("1");
    expect(updateResults.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(updateResults.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await repository.getWallet("player-concurrent")).toEqual({ playerId: "player-concurrent", balance: 400 });
    expect(await repository.getTransactions("player-concurrent")).toHaveLength(2);
  });

  it("rolls back insufficient balances, unsafe integer results, and injected failures", async () => {
    const repository = new PostgresWalletRepository(requirePool(), new MutableClock(), {
      failAfterBalanceUpdate: (request) => request.source === "inject-failure"
    });
    await createPlayer("player-rollback");

    await expect(repository.applyTransaction({
      playerId: "player-rollback",
      type: "debit",
      amount: 1001,
      actor: "spin-service",
      source: "sess-rollback"
    })).rejects.toMatchObject({ statusCode: 409, apiError: { code: "INSUFFICIENT_BALANCE" } });
    await expect(repository.applyTransaction({
      playerId: "player-rollback",
      type: "credit",
      amount: Number.MAX_SAFE_INTEGER,
      actor: "admin",
      source: "manual-adjustment"
    })).rejects.toMatchObject({ statusCode: 400, apiError: { code: "INVALID_BALANCE_RESULT" } });
    await expect(repository.applyTransaction({
      playerId: "player-rollback",
      type: "debit",
      amount: 100,
      actor: "spin-service",
      source: "inject-failure"
    })).rejects.toMatchObject({ statusCode: 500, apiError: { code: "WALLET_TRANSACTION_FAILED" } });

    expect(await repository.getWallet("player-rollback")).toEqual({ playerId: "player-rollback", balance: 1000 });
    expect(await repository.getTransactions("player-rollback")).toEqual([]);
  });

  it("rolls back the whole batch when a later transaction fails", async () => {
    const repository = new PostgresWalletRepository(requirePool(), new MutableClock(), {
      failAfterBalanceUpdate: (request) => request.source === "batch-failure-second"
    });
    await createPlayer("player-batch-rollback");

    await expect(repository.applyTransactionBatch([
      { playerId: "player-batch-rollback", type: "debit", amount: 100, actor: "spin-service", source: "batch-first" },
      { playerId: "player-batch-rollback", type: "credit", amount: 50, actor: "spin-service", source: "batch-failure-second" },
      { playerId: "player-batch-rollback", type: "credit", amount: 10, actor: "spin-service", source: "batch-third" }
    ])).rejects.toMatchObject({ statusCode: 500, apiError: { code: "WALLET_TRANSACTION_FAILED" } });

    expect(await repository.getWallet("player-batch-rollback")).toEqual({ playerId: "player-batch-rollback", balance: 1000 });
    expect(await repository.getTransactions("player-batch-rollback")).toEqual([]);
  });

  it("recovers balances and searchable transactions after repository reconstruction", async () => {
    const clock = new MutableClock();
    const firstRepository = new PostgresWalletRepository(requirePool(), clock);
    await createPlayer("player-restart");
    await firstRepository.applyTransaction({
      playerId: "player-restart",
      type: "debit",
      amount: 125,
      actor: "spin-service",
      source: "sess-restart",
      metadata: { spinId: "spin_restart", clientSpinId: "client-restart" }
    });

    const secondRepository = new PostgresWalletRepository(requirePool(), clock);
    const transactions = await secondRepository.listTransactions();

    expect(await secondRepository.getWallet("player-restart")).toEqual({ playerId: "player-restart", balance: 875 });
    expect(transactions).toEqual([
      expect.objectContaining({
        playerId: "player-restart",
        type: "debit",
        source: "sess-restart",
        metadata: { spinId: "spin_restart", clientSpinId: "client-restart" }
      })
    ]);
  });

  it("backs existing admin balance transaction search with PostgreSQL persistence", async () => {
    const clock = new MutableClock();
    const repository = new PostgresWalletRepository(requirePool(), clock);
    await createPlayer("player-admin-search");
    await repository.applyTransaction({
      playerId: "player-admin-search",
      type: "debit",
      amount: 25,
      actor: "spin-service",
      source: "sess-admin",
      metadata: { spinId: "spin_admin_1", clientSpinId: "client-admin-1" }
    });
    clock.current = new Date("2026-06-21T08:05:00.000Z");
    const credit = await repository.applyTransaction({
      playerId: "player-admin-search",
      type: "credit",
      amount: 50,
      actor: "spin-service",
      source: "sess-admin",
      correlationId: "req-admin-search",
      metadata: { spinId: "spin_admin_2", clientSpinId: "client-admin-2", providerSubject: "hidden" }
    });
    const server = createServer(createApp({ clock, walletService: repository }));
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(
        `${baseUrl}/api/admin/balance-transactions?playerId=player-admin-search&sessionId=sess-admin&spinId=spin_admin_2&transactionType=credit&from=2026-06-21T08:00:00.000Z&to=2026-06-21T08:10:00.000Z&limit=1`,
        { headers: adminHeaders() }
      );
      const body = await response.json() as ApiEnvelope<{
        rewardModel: Record<string, unknown>;
        records: Array<Record<string, unknown>>;
        page: Record<string, unknown>;
      }>;

      expect(response.status).toBe(200);
      expect(body.data?.page).toEqual({ limit: 1, offset: 0, total: 1, hasMore: false });
      expect(body.data?.rewardModel).toMatchObject({ unit: "points", cashEquivalent: false, redemptionEnabled: false });
      expect(body.data?.records).toEqual([
        expect.objectContaining({
          transactionId: credit.transaction.transactionId,
          playerId: "player-admin-search",
          transactionType: "credit",
          amount: 50,
          balanceBefore: 975,
          balanceAfter: 1025,
          correlationId: "req-admin-search",
          sessionId: "sess-admin",
          spinId: "spin_admin_2",
          metadata: { spinId: "spin_admin_2", clientSpinId: "client-admin-2" }
        })
      ]);
      expect(body.data?.records[0]).not.toHaveProperty("providerSubject");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("preserves wallet history by restricting player deletes", async () => {
    const repository = new PostgresWalletRepository(requirePool(), new MutableClock());
    await createPlayer("player-fk-wallet");
    await repository.applyTransaction({
      playerId: "player-fk-wallet",
      type: "credit",
      amount: 1,
      actor: "reward-service",
      source: "reward"
    });

    await expect(requirePool().query("DELETE FROM players WHERE id = $1", ["player-fk-wallet"]))
      .rejects
      .toMatchObject({ code: "23001" });
  });
});

async function createPlayer(playerId: string): Promise<void> {
  await requirePool().query(
    `INSERT INTO players (id, display_name, created_at, updated_at)
     VALUES ($1, $2, '2026-06-21T08:00:00.000Z', '2026-06-21T08:00:00.000Z')`,
    [playerId, playerId]
  );
}

async function resetPublicSchema(): Promise<void> {
  await requirePool().query("DROP SCHEMA public CASCADE");
  await requirePool().query("CREATE SCHEMA public");
}

function requirePool(): ReturnType<typeof createPostgresPool> {
  if (!pool) {
    throw new Error("PostgreSQL test pool was not initialized.");
  }

  return pool;
}

function assertSafeTestDatabaseUrl(databaseUrl: string): void {
  const parsedUrl = new URL(databaseUrl);
  const databaseName = parsedUrl.pathname.replace(/^\//, "");

  if (databaseName !== "china_slot_test" && !databaseName.endsWith("_test") && !databaseName.startsWith("test_")) {
    throw new Error("PostgreSQL integration tests require a dedicated test database name ending with _test or starting with test_.");
  }
}

function adminHeaders(role = "support", actor = "support-1"): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-admin-role": role,
    "x-admin-actor": actor,
    "x-request-id": "req_postgres_wallet_repository_test"
  };
}