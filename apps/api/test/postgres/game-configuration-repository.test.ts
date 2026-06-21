import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculateRtpReport, runSimulation, type GameConfiguration } from "@china-slot-game/game-math";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/pool.js";
import { MigrationRunner } from "../../src/db/migrations.js";
import { PostgresGameConfigurationRepository } from "../../src/repositories/postgres/game-configuration-repository.js";
import type { Clock } from "../../src/domain/session-service.js";
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

describePostgres("PostgresGameConfigurationRepository", () => {
  it("persists draft lifecycle, math reports, simulations, activation, rollback, and audit events", async () => {
    const clock = new MutableClock();
    const repository = new PostgresGameConfigurationRepository(requirePool(), clock);
    const firstReport = calculateRtpReport(simpleConfig, { wager: wager() });

    const created = await repository.createDraft({
      id: "draft-1",
      config: simpleConfig,
      actor: "operator-1",
      metadata: { reason: "initial draft" }
    });
    clock.current = new Date("2026-06-21T08:05:00.000Z");
    const updatedConfig = {
      ...simpleConfig,
      versionId: "simple-config-v1-updated",
      limits: { ...simpleConfig.limits, maxBet: 100 }
    } satisfies GameConfiguration;
    const updated = await repository.updateDraft({
      id: "draft-1",
      config: updatedConfig,
      actor: "operator-2",
      metadata: { reason: "tighten max bet" }
    });
    const attached = await repository.attachMathReport({
      draftId: "draft-1",
      report: { ...firstReport, configVersionId: updatedConfig.versionId },
      actor: "operator-2"
    });
    const simulation = await repository.storeSimulationRun({
      draftId: "draft-1",
      input: simulationInput(attached.report.theoreticalRtp),
      result: runSimulation(updatedConfig, simulationInput(attached.report.theoreticalRtp)),
      actor: "operator-2"
    });
    const activeOne = await repository.activateDraft({
      id: "draft-1",
      actor: "operator-3",
      reason: "approved launch config"
    });

    const replacementConfig = {
      ...simpleConfig,
      versionId: "simple-config-v2",
      paytable: [{ id: "a-3", symbols: ["A", "A", "A", "any", "any"], pay: 500, freeSpins: 0 }]
    } satisfies GameConfiguration;
    await prepareValidatedDraft(repository, "draft-2", replacementConfig, "operator-4");
    clock.current = new Date("2026-06-21T08:10:00.000Z");
    const activeTwo = await repository.activateDraft({ id: "draft-2", actor: "operator-4", reason: "higher pay test" });
    clock.current = new Date("2026-06-21T08:15:00.000Z");
    const rolledBack = await repository.rollbackToVersion({
      targetVersionId: updatedConfig.versionId,
      actor: "operator-5",
      reason: "restore prior economics"
    });

    expect(created).toMatchObject({ id: "draft-1", status: "draft" });
    expect(created.mathReportId).toBeUndefined();
    expect(updated).toMatchObject({ versionId: updatedConfig.versionId, metadata: { reason: "tighten max bet" } });
    expect(attached).toMatchObject({ draftId: "draft-1", configVersionId: updatedConfig.versionId });
    expect(simulation).toMatchObject({ draftId: "draft-1", configVersionId: updatedConfig.versionId });
    expect(activeOne).toMatchObject({ status: "active", versionNumber: 1, mathReportId: attached.id });
    expect(activeTwo).toMatchObject({ status: "active", versionNumber: 2 });
    expect(rolledBack).toMatchObject({ id: "draft-1", status: "active", versionId: updatedConfig.versionId });
    expect(await repository.getActiveRecord()).toMatchObject({ id: "draft-1", status: "active" });
    expect(repository.getActiveConfig()).toMatchObject({ versionId: updatedConfig.versionId, limits: { maxBet: 100 } });
    expect(await repository.listSimulationRuns("draft-1")).toHaveLength(1);
    expect(await repository.getSimulationRun("draft-1", simulation.id)).toMatchObject({ id: simulation.id });
    expect(await repository.listAuditEvents()).toMatchObject([
      { action: "config.activate", actor: "operator-3", reason: "approved launch config" },
      { action: "config.activate", actor: "operator-4", reason: "higher pay test" },
      {
        action: "config.rollback",
        actor: "operator-5",
        reason: "restore prior economics",
        metadata: { previousActiveVersionId: replacementConfig.versionId, targetVersionId: updatedConfig.versionId }
      }
    ]);
    expect((await repository.list()).filter((record) => record.status === "active")).toHaveLength(1);
  });

  it("enforces immutable reports, activated config protection, uniqueness, and restart recovery", async () => {
    const clock = new MutableClock();
    const repository = new PostgresGameConfigurationRepository(requirePool(), clock);
    await prepareValidatedDraft(repository, "draft-restart", simpleConfig, "operator-1");
    const active = await repository.activateDraft({ id: "draft-restart", actor: "operator-1" });

    await expect(repository.updateDraft({
      id: "draft-restart",
      config: { ...simpleConfig, versionId: "simple-config-active-edit" },
      actor: "operator-2"
    })).rejects.toMatchObject({ statusCode: 409, apiError: { code: "CONFIG_STATUS_CONFLICT" } });
    await expect(repository.createDraft({
      id: "draft-duplicate-version",
      config: simpleConfig,
      actor: "operator-2"
    })).rejects.toMatchObject({ statusCode: 409, apiError: { code: "CONFIG_VERSION_CONFLICT" } });
    await expect(repository.attachMathReport({
      draftId: "draft-restart",
      report: calculateRtpReport(simpleConfig, { wager: wager() }),
      actor: "operator-2"
    })).rejects.toMatchObject({ statusCode: 409, apiError: { code: "CONFIG_STATUS_CONFLICT" } });

    const reconstructed = new PostgresGameConfigurationRepository(requirePool(), clock);
    const recoveredActive = await reconstructed.getActiveRecord();

    expect(active).toMatchObject({ status: "active", versionNumber: 1 });
    expect(recoveredActive).toMatchObject({ id: "draft-restart", status: "active", versionId: simpleConfig.versionId });
    expect(reconstructed.getActiveConfig()).toEqual(simpleConfig);
    expect(await reconstructed.getMathReportForDraft("draft-restart")).toMatchObject({ configVersionId: simpleConfig.versionId });
    expect(await reconstructed.listSimulationRuns("draft-restart")).toHaveLength(1);
  });

  it("rejects activation when validation artifacts are missing or blocking", async () => {
    const repository = new PostgresGameConfigurationRepository(requirePool(), new MutableClock());
    const report = calculateRtpReport(simpleConfig, { wager: wager() });

    await repository.createDraft({ id: "draft-missing-report", config: simpleConfig, actor: "operator-1" });
    await expect(repository.activateDraft({ id: "draft-missing-report", actor: "operator-1" }))
      .rejects
      .toMatchObject({ statusCode: 404, apiError: { code: "MATH_REPORT_NOT_FOUND" } });

    await repository.createDraft({
      id: "draft-missing-simulation",
      config: { ...simpleConfig, versionId: "simple-config-missing-simulation" },
      actor: "operator-1"
    });
    await repository.attachMathReport({ draftId: "draft-missing-simulation", report: { ...report, configVersionId: "simple-config-missing-simulation" }, actor: "operator-1" });
    await expect(repository.activateDraft({ id: "draft-missing-simulation", actor: "operator-1" }))
      .rejects
      .toMatchObject({ statusCode: 404, apiError: { code: "SIMULATION_NOT_FOUND" } });

    const blockingConfig = { ...simpleConfig, versionId: "simple-config-blocking-report" } satisfies GameConfiguration;
    await repository.createDraft({
      id: "draft-blocking-report",
      config: blockingConfig,
      actor: "operator-1"
    });
    await repository.attachMathReport({
      draftId: "draft-blocking-report",
      report: {
        ...report,
        configVersionId: "simple-config-blocking-report",
        diagnostics: [{
          code: "MISSING_SYMBOL_METADATA",
          severity: "error",
          message: "Missing symbol metadata blocks activation.",
          path: ["symbols", "Missing"]
        }]
      },
      actor: "operator-1"
    });
    await repository.storeSimulationRun({
      draftId: "draft-blocking-report",
      input: simulationInput(report.theoreticalRtp),
      result: runSimulation(blockingConfig, simulationInput(report.theoreticalRtp)),
      actor: "operator-1"
    });
    await expect(repository.activateDraft({ id: "draft-blocking-report", actor: "operator-1" }))
      .rejects
      .toMatchObject({ statusCode: 409, apiError: { code: "CONFIG_MATH_REPORT_BLOCKED" } });
  });

  it("stores simulations without mutating player or session persistence tables", async () => {
    const repository = new PostgresGameConfigurationRepository(requirePool(), new MutableClock());
    await repository.createDraft({ id: "draft-simulation", config: simpleConfig, actor: "operator-1" });
    await repository.attachMathReport({
      draftId: "draft-simulation",
      report: calculateRtpReport(simpleConfig, { wager: wager() }),
      actor: "operator-1"
    });
    const beforeCounts = await tableCounts(["players", "provider_identity_mappings", "sessions"]);

    await repository.storeSimulationRun({
      draftId: "draft-simulation",
      input: simulationInput(0.625),
      result: runSimulation(simpleConfig, simulationInput(0.625)),
      actor: "operator-1"
    });

    await expect(tableCounts(["players", "provider_identity_mappings", "sessions"])).resolves.toEqual(beforeCounts);
  });

  it("backs existing admin configuration routes with PostgreSQL persistence", async () => {
    const repository = new PostgresGameConfigurationRepository(requirePool(), new MutableClock());
    const server = createServer(createApp({ configRepository: repository }));
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const draftResponse = await fetch(`${baseUrl}/api/admin/configs/drafts`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ id: "draft-route", config: simpleConfig })
      });
      const reportResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-route/math-report`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ wager: wager() })
      });
      const simulationResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-route/simulations`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ spinCount: 8, seed: "route-seed", wager: wager() })
      });
      const activationResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-route/activate`, {
        method: "POST",
        headers: adminHeaders("operator", "operator-route"),
        body: JSON.stringify({ reason: "route activation" })
      });
      const rollbackDraftConfig = { ...simpleConfig, versionId: "simple-config-route-v2" } satisfies GameConfiguration;
      await expect(fetch(`${baseUrl}/api/admin/configs/drafts`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ id: "draft-route-v2", config: rollbackDraftConfig })
      })).resolves.toMatchObject({ status: 201 });
      await expect(fetch(`${baseUrl}/api/admin/configs/drafts/draft-route-v2/math-report`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ wager: wager() })
      })).resolves.toMatchObject({ status: 201 });
      await expect(fetch(`${baseUrl}/api/admin/configs/drafts/draft-route-v2/simulations`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ spinCount: 8, seed: "route-seed-v2", wager: wager() })
      })).resolves.toMatchObject({ status: 201 });
      await expect(fetch(`${baseUrl}/api/admin/configs/drafts/draft-route-v2/activate`, {
        method: "POST",
        headers: adminHeaders("operator", "operator-route"),
        body: JSON.stringify({ reason: "route activation v2" })
      })).resolves.toMatchObject({ status: 200 });
      const rollbackResponse = await fetch(`${baseUrl}/api/admin/configs/rollback`, {
        method: "POST",
        headers: adminHeaders("operator", "operator-route"),
        body: JSON.stringify({ targetVersionId: simpleConfig.versionId, reason: "route rollback" })
      });
      const auditResponse = await fetch(`${baseUrl}/api/admin/configs/audit-events`, {
        headers: adminHeaders("viewer", "viewer-route")
      });
      const auditBody = await auditResponse.json() as { data: { auditEvents: Array<Record<string, unknown>> } };

      expect(draftResponse.status).toBe(201);
      expect(reportResponse.status).toBe(201);
      expect(simulationResponse.status).toBe(201);
      expect(activationResponse.status).toBe(200);
      expect(rollbackResponse.status).toBe(200);
      expect(auditResponse.status).toBe(200);
      expect(await repository.getActiveRecord()).toMatchObject({ id: "draft-route", status: "active" });
      expect(auditBody.data.auditEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: "config.activate", actor: "operator-route", reason: "route activation" }),
        expect.objectContaining({ action: "config.activate", actor: "operator-route", reason: "route activation v2" }),
        expect.objectContaining({ action: "config.rollback", actor: "operator-route", reason: "route rollback" })
      ]));
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
});

async function prepareValidatedDraft(
  repository: PostgresGameConfigurationRepository,
  id: string,
  config: GameConfiguration,
  actor: string
): Promise<void> {
  const report = calculateRtpReport(config, { wager: wager() });
  await repository.createDraft({ id, config, actor });
  await repository.attachMathReport({ draftId: id, report, actor });
  await repository.storeSimulationRun({
    draftId: id,
    input: simulationInput(report.theoreticalRtp),
    result: runSimulation(config, simulationInput(report.theoreticalRtp)),
    actor
  });
}

async function tableCounts(tableNames: string[]): Promise<Record<string, string>> {
  const entries = await Promise.all(tableNames.map(async (tableName) => {
    const result = await requirePool().query<{ count: string }>(`SELECT count(*)::text AS count FROM ${tableName}`);
    return [tableName, result.rows[0]?.count ?? "0"] as const;
  }));

  return Object.fromEntries(entries);
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

function adminHeaders(role = "operator", actor = "operator-1"): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-admin-role": role,
    "x-admin-actor": actor,
    "x-request-id": "req_postgres_config_repository_test"
  };
}

function wager() {
  return { lineBet: 1, selectedWays: 1, totalWager: 1 };
}

function simulationInput(theoreticalRtp: number) {
  return {
    spinCount: 8,
    seed: "config-repository-seed",
    wager: wager(),
    theoreticalRtp
  };
}