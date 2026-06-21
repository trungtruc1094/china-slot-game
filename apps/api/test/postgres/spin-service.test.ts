import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculateRtpReport, runSimulation } from "@china-slot-game/game-math";
import { createPostgresPool } from "../../src/db/pool.js";
import { MigrationRunner } from "../../src/db/migrations.js";
import { SessionService, type Clock } from "../../src/domain/session-service.js";
import { InMemoryBudgetProtectionRepository } from "../../src/domain/budget-protection-repository.js";
import { InMemoryOperatorLimitsRepository } from "../../src/domain/operator-limits-repository.js";
import { PostgresPlayerSessionRepository } from "../../src/repositories/postgres/player-session-repository.js";
import { PostgresGameConfigurationRepository } from "../../src/repositories/postgres/game-configuration-repository.js";
import { PostgresSpinService } from "../../src/repositories/postgres/spin-service.js";
import { simpleConfig } from "../fixtures/simple-config.js";

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

describePostgres("PostgresSpinService", () => {
  it("persists accepted spins, wallet transaction links, and completed idempotency", async () => {
    const clock = new MutableClock();
    await prepareActiveConfig(clock);
    const session = await createSession(clock, "player-spin");
    const service = new PostgresSpinService(requirePool(), { nextRandom: () => 0 }, clock);

    const response = await service.spin({
      clientSpinId: "client-spin-accepted",
      sessionId: session.sessionId,
      wager: wager(),
      correlationId: "req-spin-accepted"
    });

    expect(response).toMatchObject({
      configVersionId: simpleConfig.versionId,
      payout: 5,
      balanceAfter: 1004,
      rewardModel: { unit: "points", cashEquivalent: false, redemptionEnabled: false }
    });
    await expect(tableCount("spins")).resolves.toBe("1");
    await expect(tableCount("wallet_transactions")).resolves.toBe("2");
    await expect(tableCount("spin_wallet_transactions")).resolves.toBe("2");
    await expect(requirePool().query<{ status: string; response_json: unknown }>(
      `SELECT status, response_json FROM spin_idempotency_keys WHERE session_id = $1 AND client_spin_id = $2`,
      [session.sessionId, "client-spin-accepted"]
    )).resolves.toMatchObject({ rows: [{ status: "completed", response_json: expect.objectContaining({ spinId: response.spinId }) }] });
    const walletTransactions = await requirePool().query<{ spin_id: string; metadata_json: Record<string, unknown> }>(
      `SELECT spin_id, metadata_json FROM wallet_transactions ORDER BY sequence_number`
    );
    expect(walletTransactions.rows).toEqual([
      { spin_id: response.spinId, metadata_json: { clientSpinId: "client-spin-accepted", correlationId: "req-spin-accepted", spinId: response.spinId } },
      { spin_id: response.spinId, metadata_json: { clientSpinId: "client-spin-accepted", correlationId: "req-spin-accepted", spinId: response.spinId } }
    ]);
  });

  it("returns committed response on duplicate retry after service reconstruction", async () => {
    const clock = new MutableClock();
    await prepareActiveConfig(clock);
    const session = await createSession(clock, "player-retry");
    const firstService = new PostgresSpinService(requirePool(), { nextRandom: () => 0 }, clock);
    const first = await firstService.spin({ clientSpinId: "client-spin-retry", sessionId: session.sessionId, wager: wager(), correlationId: "req-retry" });

    const secondService = new PostgresSpinService(requirePool(), { nextRandom: () => 0.5 }, clock);
    const second = await secondService.spin({ clientSpinId: "client-spin-retry", sessionId: session.sessionId, wager: wager(), correlationId: "req-retry-again" });

    expect(second).toEqual(first);
    await expect(tableCount("spins")).resolves.toBe("1");
    await expect(tableCount("wallet_transactions")).resolves.toBe("2");
    await expect(secondService.loadLedger()).resolves.toEqual([
      expect.objectContaining({
        spinId: first.spinId,
        sessionId: session.sessionId,
        playerId: session.playerId,
        walletTransactions: expect.arrayContaining([expect.objectContaining({ playerId: session.playerId })])
      })
    ]);
  });

  it("rejects changed-wager duplicate retry without mutating state", async () => {
    const clock = new MutableClock();
    await prepareActiveConfig(clock);
    const session = await createSession(clock, "player-conflict");
    const service = new PostgresSpinService(requirePool(), { nextRandom: () => 0 }, clock);
    await service.spin({ clientSpinId: "client-spin-conflict", sessionId: session.sessionId, wager: wager(), correlationId: "req-conflict" });

    await expect(service.spin({
      clientSpinId: "client-spin-conflict",
      sessionId: session.sessionId,
      wager: { lineBet: 2, selectedWays: 1, totalWager: 2 },
      correlationId: "req-conflict-changed"
    })).rejects.toMatchObject({ statusCode: 409, apiError: { code: "IDEMPOTENCY_CONFLICT" } });

    await expect(tableCount("spins")).resolves.toBe("1");
    await expect(tableCount("wallet_transactions")).resolves.toBe("2");
  });

  it("rolls back idempotency, wallet, and spin state on injected wallet or ledger failures", async () => {
    const clock = new MutableClock();
    await prepareActiveConfig(clock);
    const walletFailureSession = await createSession(clock, "player-wallet-failure");
    const walletFailureService = new PostgresSpinService(requirePool(), {
      nextRandom: () => 0,
      failWalletCommit: (request) => request.type === "debit"
    }, clock);

    await expect(walletFailureService.spin({ clientSpinId: "client-spin-wallet-fail", sessionId: walletFailureSession.sessionId, wager: wager(), correlationId: "req-wallet-fail" }))
      .rejects.toMatchObject({ statusCode: 500, apiError: { code: "WALLET_TRANSACTION_FAILED" } });
    await expect(tableCount("spins")).resolves.toBe("0");
    await expect(tableCount("wallet_transactions")).resolves.toBe("0");
    await expect(tableCount("spin_idempotency_keys")).resolves.toBe("0");

    const ledgerFailureSession = await createSession(clock, "player-ledger-failure");
    let shouldFailLedger = true;
    const ledgerFailureService = new PostgresSpinService(requirePool(), {
      nextRandom: () => 0,
      failLedgerCommit: () => shouldFailLedger
    }, clock);
    await expect(ledgerFailureService.spin({ clientSpinId: "client-spin-ledger-fail", sessionId: ledgerFailureSession.sessionId, wager: wager(), correlationId: "req-ledger-fail" }))
      .rejects.toBeInstanceOf(Error);
    await expect(tableCount("spins")).resolves.toBe("0");
    await expect(tableCount("wallet_transactions")).resolves.toBe("0");
    await expect(tableCount("spin_idempotency_keys")).resolves.toBe("0");

    shouldFailLedger = false;
    await expect(ledgerFailureService.spin({ clientSpinId: "client-spin-ledger-fail", sessionId: ledgerFailureSession.sessionId, wager: wager(), correlationId: "req-ledger-retry" }))
      .resolves.toMatchObject({ payout: 5, balanceAfter: 1004 });
  });

  it("rejects missing sessions without leaving idempotency state", async () => {
    const clock = new MutableClock();
    await prepareActiveConfig(clock);
    const service = new PostgresSpinService(requirePool(), { nextRandom: () => 0 }, clock);

    await expect(service.spin({
      clientSpinId: "client-spin-missing-session",
      sessionId: "session_missing",
      wager: wager(),
      correlationId: "req-missing-session"
    })).rejects.toMatchObject({ statusCode: 401, apiError: { code: "SESSION_INVALID" } });
    await expect(tableCount("spin_idempotency_keys")).resolves.toBe("0");
  });

  it("enforces operator limits and budget protection before wallet mutation", async () => {
    const clock = new MutableClock();
    await prepareActiveConfig(clock);
    const operatorLimitSession = await createSession(clock, "player-operator-limit");
    const operatorLimits = new InMemoryOperatorLimitsRepository(clock);
    operatorLimits.create({
      scopeId: "default",
      actor: "operator-1",
      limits: {
        currency: "points",
        perSpin: { minBet: 1, maxBet: 1, maxPayout: 1 },
        perSession: { maxSpins: 0, maxWager: 1 },
        perDay: { playerMaxWager: 1, playerMaxReward: 1 },
        campaign: { budget: 1, jackpotCap: 1 }
      }
    });
    const operatorLimitService = new PostgresSpinService(requirePool(), {
      nextRandom: () => 0,
      operatorLimitsProvider: operatorLimits
    }, clock);

    await expect(operatorLimitService.spin({ clientSpinId: "client-spin-limit", sessionId: operatorLimitSession.sessionId, wager: wager(), correlationId: "req-limit" }))
      .rejects.toMatchObject({ statusCode: 409, apiError: { code: "OPERATOR_LIMIT_EXCEEDED" } });
    await expect(tableCount("wallet_transactions")).resolves.toBe("0");
    await expect(tableCount("spins")).resolves.toBe("0");

    const budgetSession = await createSession(clock, "player-budget-protection");
    const budgetProtection = new InMemoryBudgetProtectionRepository(clock);
    budgetProtection.apply({ scopeId: "default", action: "pauseCampaign", actor: "operator-1", reason: "test pause" });
    const budgetService = new PostgresSpinService(requirePool(), {
      nextRandom: () => 0,
      budgetProtectionProvider: budgetProtection
    }, clock);

    await expect(budgetService.spin({ clientSpinId: "client-spin-budget", sessionId: budgetSession.sessionId, wager: wager(), correlationId: "req-budget" }))
      .rejects.toMatchObject({ statusCode: 409, apiError: { code: "BUDGET_PROTECTION_ACTIVE" } });
    await expect(tableCount("wallet_transactions")).resolves.toBe("0");
    await expect(tableCount("spins")).resolves.toBe("0");
  });
});

async function prepareActiveConfig(clock: MutableClock): Promise<void> {
  const repository = new PostgresGameConfigurationRepository(requirePool(), clock);
  const report = calculateRtpReport(simpleConfig, { wager: wager() });
  await repository.createDraft({ id: `draft-${randomSuffix()}`, config: simpleConfig, actor: "operator-1" });
  const draft = (await repository.list()).find((record) => record.configId === simpleConfig.id && record.status === "draft");
  if (!draft) {
    throw new Error("Expected draft configuration.");
  }
  await repository.attachMathReport({ draftId: draft.id, report, actor: "operator-1" });
  await repository.storeSimulationRun({
    draftId: draft.id,
    input: { spinCount: 8, seed: "spin-service-seed", wager: wager(), theoreticalRtp: report.theoreticalRtp },
    result: runSimulation(simpleConfig, { spinCount: 8, seed: "spin-service-seed", wager: wager(), theoreticalRtp: report.theoreticalRtp }),
    actor: "operator-1"
  });
  await repository.activateDraft({ id: draft.id, actor: "operator-1" });
}

async function createSession(clock: MutableClock, subject: string): Promise<{ sessionId: string; playerId: string }> {
  const service = new SessionService(new PostgresPlayerSessionRepository(requirePool()), clock);
  const result = await service.createOrResume({
    identity: { provider: "demo", subject, displayName: subject, expiresAt: "2026-06-21T10:00:00.000Z" }
  });
  return { sessionId: result.response.sessionId, playerId: result.response.playerId };
}

async function tableCount(tableName: string): Promise<string> {
  const result = await requirePool().query<{ count: string }>(`SELECT count(*)::text AS count FROM ${tableName}`);
  return result.rows[0]?.count ?? "0";
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

function wager() {
  return { lineBet: 1, selectedWays: 1, totalWager: 1 };
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2);
}