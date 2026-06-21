import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculateRtpReport, runSimulation } from "@china-slot-game/game-math";
import { createPostgresPool } from "../../src/db/pool.js";
import { MigrationRunner } from "../../src/db/migrations.js";
import { MetricsService } from "../../src/domain/metrics-service.js";
import { SessionService, type Clock } from "../../src/domain/session-service.js";
import { PostgresGameConfigurationRepository } from "../../src/repositories/postgres/game-configuration-repository.js";
import {
  PostgresAdminAuditRepository,
  PostgresAlertRepository,
  PostgresBudgetProtectionRepository,
  PostgresOperatorLimitsRepository,
  PostgresRequestTraceRepository
} from "../../src/repositories/postgres/operational-repositories.js";
import { PostgresPlayerSessionRepository } from "../../src/repositories/postgres/player-session-repository.js";
import { PostgresProviderTopUpIdempotencyRepository } from "../../src/repositories/postgres/provider-top-up-idempotency-repository.js";
import { PostgresSpinService } from "../../src/repositories/postgres/spin-service.js";
import { PostgresWalletRepository } from "../../src/repositories/postgres/wallet-repository.js";
import { simpleConfig } from "../fixtures/simple-config.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;
let pool: ReturnType<typeof createPostgresPool> | undefined;

class MutableClock implements Clock {
  public current = new Date("2026-06-21T08:00:00.000Z");

  public now(): Date {
    return this.current;
  }

  public tick(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
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
    await resetPublicSchema();
    await pool.end();
    pool = undefined;
  }
});

describePostgres("Epic 7 persistence recovery verification", () => {
  it("recovers gameplay, operations, admin search records, metrics, and future provider idempotency after reconstruction", async () => {
    const clock = new MutableClock();
    const audit = new PostgresAdminAuditRepository(requirePool(), clock);
    const configRepository = new PostgresGameConfigurationRepository(requirePool(), clock, audit);
    const operatorLimits = new PostgresOperatorLimitsRepository(requirePool(), clock, audit);
    const budgetProtection = new PostgresBudgetProtectionRepository(requirePool(), clock, audit);
    const alerts = new PostgresAlertRepository(requirePool(), clock, audit);
    const traces = new PostgresRequestTraceRepository(requirePool());
    const playerSessions = new PostgresPlayerSessionRepository(requirePool());
    const sessionService = new SessionService(playerSessions, clock);
    const wallet = new PostgresWalletRepository(requirePool(), clock);
    const topUps = new PostgresProviderTopUpIdempotencyRepository(requirePool(), clock);

    await prepareActiveConfig(configRepository, clock);
    await operatorLimits.create({ scopeId: "default", limits: operatorLimitValues(), actor: "operator-1", reason: "launch verification" });
    const budgetAction = await budgetProtection.apply({ scopeId: "audit-only", action: "requireHostApproval", actor: "operator-1", reason: "manual verification" });
    const alertRule = await alerts.upsertRule({
      id: "rule-persistence-rtp",
      scopeId: "default",
      metric: "observedRtpAbove",
      threshold: 1,
      severity: "warning",
      suggestedAction: "Review persisted metrics.",
      enabled: true,
      actor: "operator-1"
    });
    const alertEvent = await alerts.appendEvent({
      ruleId: alertRule.id,
      scopeId: "default",
      evaluationKey: "rule-persistence-rtp|window",
      status: "firing",
      metric: "observedRtpAbove",
      metricValue: 5,
      threshold: 1,
      windowStartAt: null,
      windowEndAt: null,
      severity: "warning",
      suggestedAction: "Review persisted metrics.",
      actor: "alert-service"
    });
    await alerts.acknowledge(alertEvent.id, "support-1", "verified");

    const sessionResult = await sessionService.createOrResume({
      identity: { provider: "demo", subject: "player-recovery", displayName: "Player Recovery", expiresAt: "2026-06-21T10:00:00.000Z" }
    });
    const spinService = new PostgresSpinService(requirePool(), {
      nextRandom: () => 0,
      configProvider: configRepository,
      operatorLimitsProvider: operatorLimits,
      budgetProtectionProvider: budgetProtection
    }, clock);
    const firstSpin = await spinService.spin({
      sessionId: sessionResult.response.sessionId,
      clientSpinId: "client-recovery-spin",
      wager: wager(),
      correlationId: "req-recovery-spin"
    });
    const walletBeforeRetry = await wallet.getWallet(sessionResult.response.playerId);

    const reconstructedSpinForRetry = new PostgresSpinService(requirePool(), { nextRandom: () => 0.75, configProvider: configRepository }, clock);
    const retrySpin = await reconstructedSpinForRetry.spin({
      sessionId: sessionResult.response.sessionId,
      clientSpinId: "client-recovery-spin",
      wager: wager(),
      correlationId: "req-recovery-spin-retry"
    });
    const walletAfterRetry = await wallet.getWallet(sessionResult.response.playerId);

    await Promise.all([
      wallet.applyTransaction({ playerId: sessionResult.response.playerId, type: "credit", amount: 10, actor: "test", source: "concurrent-a" }),
      wallet.applyTransaction({ playerId: sessionResult.response.playerId, type: "credit", amount: 20, actor: "test", source: "concurrent-b" })
    ]);
    await traces.record({
      requestId: "req-recovery-trace",
      correlationId: "corr-recovery-trace",
      method: "POST",
      path: "/api/spins",
      statusCode: 200,
      latencyMs: 21,
      outcome: "succeeded",
      playerId: sessionResult.response.playerId,
      sessionId: sessionResult.response.sessionId,
      spinId: firstSpin.spinId,
      occurredAt: clock.now().toISOString()
    });
    await topUps.createOrGet({
      providerName: "tevi",
      providerEventId: "provider-event-recovery",
      normalizedIdempotencyKey: "tevi:provider-event-recovery",
      playerId: sessionResult.response.playerId,
      pointAmount: 100,
      pointsMetadata: { pointUnit: "community_points" },
      providerMetadata: { deliveryMode: "future_webhook" }
    });

    const reconstructedConfig = new PostgresGameConfigurationRepository(requirePool(), clock, audit);
    const reconstructedLimits = new PostgresOperatorLimitsRepository(requirePool(), clock, audit);
    const reconstructedBudget = new PostgresBudgetProtectionRepository(requirePool(), clock, audit);
    const reconstructedAlerts = new PostgresAlertRepository(requirePool(), clock, audit);
    const reconstructedSpin = new PostgresSpinService(requirePool(), { configProvider: reconstructedConfig }, clock);
    await reconstructedConfig.getActiveRecord();
    await reconstructedLimits.load();
    await reconstructedBudget.load();
    await reconstructedAlerts.load();
    const recoveredLedger = await reconstructedSpin.loadLedger();

    const metrics = new MetricsService(reconstructedSpin, reconstructedConfig, reconstructedLimits, reconstructedAlerts).getMetrics({ configVersionId: simpleConfig.versionId });
    const reconstructedWallet = new PostgresWalletRepository(requirePool(), clock);
    const reconstructedSessions = new PostgresPlayerSessionRepository(requirePool());
    const reconstructedTrace = new PostgresRequestTraceRepository(requirePool());
    const reconstructedTopUps = new PostgresProviderTopUpIdempotencyRepository(requirePool(), clock);

    expect(retrySpin).toEqual(firstSpin);
    expect(walletAfterRetry).toEqual(walletBeforeRetry);
    expect(await tableCount("spins")).toBe("1");
    expect(await tableCount("spin_idempotency_keys")).toBe("1");
    expect(await tableCount("wallet_transactions")).toBe("4");
    expect(await reconstructedWallet.getWallet(sessionResult.response.playerId)).toMatchObject({ balance: firstSpin.balanceAfter + 30 });
    expect(recoveredLedger).toEqual([expect.objectContaining({ spinId: firstSpin.spinId, sessionId: sessionResult.response.sessionId, playerId: sessionResult.response.playerId })]);
    expect(await reconstructedConfig.getActiveRecord()).toMatchObject({ versionId: simpleConfig.versionId, status: "active" });
    expect(reconstructedConfig.getActiveConfig()).toEqual(simpleConfig);
    expect(reconstructedLimits.getActiveLimits("default")).toMatchObject({ scopeId: "default" });
    expect(reconstructedBudget.listActiveActions("audit-only")).toEqual([expect.objectContaining({ id: budgetAction.id, status: "active" })]);
    expect(reconstructedAlerts.getAlertState("default")).toBe("active");
    await expect(reconstructedAlerts.listRules("default")).resolves.toEqual([expect.objectContaining({ id: alertRule.id, scopeId: "default" })]);
    await expect(reconstructedAlerts.listHistory("default")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: alertEvent.id, status: "firing" }),
      expect.objectContaining({ status: "acknowledged", actor: "support-1" })
    ]));
    expect(metrics).toMatchObject({ totalWagered: 1, totalPaid: 5, observedRtp: 5, hitRate: 1, playerCount: 1, activeSessions: 1 });
    await expect(reconstructedSessions.searchSessions({ playerId: sessionResult.response.playerId })).resolves.toEqual([
      expect.objectContaining({ sessionId: sessionResult.response.sessionId, playerId: sessionResult.response.playerId, status: "active" })
    ]);
    await expect(reconstructedWallet.searchTransactions({ playerId: sessionResult.response.playerId, limit: 10, offset: 0 })).resolves.toMatchObject({ total: 4 });
    await expect(audit.list()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "config", action: "config.activate" }),
      expect.objectContaining({ source: "operator-limits", action: "operator_limits.create" }),
      expect.objectContaining({ source: "budget-protection", action: "budget_protection.apply" }),
      expect.objectContaining({ source: "alerts", action: "alert.acknowledged" })
    ]));
    await expect(reconstructedTrace.list()).resolves.toEqual([
      expect.objectContaining({ requestId: "req-recovery-trace", spinId: firstSpin.spinId, playerId: sessionResult.response.playerId })
    ]);
    await expect(reconstructedTopUps.getByProviderEvent("tevi", "provider-event-recovery")).resolves.toMatchObject({
      providerName: "tevi",
      status: "pending",
      pointAmount: 100,
      pointsMetadata: { pointUnit: "community_points" }
    });
    expect(JSON.stringify(await reconstructedTopUps.getByProviderEvent("tevi", "provider-event-recovery"))).not.toMatch(/cash|redemption|currency/i);
  });
});

async function prepareActiveConfig(repository: PostgresGameConfigurationRepository, clock: MutableClock): Promise<void> {
  const report = calculateRtpReport(simpleConfig, { wager: wager() });
  await repository.createDraft({ id: "draft-recovery", config: simpleConfig, actor: "operator-1" });
  await repository.attachMathReport({ draftId: "draft-recovery", report, actor: "operator-1" });
  await repository.storeSimulationRun({
    draftId: "draft-recovery",
    input: { spinCount: 8, seed: "persistence-recovery-seed", wager: wager(), theoreticalRtp: report.theoreticalRtp },
    result: runSimulation(simpleConfig, { spinCount: 8, seed: "persistence-recovery-seed", wager: wager(), theoreticalRtp: report.theoreticalRtp }),
    actor: "operator-1"
  });
  clock.tick(1000);
  await repository.activateDraft({ id: "draft-recovery", actor: "operator-1", reason: "persistence verification" });
}

function operatorLimitValues() {
  return {
    currency: "points",
    perSpin: { minBet: 1, maxBet: 10, maxPayout: 10 },
    perSession: { maxSpins: 100, maxWager: 100 },
    perDay: { playerMaxWager: 100, playerMaxReward: 100 },
    campaign: { budget: 100, jackpotCap: 100 }
  };
}

function wager() {
  return { lineBet: 1, selectedWays: 1, totalWager: 1 };
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
