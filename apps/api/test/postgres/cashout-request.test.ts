import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPostgresPool } from "../../src/db/pool.js";
import { MigrationRunner } from "../../src/db/migrations.js";
import { PostgresCashoutRequestRepository } from "../../src/repositories/postgres/cashout-request-repository.js";
import { PostgresWalletRepository } from "../../src/repositories/postgres/wallet-repository.js";
import {
  CashoutRequestService,
  fingerprintCashoutPayload
} from "../../src/domain/cashout-request-service.js";
import type { Clock } from "../../src/domain/session-service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;
let pool: ReturnType<typeof createPostgresPool> | undefined;

class MutableClock implements Clock {
  public current = new Date("2026-06-29T00:00:00.000Z");

  public now(): Date {
    return this.current;
  }
}

beforeEach(async () => {
  if (!testDatabaseUrl) return;
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

describePostgres("PostgresCashoutRequestRepository", () => {
  it("atomically debits wallet and creates one cashout row per request", async () => {
    const clock = new MutableClock();
    const repository = new PostgresCashoutRequestRepository(requirePool(), clock);
    const walletRepository = new PostgresWalletRepository(requirePool(), clock);
    await createPlayer("player-cashout");
    await walletRepository.applyTransaction({
      playerId: "player-cashout",
      type: "credit",
      amount: 500,
      actor: "test",
      source: "test_setup"
    });

    const fingerprint = fingerprintCashoutPayload("tevi-user-1", 100);
    const committed = await repository.commitCashoutDebit({
      playerId: "player-cashout",
      teviSubject: "tevi-user-1",
      amount: 100,
      requestId: "req_pg_cashout_1",
      payloadFingerprint: fingerprint,
      createdAt: clock.now()
    });

    expect(committed.balanceAfter).toBe(1400);
    expect(committed.alreadyExists).toBe(false);

    const replay = await repository.commitCashoutDebit({
      playerId: "player-cashout",
      teviSubject: "tevi-user-1",
      amount: 100,
      requestId: "req_pg_cashout_1",
      payloadFingerprint: fingerprint,
      createdAt: clock.now()
    });
    expect(replay.alreadyExists).toBe(true);
    expect(replay.cashoutRequestId).toBe(committed.cashoutRequestId);

    const cashoutRows = await requirePool().query(`SELECT count(*)::int AS count FROM cashout_requests`);
    expect(cashoutRows.rows[0]?.count).toBe(1);

    const wallet = await walletRepository.getWallet("player-cashout");
    expect(wallet.balance).toBe(1400);
  });

  it("rejects insufficient balance without cashout or wallet mutation", async () => {
    const clock = new MutableClock();
    const repository = new PostgresCashoutRequestRepository(requirePool(), clock);
    await createPlayer("player-poor");

    await expect(repository.commitCashoutDebit({
      playerId: "player-poor",
      teviSubject: "tevi-user-2",
      amount: 2000,
      requestId: "req_pg_cashout_2",
      payloadFingerprint: fingerprintCashoutPayload("tevi-user-2", 2000),
      createdAt: clock.now()
    })).rejects.toMatchObject({
      apiError: { code: "INSUFFICIENT_BALANCE" }
    });

    const cashoutRows = await requirePool().query(`SELECT count(*)::int AS count FROM cashout_requests`);
    expect(cashoutRows.rows[0]?.count).toBe(0);
  });
});

describePostgres("CashoutRequestService with Postgres", () => {
  it("dispatches after commit and records dispatched status", async () => {
    const clock = new MutableClock();
    const repository = new PostgresCashoutRequestRepository(requirePool(), clock);
    const walletRepository = new PostgresWalletRepository(requirePool(), clock);
    await createPlayer("player-dispatch");
    await walletRepository.applyTransaction({
      playerId: "player-dispatch",
      type: "credit",
      amount: 300,
      actor: "test",
      source: "test_setup"
    });

    const dispatch = vi.fn(async () => ({ ok: true as const }));
    const service = new CashoutRequestService(repository, { dispatchCashout: dispatch });

    const result = await service.requestCashout({
      playerId: "player-dispatch",
      teviAuth: {
        provider: "tevi",
        subject: "tevi-user-3",
        displayName: "Player",
        expiresAt: "2026-12-31T00:00:00.000Z"
      },
      amount: 50,
      requestId: "req_pg_service_1"
    });

    expect(result).toMatchObject({ ok: true, status: "dispatched", balanceAfter: 1250 });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

function requirePool() {
  if (!pool) throw new Error("PostgreSQL pool is not initialized.");
  return pool;
}

async function resetPublicSchema(): Promise<void> {
  await requirePool().query(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO public;
  `);
}

function assertSafeTestDatabaseUrl(databaseUrl: string): void {
  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (!/(test|local|dev)/i.test(databaseName)) {
    throw new Error(`Refusing to run destructive PostgreSQL tests against database "${databaseName}".`);
  }
}

async function createPlayer(playerId: string): Promise<void> {
  const now = new Date("2026-06-29T00:00:00.000Z");
  await requirePool().query(
    `INSERT INTO players (id, display_name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
    [playerId, playerId, now]
  );
}
