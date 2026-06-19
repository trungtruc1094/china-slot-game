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
let walletService: WalletService;

beforeEach(async () => {
  clock = new MutableClock();
  const sessionService = new SessionService(new InMemoryPlayerIdentityAdapter(), clock);
  walletService = new WalletService(clock);
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
    "x-request-id": "req_balance_transactions_test"
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

describe("admin balance transaction search", () => {
  it("returns bounded transaction history that reconciles with wallet records", async () => {
    const sessionId = await createSession("player-a");
    await postSpin(sessionId, "spin-a-1");
    clock.current = new Date("2026-06-18T08:05:00.000Z");
    await postSpin(sessionId, "spin-a-2");

    const response = await fetch(
      `${baseUrl}/api/admin/balance-transactions?playerId=player_1&sessionId=${sessionId}&transactionType=credit&limit=1`,
      { headers: adminHeaders() }
    );
    const body = await response.json() as ApiEnvelope<{
      records: Array<Record<string, unknown>>;
      page: Record<string, unknown>;
    }>;
    const walletCredits = walletService.getTransactions("player_1")
      .filter((transaction) => transaction.source === sessionId && transaction.type === "credit")
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

    expect(response.status).toBe(200);
    expect(body.data?.page).toEqual({ limit: 1, offset: 0, total: 2, hasMore: true });
    expect(body.data?.records).toHaveLength(1);
    expect(body.data?.records[0]).toMatchObject({
      transactionId: walletCredits[0]?.transactionId,
      playerId: "player_1",
      transactionType: "credit",
      amount: walletCredits[0]?.amount,
      balanceBefore: walletCredits[0]?.balanceBefore,
      balanceAfter: walletCredits[0]?.balanceAfter,
      actor: "spin-service",
      source: sessionId,
      sessionId,
      spinId: "spin_2",
      createdAt: "2026-06-18T08:05:00.000Z",
      metadata: { spinId: "spin_2", clientSpinId: "spin-a-2" }
    });
    expect(body.data?.records[0]).not.toHaveProperty("identity");
    expect(body.data?.records[0]).not.toHaveProperty("providerSubject");
  });

  it("validates malformed query parameters", async () => {
    const response = await fetch(`${baseUrl}/api/admin/balance-transactions?offset=-1&to=not-a-date`, {
      headers: adminHeaders()
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "INVALID_BALANCE_TRANSACTION_QUERY" }
    });
  });

  it("requires a support-capable admin role", async () => {
    const viewerResponse = await fetch(`${baseUrl}/api/admin/balance-transactions`, {
      headers: adminHeaders("viewer", "viewer-1")
    });
    const missingRoleResponse = await fetch(`${baseUrl}/api/admin/balance-transactions`);

    expect(viewerResponse.status).toBe(403);
    await expect(viewerResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "ADMIN_FORBIDDEN" }
    });
    expect(missingRoleResponse.status).toBe(401);
  });
});
