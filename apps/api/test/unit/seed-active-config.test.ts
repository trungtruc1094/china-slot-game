import { describe, expect, it } from "vitest";
import { seedActiveConfigForDeployment, seededActiveConfig } from "../../src/config/seed-active-config.js";
import { InMemoryAdminAuditRepository } from "../../src/domain/admin-audit-repository.js";
import { InMemoryGameConfigurationRepository } from "../../src/domain/game-configuration-repository.js";
import type { Clock } from "../../src/domain/session-service.js";

class FixedClock implements Clock {
  public now(): Date {
    return new Date("2026-06-20T08:00:00.000Z");
  }
}

describe("seedActiveConfigForDeployment", () => {
  it("creates and activates the deployment seed config", () => {
    const repository = new InMemoryGameConfigurationRepository(
      new FixedClock(),
      new InMemoryAdminAuditRepository(new FixedClock())
    );

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
    const repository = new InMemoryGameConfigurationRepository(new FixedClock());

    seedActiveConfigForDeployment(repository);
    seedActiveConfigForDeployment(repository);

    expect(repository.list()).toHaveLength(1);
    expect(repository.listSimulationRuns("seed-fast-realish-94-draft")).toHaveLength(1);
  });
});
