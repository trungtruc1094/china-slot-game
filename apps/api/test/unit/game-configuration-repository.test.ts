import { describe, expect, it } from "vitest";
import { InMemoryGameConfigurationRepository } from "../../src/domain/game-configuration-repository.js";
import type { Clock } from "../../src/domain/session-service.js";
import { simpleConfig } from "../fixtures/simple-config.js";

class MutableClock implements Clock {
  public current = new Date("2026-06-18T08:00:00.000Z");
  public now(): Date {
    return this.current;
  }
}

describe("game configuration persistence", () => {
  it("creates, reads, lists, updates, activates, and bumps versions", () => {
    const clock = new MutableClock();
    const repository = new InMemoryGameConfigurationRepository(clock);
    const created = repository.createDraft({
      id: "draft-1",
      config: simpleConfig,
      actor: "operator-1",
      metadata: { reason: "initial draft" }
    });

    clock.current = new Date("2026-06-18T08:05:00.000Z");
    const updatedConfig = {
      ...simpleConfig,
      versionId: "simple-config-draft-v2",
      limits: { ...simpleConfig.limits, maxBet: 100 }
    };
    const updated = repository.updateDraft({
      id: "draft-1",
      config: updatedConfig,
      actor: "operator-2",
      metadata: { reason: "tighten max bet" }
    });
    const activeOne = repository.activateDraft({
      id: "draft-1",
      actor: "operator-3",
      reason: "approved launch config"
    });

    repository.createDraft({
      id: "draft-2",
      config: {
        ...simpleConfig,
        versionId: "simple-config-draft-v3",
        limits: { ...simpleConfig.limits, maxBet: 50 }
      },
      actor: "operator-1"
    });
    clock.current = new Date("2026-06-18T08:10:00.000Z");
    const activeTwo = repository.activateDraft({
      id: "draft-2",
      actor: "operator-4",
      reason: "rollback-safe replacement"
    });

    expect(created.status).toBe("draft");
    expect(repository.read("draft-1")).toMatchObject({
      id: "draft-1",
      status: "retired",
      createdBy: "operator-1",
      updatedBy: "operator-4",
      versionNumber: 1
    });
    expect(updated).toMatchObject({
      versionId: "simple-config-draft-v2",
      updatedBy: "operator-2",
      metadata: { reason: "tighten max bet" }
    });
    expect(activeOne).toMatchObject({
      status: "active",
      versionNumber: 1,
      activatedBy: "operator-3",
      metadata: { reason: "tighten max bet", activationReason: "approved launch config" }
    });
    expect(activeTwo).toMatchObject({
      status: "active",
      versionNumber: 2,
      activatedBy: "operator-4"
    });
    expect(repository.getActiveConfig()).toMatchObject({
      versionId: "simple-config-draft-v3",
      limits: { maxBet: 50 }
    });
    expect(repository.list()).toHaveLength(2);
  });

  it("enforces active immutability, active uniqueness, and unique version IDs", () => {
    const repository = new InMemoryGameConfigurationRepository();
    repository.createDraft({ id: "draft-1", config: simpleConfig, actor: "operator-1" });
    repository.activateDraft({ id: "draft-1", actor: "operator-1" });

    expect(() => repository.updateDraft({
      id: "draft-1",
      config: { ...simpleConfig, versionId: "simple-config-active-edit" },
      actor: "operator-2"
    })).toThrow("Only draft configurations can be updated.");

    expect(() => repository.createDraft({
      id: "draft-2",
      config: simpleConfig,
      actor: "operator-2"
    })).toThrow("Configuration version ID must be unique.");

    repository.createDraft({
      id: "draft-3",
      config: { ...simpleConfig, versionId: "simple-config-v2" },
      actor: "operator-3"
    });
    repository.activateDraft({ id: "draft-3", actor: "operator-3" });

    const activeRecords = repository.list().filter((record) => record.status === "active");
    expect(activeRecords).toHaveLength(1);
    expect(activeRecords[0]).toMatchObject({ id: "draft-3", versionNumber: 2 });
  });

  it("documents reversible migration and database-level integrity constraints", async () => {
    const migration = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../db/migrations/0001_game_configurations.sql", import.meta.url), "utf8")
    );

    expect(migration).toContain("-- migrate:up");
    expect(migration).toContain("-- migrate:down");
    expect(migration).toContain("CREATE TYPE game_config_status AS ENUM ('draft', 'active', 'retired')");
    expect(migration).toContain("CREATE UNIQUE INDEX game_config_versions_one_active");
    expect(migration).toContain("WHERE status = 'active'");
    expect(migration).toContain("CREATE TRIGGER game_config_versions_status_transition");
    expect(migration).toContain("DROP TRIGGER IF EXISTS game_config_versions_status_transition");
  });
});
