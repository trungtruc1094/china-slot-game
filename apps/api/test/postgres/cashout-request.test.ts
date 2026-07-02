import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPostgresPool } from "../../src/db/pool.js";
import { MigrationRunner } from "../../src/db/migrations.js";
import { PostgresCashoutRequestRepository } from "../../src/repositories/postgres/cashout-request-repository.js";
import { PostgresWalletRepository } from "../../src/repositories/postgres/wallet-repository.js";
import {
  CashoutRequestService,
  fingerprintCashoutPayload
} from "../../src/domain/cashout-request-service.js";
import { CashoutReconciliationService } from "../../src/domain/cashout-reconciliation-service.js";
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

  it("reconciles a failed_retryable cashout row to dispatched from user_withdraw webhook input", async () => {
    const clock = new MutableClock();
    const repository = new PostgresCashoutRequestRepository(requirePool(), clock);
    const walletRepository = new PostgresWalletRepository(requirePool(), clock);
    await createPlayer("player-reconcile");
    await walletRepository.applyTransaction({
      playerId: "player-reconcile",
      type: "credit",
      amount: 2427,
      actor: "test",
      source: "test_setup"
    });

    const committed = await repository.commitCashoutDebit({
      playerId: "player-reconcile",
      teviSubject: "tevi-user-reconcile",
      amount: 2427,
      requestId: "req_pg_cashout_reconcile",
      payloadFingerprint: fingerprintCashoutPayload("tevi-user-reconcile", 2427),
      createdAt: clock.now()
    });

    await repository.recordDispatchOutcome(committed.cashoutRequestId, {
      status: "failed_retryable",
      failureReason: "PROVIDER_UNAVAILABLE",
      providerStatusCode: 400,
      providerMetadata: {},
      dispatchedAt: null
    });

    const reconciled = await repository.reconcileUserWithdraw({
      playerId: "player-reconcile",
      teviSubject: "tevi-user-reconcile",
      amount: 2427,
      providerEventId: "evt_withdraw_pg",
      correlationId: "req_webhook_pg"
    });

    expect(reconciled).toEqual({
      status: "reconciled",
      cashoutRequestId: committed.cashoutRequestId
    });

    const row = await requirePool().query<{ status: string; provider_metadata_json: Record<string, unknown> }>(
      `SELECT status, provider_metadata_json FROM cashout_requests WHERE id = $1`,
      [committed.cashoutRequestId]
    );
    expect(row.rows[0]?.status).toBe("dispatched");
    expect(row.rows[0]?.provider_metadata_json).toMatchObject({
      webhookProviderEventId: "evt_withdraw_pg",
      webhookCorrelationId: "req_webhook_pg"
    });
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

describePostgres("CashoutReconciliationService with Postgres", () => {
  it("retries failed_retryable dispatch without creating a second wallet debit", async () => {
    const clock = new MutableClock();
    const repository = new PostgresCashoutRequestRepository(requirePool(), clock);
    const walletRepository = new PostgresWalletRepository(requirePool(), clock);
    await createPlayer("player-retry");
    await walletRepository.applyTransaction({
      playerId: "player-retry",
      type: "credit",
      amount: 500,
      actor: "test",
      source: "test_setup"
    });

    const requestService = new CashoutRequestService(repository, {
      dispatchCashout: vi.fn(async () => ({
        ok: false as const,
        reasonCode: "PROVIDER_UNAVAILABLE",
        statusCode: 503
      }))
    });

    const created = await requestService.requestCashout({
      playerId: "player-retry",
      teviAuth: {
        provider: "tevi",
        subject: "tevi-user-retry",
        displayName: "Player",
        expiresAt: "2026-12-31T00:00:00.000Z"
      },
      amount: 120,
      requestId: "req_pg_retry_1"
    });
    expect(created).toMatchObject({ ok: true, status: "failed_retryable", balanceAfter: 1380 });

    const reconciliationService = new CashoutReconciliationService(repository, {
      dispatchCashout: vi.fn(async () => ({ ok: true as const }))
    });
    const retried = await reconciliationService.retryDispatch(created.ok ? created.cashoutRequestId : "", "req_admin_retry_pg");
    expect(retried).toMatchObject({ ok: true, status: "dispatched", dispatchAttemptCount: 2 });

    const wallet = await requirePool().query<{ balance: string }>(
      `SELECT balance FROM wallets WHERE player_id = $1`,
      ["player-retry"]
    );
    expect(wallet.rows[0]?.balance).toBe("1380");

    const cashoutRows = await requirePool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM cashout_requests WHERE player_id = $1`,
      ["player-retry"]
    );
    expect(cashoutRows.rows[0]?.count).toBe("1");

    const txnRows = await requirePool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM wallet_transactions WHERE player_id = $1 AND transaction_type = 'debit'`,
      ["player-retry"]
    );
    expect(txnRows.rows[0]?.count).toBe("1");
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
