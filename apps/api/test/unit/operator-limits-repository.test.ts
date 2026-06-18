import { describe, expect, it } from "vitest";
import { InMemoryOperatorLimitsRepository, type OperatorLimits } from "../../src/domain/operator-limits-repository.js";
import type { Clock } from "../../src/domain/session-service.js";

class FixedClock implements Clock {
  public now(): Date {
    return new Date("2026-06-18T08:00:00.000Z");
  }
}

const limits: OperatorLimits = {
  currency: "POINTS",
  perSpin: { minBet: 1, maxBet: 10, maxPayout: 100 },
  perSession: { maxSpins: 50, maxWager: 250 },
  perDay: { playerMaxWager: 500, playerMaxReward: 200 },
  campaign: { budget: 1_000, jackpotCap: 300 }
};

describe("InMemoryOperatorLimitsRepository", () => {
  it("versions active limits and protects stored records from caller mutation", () => {
    const repository = new InMemoryOperatorLimitsRepository(new FixedClock());
    const created = repository.create({ scopeId: "campaign-1", limits, actor: "operator-1" });
    const updated = repository.update({
      scopeId: "campaign-1",
      limits: { ...limits, perSpin: { ...limits.perSpin, maxBet: 8 } },
      actor: "operator-2"
    });
    updated.limits.perSpin.maxBet = 999;

    expect(created).toMatchObject({ version: 1, status: "active" });
    expect(repository.getActiveLimits("campaign-1")).toMatchObject({
      id: "campaign-1-limits-v2",
      version: 2,
      status: "active",
      limits: { perSpin: { maxBet: 8 } }
    });
    expect(repository.list("campaign-1")).toMatchObject([
      { id: "campaign-1-limits-v1", status: "retired" },
      { id: "campaign-1-limits-v2", status: "active" }
    ]);
  });

  it("rejects duplicate active creation and impossible combinations", () => {
    const repository = new InMemoryOperatorLimitsRepository(new FixedClock());
    repository.create({ scopeId: "campaign-1", limits, actor: "operator-1" });

    expect(() => repository.create({ scopeId: "campaign-1", limits, actor: "operator-1" })).toThrowError("Active operator limits already exist");
    expect(() => repository.update({
      scopeId: "campaign-1",
      limits: { ...limits, perSpin: { ...limits.perSpin, maxPayout: 400 } },
      actor: "operator-1"
    })).toThrowError("perSpin.maxPayout cannot exceed campaign.jackpotCap");
  });
});
