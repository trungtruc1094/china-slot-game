import type { GameConfiguration, RtpReport, SimulationResult } from "@china-slot-game/game-math";
import { describe, expect, it, vi } from "vitest";
import { seedActiveConfigForDeployment, seededActiveConfig } from "../../src/config/seed-active-config.js";
import { InMemoryAdminAuditRepository } from "../../src/domain/admin-audit-repository.js";
import { InMemoryGameConfigurationRepository } from "../../src/domain/game-configuration-repository.js";
import type { Clock } from "../../src/domain/session-service.js";

vi.mock("@china-slot-game/game-math", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@china-slot-game/game-math")>();

  return {
    ...actual,
    calculateRtpReport: vi.fn((config: GameConfiguration): RtpReport => ({
      configId: config.id,
      configVersionId: config.versionId,
      totalOutcomes: 3125,
      totalWagered: 759375,
      totalPaid: 713878,
      theoreticalRtp: 0.94016,
      hitRate: 0.42,
      freeSpinTriggerFrequency: 0,
      jackpotTriggerFrequency: 0,
      maxPayoutExposure: 1000,
      payoutDistribution: [],
      diagnostics: []
    })),
    runSimulation: vi.fn((config: GameConfiguration): SimulationResult => ({
      configId: config.id,
      configVersionId: config.versionId,
      spinCount: 1000,
      seed: "deployment-seed-smoke",
      totalWagered: 243000,
      totalPaid: 228459,
      observedRtp: 0.94016,
      hitRate: 0.42,
      largestWin: 1000,
      scatterCount: 0,
      jackpotCount: 0,
      volatility: {
        meanPayout: 228.459,
        variance: 0,
        standardDeviation: 0,
        zeroPayCount: 580,
        smallWinCount: 420,
        mediumWinCount: 0,
        largeWinCount: 0
      },
      confidenceNotes: []
    }))
  };
});

class FixedClock implements Clock {
  public now(): Date {
    return new Date("2026-06-20T08:00:00.000Z");
  }
}

describe("seedActiveConfigForDeployment", () => {
  const createRepository = (): InMemoryGameConfigurationRepository => new InMemoryGameConfigurationRepository(
    new FixedClock(),
    new InMemoryAdminAuditRepository(new FixedClock())
  );

  it("creates and activates the deployment seed config", () => {
    const repository = createRepository();

    seedActiveConfigForDeployment(repository);

    expect(repository.getActiveConfig()).toMatchObject({
      id: seededActiveConfig.id,
      versionId: seededActiveConfig.versionId
    });
    expect(repository.read("seed-fast-realish-94-draft")).toMatchObject({
      status: "active",
      mathReportId: "math_report_1",
      versionNumber: 1
    });
    expect(repository.getMathReportForDraft("seed-fast-realish-94-draft")?.report).toMatchObject({
      theoreticalRtp: 0.94016,
      totalOutcomes: 3125
    });
    expect(repository.listSimulationRuns("seed-fast-realish-94-draft")).toHaveLength(1);
  });

  it("does nothing when the seed draft already exists", () => {
    const repository = createRepository();

    repository.createDraft({
      id: "seed-fast-realish-94-draft",
      config: seededActiveConfig,
      actor: "test",
      metadata: { reason: "Existing seed draft." }
    });

    seedActiveConfigForDeployment(repository);

    expect(repository.list()).toHaveLength(1);
    const existingDraft = repository.read("seed-fast-realish-94-draft");
    expect(existingDraft).toMatchObject({ status: "draft" });
    expect(existingDraft?.mathReportId).toBeUndefined();
    expect(repository.listSimulationRuns("seed-fast-realish-94-draft")).toHaveLength(0);
  });
});
