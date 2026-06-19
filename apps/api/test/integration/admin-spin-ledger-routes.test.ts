import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryPlayerIdentityAdapter } from "../../src/domain/player-identity.js";
import { SessionService, type Clock } from "../../src/domain/session-service.js";
import { SpinService } from "../../src/domain/spin-service.js";
import { WalletService } from "../../src/domain/wallet-service.js";
import type { ApiEnvelope } from "../../src/schemas/api-envelope.js";
import { simpleConfig } from "../fixtures/simple-config.js";

class MutableClock implements Clock {
  public current = new Date("2026-06-18T08:00:00.000Z");
  public now(): Date {
    return this.current;
  }
}

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let clock: MutableClock;

beforeEach(async () => {
  clock = new MutableClock();
  const sessionService = new SessionService(new InMemoryPlayerIdentityAdapter(), clock);
  const walletService = new WalletService(clock);
  const spinService = new SpinService(
    sessionService,
    walletService,
    { activeConfig: simpleConfig, nextRandom: () => 0 },
    clock
  );
  server = createServer(createApp({ clock, sessionService, walletService, spinService }));
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

function adminHeaders(role = "support", actor = "support-1"): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-admin-role": role,
    "x-admin-actor": actor,
    "x-request-id": "req_spin_ledger_test"
  };
}

async function createSession(subject: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identity: {
        provider: "demo",
        subject,
        expiresAt: "2026-06-18T09:00:00.000Z"
      }
    })
  });
  const body = await response.json() as ApiEnvelope<{ sessionId: string }>;
  return body.data?.sessionId ?? "";
}

async function postSpin(sessionId: string, clientSpinId: string): Promise<void> {
  await fetch(`${baseUrl}/api/spins`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientSpinId,
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    })
  });
}

describe("admin spin ledger search", () => {
  it("searches accepted spins with bounded pagination and minimized player fields", async () => {
    const firstSessionId = await createSession("player-a");
    await postSpin(firstSessionId, "spin-a-1");
    clock.current = new Date("2026-06-18T08:05:00.000Z");
    await postSpin(firstSessionId, "spin-a-2");
    const secondSessionId = await createSession("player-b");
    clock.current = new Date("2026-06-18T08:10:00.000Z");
    await postSpin(secondSessionId, "spin-b-1");

    const response = await fetch(
      `${baseUrl}/api/admin/spins?playerId=player_1&transactionType=credit&limit=1&offset=1`,
      { headers: adminHeaders() }
    );
    const body = await response.json() as ApiEnvelope<{
      rewardModel: Record<string, unknown>;
      records: Array<Record<string, unknown>>;
      page: Record<string, unknown>;
    }>;

    expect(response.status).toBe(200);
    expect(body.data?.page).toEqual({ limit: 1, offset: 1, total: 2, hasMore: false });
    expect(body.data?.rewardModel).toMatchObject({
      mode: "mvp_non_cash",
      unit: "points",
      cashEquivalent: false,
      redemptionEnabled: false,
      cashOutEnabled: false,
      cryptoEnabled: false
    });
    expect(body.data?.records).toHaveLength(1);
    expect(body.data?.records[0]).toMatchObject({
      spinId: "spin_1",
      sessionId: firstSessionId,
      playerId: "player_1",
      configVersionId: "simple-config-v1",
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 },
      reelStops: [
        { reelIndex: 0, stopIndex: 0 },
        { reelIndex: 1, stopIndex: 0 },
        { reelIndex: 2, stopIndex: 0 }
      ],
      payout: 5,
      balanceBefore: 1000,
      balanceAfter: 1004,
      rewardModel: {
        mode: "mvp_non_cash",
        unit: "points",
        cashEquivalent: false,
        redemptionEnabled: false,
        cashOutEnabled: false,
        cryptoEnabled: false
      },
      transactionTypes: ["debit", "credit"],
      acceptedAt: "2026-06-18T08:00:00.000Z"
    });
    expect(body.data?.records[0]).not.toHaveProperty("identity");
    expect(body.data?.records[0]).not.toHaveProperty("providerSubject");
  });

  it("validates malformed query parameters", async () => {
    const response = await fetch(`${baseUrl}/api/admin/spins?limit=500&from=not-a-date`, {
      headers: adminHeaders()
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "INVALID_SPIN_LEDGER_QUERY" }
    });
  });

  it("requires a support-capable admin role", async () => {
    const viewerResponse = await fetch(`${baseUrl}/api/admin/spins`, {
      headers: adminHeaders("viewer", "viewer-1")
    });
    const missingRoleResponse = await fetch(`${baseUrl}/api/admin/spins`);

    expect(viewerResponse.status).toBe(403);
    await expect(viewerResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "ADMIN_FORBIDDEN" }
    });
    expect(missingRoleResponse.status).toBe(401);
  });
});
