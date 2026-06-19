import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryAdminAuditRepository } from "../../src/domain/admin-audit-repository.js";
import type { Clock } from "../../src/domain/session-service.js";
import type { ApiEnvelope } from "../../src/schemas/api-envelope.js";

class MutableClock implements Clock {
  public current = new Date("2026-06-19T08:00:00.000Z");

  public now(): Date {
    return this.current;
  }
}

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let clock: MutableClock;
let auditRepository: InMemoryAdminAuditRepository;

beforeEach(async () => {
  clock = new MutableClock();
  auditRepository = new InMemoryAdminAuditRepository(clock);
  server = createServer(createApp({ clock, adminAuditRepository: auditRepository }));
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

describe("reward boundary routes", () => {
  it("returns non-cash reward metadata with redemption and cash-out disabled by default", async () => {
    const response = await fetch(`${baseUrl}/api/reward-boundary`, {
      headers: { "x-request-id": "req_reward_metadata_test" }
    });
    const body = await response.json() as ApiEnvelope<{
      rewardModel: Record<string, unknown>;
      allowedRewardTypes: string[];
      deniedRewardTypes: string[];
    }>;

    expect(response.status).toBe(200);
    expect(body.requestId).toBe("req_reward_metadata_test");
    expect(body.error).toBeNull();
    expect(body.data?.rewardModel).toMatchObject({
      mode: "mvp_non_cash",
      unit: "points",
      displayLabel: "Points",
      cashEquivalent: false,
      redemptionEnabled: false,
      cashOutEnabled: false,
      cryptoEnabled: false
    });
    expect(body.data?.allowedRewardTypes).toEqual(["points", "credits", "community_perk"]);
    expect(body.data?.deniedRewardTypes).toEqual(expect.arrayContaining([
      "cash",
      "cash_equivalent",
      "crypto",
      "cash_out",
      "redeemable_prize"
    ]));
  });

  it("rejects cash-equivalent reward requests server-side", async () => {
    const response = await fetch(`${baseUrl}/api/reward-boundary/validate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_reward_cash_test"
      },
      body: JSON.stringify({ rewardType: "cash_equivalent" })
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: {
        code: "REWARD_TYPE_FORBIDDEN",
        message: "Cash-equivalent or redeemable rewards are disabled for MVP launch."
      },
      requestId: "req_reward_cash_test"
    });
  });

  it("emits a unified audit event when rejecting cash-equivalent reward requests", async () => {
    const response = await fetch(`${baseUrl}/api/reward-boundary/validate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_reward_audit_test"
      },
      body: JSON.stringify({ rewardType: "crypto" })
    });

    expect(response.status).toBe(403);
    expect(auditRepository.list()).toEqual([
      expect.objectContaining({
        actor: "system",
        role: "system",
        action: "reward_boundary.reject",
        resource: { type: "reward_type", id: "crypto" },
        requestId: "req_reward_audit_test",
        reason: "cash-equivalent reward type is disabled",
        source: "reward-boundary",
        outcome: "failed",
        metadata: expect.objectContaining({
          rewardType: "crypto",
          boundaryMode: "mvp_non_cash"
        })
      })
    ]);
  });

  it("rejects cash-equivalent aliases with the same audited forbidden path", async () => {
    const response = await fetch(`${baseUrl}/api/reward-boundary/validate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_reward_alias_test"
      },
      body: JSON.stringify({ rewardType: "cash-out" })
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: {
        code: "REWARD_TYPE_FORBIDDEN",
        details: { rewardType: "cash_out" }
      },
      requestId: "req_reward_alias_test"
    });
    expect(auditRepository.list()).toEqual([
      expect.objectContaining({
        action: "reward_boundary.reject",
        resource: { type: "reward_type", id: "cash_out" },
        requestId: "req_reward_alias_test",
        source: "reward-boundary",
        outcome: "failed",
        metadata: expect.objectContaining({ rewardType: "cash_out" })
      })
    ]);
  });

  it("strips unknown client fields so redemption cannot be enabled by request payload", async () => {
    const response = await fetch(`${baseUrl}/api/reward-boundary/validate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_reward_strip_test"
      },
      body: JSON.stringify({
        rewardType: "points",
        redemptionEnabled: true,
        cashOutEnabled: true,
        complianceApproved: true
      })
    });
    const body = await response.json() as ApiEnvelope<{
      rewardType: string;
      allowed: boolean;
      rewardModel: Record<string, unknown>;
    }>;

    expect(response.status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.data).toMatchObject({
      rewardType: "points",
      allowed: true,
      rewardModel: {
        redemptionEnabled: false,
        cashOutEnabled: false,
        cashEquivalent: false
      }
    });
    expect(body.data).not.toHaveProperty("complianceApproved");
  });
});
