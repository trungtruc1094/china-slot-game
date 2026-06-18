import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryGameConfigurationRepository } from "../../src/domain/game-configuration-repository.js";
import { InMemoryOperatorLimitsRepository, type OperatorLimits } from "../../src/domain/operator-limits-repository.js";
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

const operatorLimits: OperatorLimits = {
  currency: "POINTS",
  perSpin: { minBet: 1, maxBet: 10, maxPayout: 10 },
  perSession: { maxSpins: 100, maxWager: 100 },
  perDay: { playerMaxWager: 100, playerMaxReward: 100 },
  campaign: { budget: 100, jackpotCap: 100 }
};

beforeEach(async () => {
  clock = new MutableClock();
  const playerIdentity = new InMemoryPlayerIdentityAdapter();
  const sessionService = new SessionService(playerIdentity, clock);
  const walletService = new WalletService(clock);
  const configRepository = new InMemoryGameConfigurationRepository(clock);
  configRepository.createDraft({ id: "metrics-config", config: simpleConfig, actor: "operator-1" });
  configRepository.activateDraft({ id: "metrics-config", actor: "operator-1" });
  const operatorLimitsRepository = new InMemoryOperatorLimitsRepository(clock);
  operatorLimitsRepository.create({ scopeId: "default", limits: operatorLimits, actor: "operator-1" });
  const randomValues = [0, 0, 0, 0.9, 0.9, 0.9];
  const spinService = new SpinService(
    sessionService,
    walletService,
    {
      configProvider: configRepository,
      operatorLimitsProvider: operatorLimitsRepository,
      nextRandom: () => randomValues.shift() ?? 0
    },
    clock
  );
  server = createServer(createApp({
    clock,
    configRepository,
    operatorLimitsRepository,
    sessionService,
    walletService,
    spinService
  }));
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
    "x-request-id": "req_admin_metrics_test"
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

async function postSpin(sessionId: string, clientSpinId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/spins`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientSpinId,
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    })
  });
}

describe("admin metrics routes", () => {
  it("aggregates metrics from accepted spin ledger rows with UTC window and config filters", async () => {
    const firstSessionId = await createSession("player-a");
    clock.current = new Date("2026-06-18T08:01:00.000Z");
    await postSpin(firstSessionId, "metrics-winning-spin");
    const secondSessionId = await createSession("player-b");
    clock.current = new Date("2026-06-18T08:02:00.000Z");
    await postSpin(secondSessionId, "metrics-losing-spin");

    const response = await fetch(
      `${baseUrl}/api/admin/metrics?from=2026-06-18T08:00:00.000Z&to=2026-06-18T08:03:00.000Z&configVersionId=simple-config-v1&scopeId=default`,
      { headers: adminHeaders("viewer", "viewer-1") }
    );
    const body = await response.json() as ApiEnvelope<{ metrics: Record<string, unknown> }>;
    const filteredResponse = await fetch(
      `${baseUrl}/api/admin/metrics?from=2026-06-18T08:01:30.000Z&to=2026-06-18T08:03:00.000Z&configVersionId=simple-config-v1`,
      { headers: adminHeaders("support", "support-1") }
    );
    const filteredBody = await filteredResponse.json() as ApiEnvelope<{ metrics: Record<string, unknown> }>;

    expect(response.status).toBe(200);
    expect(body.data?.metrics).toMatchObject({
      totalWagered: 2,
      totalPaid: 5,
      observedRtp: 2.5,
      hitRate: 0.5,
      playerCount: 2,
      activeSessions: 2,
      jackpotLiability: 0,
      remainingBudget: 95,
      alertState: "none",
      filters: {
        from: "2026-06-18T08:00:00.000Z",
        to: "2026-06-18T08:03:00.000Z",
        configVersionId: "simple-config-v1",
        scopeId: "default"
      },
      bucket: {
        timezone: "UTC",
        sizeSeconds: 60
      }
    });
    expect(body.data?.metrics.theoreticalRtp).toEqual(expect.any(Number));
    expect(filteredBody.data?.metrics).toMatchObject({
      totalWagered: 1,
      totalPaid: 0,
      observedRtp: 0,
      hitRate: 0,
      playerCount: 1,
      activeSessions: 1,
      remainingBudget: 100
    });
  });

  it("rejects invalid metric windows and unauthorized requests", async () => {
    const invalidWindowResponse = await fetch(
      `${baseUrl}/api/admin/metrics?from=2026-06-18T08:03:00.000Z&to=2026-06-18T08:00:00.000Z`,
      { headers: adminHeaders("operator", "operator-1") }
    );
    const unauthorizedResponse = await fetch(`${baseUrl}/api/admin/metrics`);

    expect(invalidWindowResponse.status).toBe(400);
    await expect(invalidWindowResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "INVALID_METRICS_QUERY" }
    });
    expect(unauthorizedResponse.status).toBe(403);
    await expect(unauthorizedResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "ADMIN_UNAUTHORIZED" }
    });
  });
});
