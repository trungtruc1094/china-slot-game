import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryOperatorLimitsRepository, type OperatorLimits } from "../../src/domain/operator-limits-repository.js";
import type { Clock } from "../../src/domain/session-service.js";
import type { ApiEnvelope } from "../../src/schemas/api-envelope.js";

class MutableClock implements Clock {
  public current = new Date("2026-06-18T08:00:00.000Z");
  public now(): Date {
    return this.current;
  }
}

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let clock: MutableClock;
let operatorLimitsRepository: InMemoryOperatorLimitsRepository;

const validLimits: OperatorLimits = {
  currency: "POINTS",
  perSpin: {
    minBet: 1,
    maxBet: 25,
    maxPayout: 200
  },
  perSession: {
    maxSpins: 100,
    maxWager: 500
  },
  perDay: {
    playerMaxWager: 1_000,
    playerMaxReward: 400
  },
  campaign: {
    budget: 10_000,
    jackpotCap: 500
  }
};

beforeEach(async () => {
  clock = new MutableClock();
  operatorLimitsRepository = new InMemoryOperatorLimitsRepository(clock);
  server = createServer(createApp({ clock, operatorLimitsRepository }));
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

function adminHeaders(role = "operator", actor = "operator-1"): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-admin-role": role,
    "x-admin-actor": actor,
    "x-request-id": "req_operator_limits_test"
  };
}

async function createLimits(limits = validLimits): Promise<Response> {
  return fetch(`${baseUrl}/api/admin/operator-limits`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ scopeId: "campaign-1", limits, reason: "launch limits" })
  });
}

describe("admin operator limit routes", () => {
  it("lets operators create, update, and fetch active limits with explicit units", async () => {
    const createdResponse = await createLimits();
    const createdBody = await createdResponse.json() as ApiEnvelope<{ operatorLimits: Record<string, unknown> }>;
    clock.current = new Date("2026-06-18T08:15:00.000Z");

    const updatedLimits: OperatorLimits = {
      ...validLimits,
      perSpin: { ...validLimits.perSpin, maxBet: 20 },
      campaign: { ...validLimits.campaign, budget: 9_000 }
    };
    const updatedResponse = await fetch(`${baseUrl}/api/admin/operator-limits/campaign-1`, {
      method: "PUT",
      headers: adminHeaders("operator", "operator-2"),
      body: JSON.stringify({ limits: updatedLimits, reason: "reduce exposure" })
    });
    const activeResponse = await fetch(`${baseUrl}/api/admin/operator-limits/active?scopeId=campaign-1`, {
      headers: adminHeaders("viewer", "viewer-1")
    });
    const listResponse = await fetch(`${baseUrl}/api/admin/operator-limits?scopeId=campaign-1`, {
      headers: adminHeaders("support", "support-1")
    });
    const updatedBody = await updatedResponse.json() as ApiEnvelope<{ operatorLimits: Record<string, unknown> }>;
    const activeBody = await activeResponse.json() as ApiEnvelope<{ operatorLimits: Record<string, unknown> }>;
    const listBody = await listResponse.json() as ApiEnvelope<{ operatorLimits: Array<Record<string, unknown>> }>;

    expect(createdResponse.status).toBe(201);
    expect(createdBody.data?.operatorLimits).toMatchObject({
      id: "campaign-1-limits-v1",
      scopeId: "campaign-1",
      version: 1,
      status: "active",
      limits: validLimits,
      createdBy: "operator-1"
    });
    expect(updatedResponse.status).toBe(200);
    expect(updatedBody.data?.operatorLimits).toMatchObject({
      id: "campaign-1-limits-v2",
      version: 2,
      status: "active",
      updatedBy: "operator-2",
      limits: updatedLimits,
      updatedAt: "2026-06-18T08:15:00.000Z"
    });
    expect(activeBody.data?.operatorLimits).toMatchObject({
      id: "campaign-1-limits-v2",
      limits: updatedLimits
    });
    expect(listBody.data?.operatorLimits).toMatchObject([
      { id: "campaign-1-limits-v1", status: "retired" },
      { id: "campaign-1-limits-v2", status: "active" }
    ]);
  });

  it("rejects impossible limit combinations before storage", async () => {
    const response = await createLimits({
      ...validLimits,
      perSpin: { ...validLimits.perSpin, minBet: 30, maxBet: 20 },
      campaign: { ...validLimits.campaign, jackpotCap: 20_000 }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "INVALID_OPERATOR_LIMITS" }
    });
    expect(operatorLimitsRepository.list("campaign-1")).toEqual([]);
  });

  it("blocks unauthorized writes and records audit events for version changes", async () => {
    const viewerResponse = await fetch(`${baseUrl}/api/admin/operator-limits`, {
      method: "POST",
      headers: adminHeaders("viewer", "viewer-1"),
      body: JSON.stringify({ scopeId: "campaign-1", limits: validLimits })
    });
    await createLimits();
    await fetch(`${baseUrl}/api/admin/operator-limits/campaign-1`, {
      method: "PUT",
      headers: adminHeaders("operator", "operator-2"),
      body: JSON.stringify({ limits: { ...validLimits, perDay: { ...validLimits.perDay, playerMaxReward: 350 } } })
    });
    const auditResponse = await fetch(`${baseUrl}/api/admin/operator-limits/audit-events`, {
      headers: adminHeaders("support", "support-1")
    });
    const auditBody = await auditResponse.json() as ApiEnvelope<{ auditEvents: Array<Record<string, unknown>> }>;

    expect(viewerResponse.status).toBe(403);
    await expect(viewerResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "ADMIN_FORBIDDEN" }
    });
    expect(auditBody.data?.auditEvents).toMatchObject([
      {
        action: "operator_limits.create",
        actor: "operator-1",
        targetId: "campaign-1-limits-v1",
        reason: "launch limits",
        metadata: { version: 1, previousActiveVersion: null }
      },
      {
        action: "operator_limits.update",
        actor: "operator-2",
        targetId: "campaign-1-limits-v2",
        metadata: { version: 2, previousActiveVersion: 1, previousActiveId: "campaign-1-limits-v1" }
      }
    ]);
  });
});
