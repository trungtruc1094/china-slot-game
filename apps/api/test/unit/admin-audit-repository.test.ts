import { describe, expect, it } from "vitest";
import { InMemoryAdminAuditRepository } from "../../src/domain/admin-audit-repository.js";
import { InMemoryAlertRepository } from "../../src/domain/alert-repository.js";
import { InMemoryBudgetProtectionRepository } from "../../src/domain/budget-protection-repository.js";
import { InMemoryGameConfigurationRepository } from "../../src/domain/game-configuration-repository.js";
import { InMemoryOperatorLimitsRepository, type OperatorLimits } from "../../src/domain/operator-limits-repository.js";
import type { Clock } from "../../src/domain/session-service.js";
import { simpleConfig } from "../fixtures/simple-config.js";

class FixedClock implements Clock {
  public now(): Date {
    return new Date("2026-06-18T08:00:00.000Z");
  }
}

const validLimits: OperatorLimits = {
  currency: "credits",
  perSpin: {
    minBet: 1,
    maxBet: 10,
    maxPayout: 100
  },
  perSession: {
    maxSpins: 100,
    maxWager: 500
  },
  perDay: {
    playerMaxWager: 500,
    playerMaxReward: 500
  },
  campaign: {
    budget: 1000,
    jackpotCap: 500
  }
};

describe("unified admin audit repository", () => {
  it("is append-only from the public repository contract", () => {
    const auditRepository = new InMemoryAdminAuditRepository(new FixedClock());

    auditRepository.record({
      actor: "operator-1",
      role: "operator",
      action: "admin.test",
      resource: { type: "test", id: "one" },
      source: "admin-api",
      outcome: "succeeded"
    });

    expect(auditRepository.list()).toHaveLength(1);
    expect("update" in auditRepository).toBe(false);
    expect("delete" in auditRepository).toBe(false);
  });

  it("records migrated config activation events in the unified shape", () => {
    const auditRepository = new InMemoryAdminAuditRepository(new FixedClock());
    const configRepository = new InMemoryGameConfigurationRepository(new FixedClock(), auditRepository);

    configRepository.createDraft({ id: "draft-audit", config: simpleConfig, actor: "operator-1" });
    configRepository.activateDraft({ id: "draft-audit", actor: "operator-1", reason: "launch" });

    expect(auditRepository.list()).toContainEqual(expect.objectContaining({
      actor: "operator-1",
      role: "operator",
      action: "config.activate",
      resource: { type: "config_version", id: "draft-audit" },
      reason: "launch",
      source: "config",
      outcome: "succeeded",
      occurredAt: new Date("2026-06-18T08:00:00.000Z")
    }));
  });

  it("records migrated operator limit changes in the unified shape", () => {
    const auditRepository = new InMemoryAdminAuditRepository(new FixedClock());
    const limitsRepository = new InMemoryOperatorLimitsRepository(new FixedClock(), auditRepository);

    limitsRepository.create({ scopeId: "default", limits: validLimits, actor: "operator-1", reason: "cap campaign" });

    expect(auditRepository.list()).toContainEqual(expect.objectContaining({
      action: "operator_limits.create",
      resource: { type: "operator_limits", id: "default-limits-v1" },
      source: "operator-limits",
      after: expect.objectContaining({ version: 1, status: "active" })
    }));
  });

  it("records migrated alert fires in the unified shape", () => {
    const auditRepository = new InMemoryAdminAuditRepository(new FixedClock());
    const alertRepository = new InMemoryAlertRepository(new FixedClock(), auditRepository);

    alertRepository.appendEvent({
      ruleId: "rule-1",
      scopeId: "default",
      evaluationKey: "rule-1|window",
      status: "firing",
      metric: "observedRtpAbove",
      metricValue: 1.5,
      threshold: 1.2,
      windowStartAt: null,
      windowEndAt: null,
      severity: "critical",
      suggestedAction: "pause campaign",
      actor: "alert-service"
    });

    expect(auditRepository.list()).toContainEqual(expect.objectContaining({
      actor: "alert-service",
      role: "system",
      action: "alert.firing",
      resource: { type: "alert", id: "alert_1" },
      source: "alerts",
      after: expect.objectContaining({ status: "firing", severity: "critical" })
    }));
  });

  it("records migrated budget-protection actions in the unified shape", () => {
    const auditRepository = new InMemoryAdminAuditRepository(new FixedClock());
    const budgetProtectionRepository = new InMemoryBudgetProtectionRepository(new FixedClock(), auditRepository);

    budgetProtectionRepository.apply({
      scopeId: "default",
      action: "pauseCampaign",
      actor: "operator-1",
      reason: "budget alert"
    });

    expect(auditRepository.list()).toContainEqual(expect.objectContaining({
      action: "budget_protection.apply",
      resource: { type: "budget_protection_action", id: "budget_protection_1" },
      source: "budget-protection",
      reason: "budget alert",
      after: expect.objectContaining({ action: "pauseCampaign", status: "active" })
    }));
  });
});
