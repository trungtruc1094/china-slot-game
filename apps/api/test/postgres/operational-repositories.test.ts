import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculateRtpReport, runSimulation } from "@china-slot-game/game-math";
import { createPostgresPool } from "../../src/db/pool.js";
import { MigrationRunner } from "../../src/db/migrations.js";
import { InMemoryGameConfigurationRepository } from "../../src/domain/game-configuration-repository.js";
import { MetricsService } from "../../src/domain/metrics-service.js";
import { SessionService, type Clock } from "../../src/domain/session-service.js";
import { PostgresGameConfigurationRepository } from "../../src/repositories/postgres/game-configuration-repository.js";
import { PostgresPlayerSessionRepository } from "../../src/repositories/postgres/player-session-repository.js";
import { PostgresSpinService } from "../../src/repositories/postgres/spin-service.js";
import {
  PostgresAdminAuditRepository,
  PostgresAlertRepository,
  PostgresBudgetProtectionRepository,
  PostgresOperatorLimitsRepository,
  PostgresRequestTraceRepository
} from "../../src/repositories/postgres/operational-repositories.js";
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

describePostgres("PostgreSQL operational repositories", () => {
  it("persists operator limits and reloads active limits for spin validation", async () => {
    const clock = new MutableClock();
    const audit = new PostgresAdminAuditRepository(requirePool(), clock);
    const limits = new PostgresOperatorLimitsRepository(requirePool(), clock, audit);
    const record = await limits.create({ scopeId: "default", limits: operatorLimits({ maxSpins: 1 }), actor: "operator-1", reason: "launch" });

    const reconstructed = new PostgresOperatorLimitsRepository(requirePool(), clock, audit);
    await reconstructed.load();

    expect(reconstructed.getActiveLimits("default")).toMatchObject({ id: record.id, scopeId: "default", version: 1 });
    await expect(reconstructed.listAuditEvents()).resolves.toEqual([
      expect.objectContaining({ action: "operator_limits.create", targetId: record.id, actor: "operator-1", reason: "launch" })
    ]);

    await prepareActiveConfig(clock);
    const session = await createSession(clock, "player-limit-pg");
    const spinService = new PostgresSpinService(requirePool(), { nextRandom: () => 0, operatorLimitsProvider: reconstructed }, clock);
    await expect(spinService.spin({ clientSpinId: "limit-spin-1", sessionId: session.sessionId, wager: wager() })).resolves.toMatchObject({ payout: 5 });
    await expect(spinService.spin({ clientSpinId: "limit-spin-2", sessionId: session.sessionId, wager: wager() }))
      .rejects.toMatchObject({ statusCode: 409, apiError: { code: "OPERATOR_LIMIT_EXCEEDED" } });
  });

  it("persists budget protection actions and reloads active actions for spin validation", async () => {
    const clock = new MutableClock();
    const audit = new PostgresAdminAuditRepository(requirePool(), clock);
    const budget = new PostgresBudgetProtectionRepository(requirePool(), clock, audit);
    const action = await budget.apply({ scopeId: "default", action: "pauseCampaign", actor: "operator-1", reason: "incident pause" });

    const reconstructed = new PostgresBudgetProtectionRepository(requirePool(), clock, audit);
    await reconstructed.load();

    expect(reconstructed.listActiveActions("default")).toEqual([expect.objectContaining({ id: action.id, action: "pauseCampaign" })]);
    await prepareActiveConfig(clock);
    const session = await createSession(clock, "player-budget-pg");
    const spinService = new PostgresSpinService(requirePool(), { nextRandom: () => 0, budgetProtectionProvider: reconstructed }, clock);
    await expect(spinService.spin({ clientSpinId: "budget-spin", sessionId: session.sessionId, wager: wager() }))
      .rejects.toMatchObject({ statusCode: 409, apiError: { code: "BUDGET_PROTECTION_ACTIVE" } });

    const reverted = await reconstructed.revert(action.id, "operator-1", "resume");
    expect(reverted).toMatchObject({ status: "reverted", revertedBy: "operator-1" });
    expect(reconstructed.listActiveActions("default")).toEqual([]);
  });

  it("persists alert rules, history, acknowledgments, and active state", async () => {
    const clock = new MutableClock();
    const audit = new PostgresAdminAuditRepository(requirePool(), clock);
    const alerts = new PostgresAlertRepository(requirePool(), clock, audit);
    const rule = await alerts.upsertRule({
      id: "rule-rtp-high",
      scopeId: "default",
      metric: "observedRtpAbove",
      threshold: 1,
      severity: "warning",
      suggestedAction: "Review payout trend.",
      enabled: true,
      actor: "operator-1"
    });
    const event = await alerts.appendEvent({
      ruleId: rule.id,
      scopeId: "default",
      evaluationKey: "rule-rtp-high|window",
      status: "firing",
      metric: "observedRtpAbove",
      metricValue: 2.5,
      threshold: 1,
      windowStartAt: null,
      windowEndAt: null,
      severity: "warning",
      suggestedAction: "Review payout trend.",
      actor: "alert-service"
    });

    const reconstructed = new PostgresAlertRepository(requirePool(), clock, audit);
    await reconstructed.load();

    expect(await reconstructed.listRules("default")).toEqual([expect.objectContaining({ id: "rule-rtp-high" })]);
    expect(reconstructed.getAlertState("default")).toBe("active");
    await expect(reconstructed.acknowledge(event.id, "support-1", "watching")).resolves.toMatchObject({ status: "acknowledged", reason: "watching" });
    await expect(reconstructed.listHistory("default")).resolves.toHaveLength(2);
  });

  it("persists admin audit events and request traces with search-ready fields", async () => {
    const clock = new MutableClock();
    const audit = new PostgresAdminAuditRepository(requirePool(), clock);
    await audit.record({
      actor: "operator-1",
      role: "operator",
      action: "config.activate",
      resource: { type: "config_version", id: "draft-1" },
      requestId: "req-config",
      reason: "launch",
      source: "config",
      outcome: "succeeded",
      before: null,
      after: { versionId: simpleConfig.versionId },
      metadata: { configId: simpleConfig.id }
    });
    const traces = new PostgresRequestTraceRepository(requirePool());
    await traces.record({
      requestId: "req-trace-1",
      correlationId: "corr-trace-1",
      method: "POST",
      path: "/api/spins",
      statusCode: 200,
      latencyMs: 12,
      outcome: "succeeded",
      sessionId: "session-1",
      spinId: "spin-1",
      occurredAt: clock.now().toISOString()
    });

    await expect(audit.list()).resolves.toEqual([
      expect.objectContaining({
        actor: "operator-1",
        role: "operator",
        action: "config.activate",
        resource: { type: "config_version", id: "draft-1" },
        requestId: "req-config",
        after: { versionId: simpleConfig.versionId }
      })
    ]);
    await expect(traces.list()).resolves.toEqual([
      expect.objectContaining({ requestId: "req-trace-1", correlationId: "corr-trace-1", path: "/api/spins", statusCode: 200, sessionId: "session-1", spinId: "spin-1" })
    ]);
  });

  it("reconciles metrics from persisted spin ledger after reconstruction", async () => {
    const clock = new MutableClock();
    await prepareActiveConfig(clock);
    const session = await createSession(clock, "player-metrics-pg");
    const spinService = new PostgresSpinService(requirePool(), { nextRandom: () => 0 }, clock);
    await spinService.spin({ clientSpinId: "metrics-spin", sessionId: session.sessionId, wager: wager() });

    const reconstructedSpinService = new PostgresSpinService(requirePool(), { nextRandom: () => 0.9 }, clock);
    await reconstructedSpinService.loadLedger();
    const configProvider = new InMemoryGameConfigurationRepository(clock);
    configProvider.createDraft({ id: "metrics-config", config: simpleConfig, actor: "operator-1" });
    configProvider.activateDraft({ id: "metrics-config", actor: "operator-1" });
    const metrics = new MetricsService(reconstructedSpinService, configProvider).getMetrics({ configVersionId: simpleConfig.versionId });

    expect(metrics).toMatchObject({ totalWagered: 1, totalPaid: 5, observedRtp: 5, hitRate: 1, playerCount: 1, activeSessions: 1 });
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
    input: { spinCount: 8, seed: "operational-seed", wager: wager(), theoreticalRtp: report.theoreticalRtp },
    result: runSimulation(simpleConfig, { spinCount: 8, seed: "operational-seed", wager: wager(), theoreticalRtp: report.theoreticalRtp }),
    actor: "operator-1"
  });
  await repository.activateDraft({ id: draft.id, actor: "operator-1" });
}

async function createSession(clock: MutableClock, subject: string): Promise<{ sessionId: string; playerId: string }> {
  const service = new SessionService(new PostgresPlayerSessionRepository(requirePool()), clock);
  const result = await service.createOrResume({ identity: { provider: "demo", subject, displayName: subject, expiresAt: "2026-06-21T10:00:00.000Z" } });
  return { sessionId: result.response.sessionId, playerId: result.response.playerId };
}

function operatorLimits(overrides: { maxSpins?: number } = {}) {
  return {
    currency: "points",
    perSpin: { minBet: 1, maxBet: 10, maxPayout: 10 },
    perSession: { maxSpins: overrides.maxSpins ?? 100, maxWager: 100 },
    perDay: { playerMaxWager: 100, playerMaxReward: 100 },
    campaign: { budget: 100, jackpotCap: 100 }
  };
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
