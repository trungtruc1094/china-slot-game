import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryGameConfigurationRepository } from "../../src/domain/game-configuration-repository.js";
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
let configRepository: InMemoryGameConfigurationRepository;

beforeEach(async () => {
  clock = new MutableClock();
  configRepository = new InMemoryGameConfigurationRepository(clock);
  const sessionService = new SessionService(new InMemoryPlayerIdentityAdapter(), clock);
  const walletService = new WalletService(clock);
  const spinService = new SpinService(
    sessionService,
    walletService,
    { configProvider: configRepository, nextRandom: () => 0 },
    clock
  );
  server = createServer(createApp({
    clock,
    configRepository,
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
    "x-request-id": "req_admin_config_test"
  };
}

async function createDraft(id: string, config: unknown = simpleConfig, reason = "initial tuning"): Promise<Response> {
  return fetch(`${baseUrl}/api/admin/configs/drafts`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ id, config, reason })
  });
}

async function createSession(): Promise<string> {
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identity: {
        provider: "demo",
        subject: "player-123",
        expiresAt: "2026-06-18T09:00:00.000Z"
      }
    })
  });
  const body = await response.json() as ApiEnvelope<{ sessionId: string }>;
  return body.data?.sessionId ?? "";
}

describe("admin config draft routes", () => {
  it("lets operators create, update, fetch, and list draft configurations with audit metadata", async () => {
    const createdResponse = await createDraft("draft-api-1");
    const createdBody = await createdResponse.json() as ApiEnvelope<{ draft: Record<string, unknown> }>;
    clock.current = new Date("2026-06-18T08:10:00.000Z");

    const updatedConfig = {
      ...simpleConfig,
      versionId: "simple-config-draft-api-v2",
      limits: { ...simpleConfig.limits, maxBet: 25 }
    };
    const updatedResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-api-1`, {
      method: "PUT",
      headers: adminHeaders("operator", "operator-2"),
      body: JSON.stringify({ config: updatedConfig, reason: "lower max bet" })
    });
    const fetchedResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-api-1`, {
      headers: adminHeaders("viewer", "viewer-1")
    });
    const listedResponse = await fetch(`${baseUrl}/api/admin/configs/drafts`, {
      headers: adminHeaders("support", "support-1")
    });
    const updatedBody = await updatedResponse.json() as ApiEnvelope<{ draft: Record<string, unknown> }>;
    const fetchedBody = await fetchedResponse.json() as ApiEnvelope<{ draft: Record<string, unknown> }>;
    const listedBody = await listedResponse.json() as ApiEnvelope<{ drafts: Array<Record<string, unknown>> }>;

    expect(createdResponse.status).toBe(201);
    expect(createdBody.data?.draft).toMatchObject({
      id: "draft-api-1",
      status: "draft",
      createdBy: "operator-1",
      updatedBy: "operator-1",
      metadata: { reason: "initial tuning" }
    });
    expect(updatedResponse.status).toBe(200);
    expect(updatedBody.data?.draft).toMatchObject({
      id: "draft-api-1",
      status: "draft",
      versionId: "simple-config-draft-api-v2",
      updatedBy: "operator-2",
      updatedAt: "2026-06-18T08:10:00.000Z",
      metadata: { reason: "lower max bet" }
    });
    expect(fetchedBody.data?.draft).toMatchObject({ id: "draft-api-1", versionId: "simple-config-draft-api-v2" });
    expect(listedBody.data?.drafts).toHaveLength(1);
    expect(listedBody.data?.drafts[0]).toMatchObject({ id: "draft-api-1" });
  });

  it("rejects malformed reel strips, paytables, scatter rules, jackpot rules, and limits", async () => {
    const malformedConfig = {
      ...simpleConfig,
      reels: [{ ...simpleConfig.reels[0], visibleRows: 0, symbols: [] }],
      waysPolicy: { ...simpleConfig.waysPolicy, reels: 5 },
      paytable: [{ ...simpleConfig.paytable[0], symbols: ["A", "A"] }],
      scatterRule: { ...simpleConfig.scatterRule, pays: [{ count: 0, pay: -1, freeSpins: -1 }] },
      jackpotRule: { ...simpleConfig.jackpotRule, requiredVisibleCount: 0, defaultAmount: -1 },
      limits: { ...simpleConfig.limits, minBet: 50, maxBet: 10 }
    };
    const response = await createDraft("draft-malformed", malformedConfig);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "INVALID_CONFIG_DRAFT" }
    });
    expect(configRepository.list()).toEqual([]);
  });

  it("blocks unauthorized users from creating or editing drafts", async () => {
    const createResponse = await fetch(`${baseUrl}/api/admin/configs/drafts`, {
      method: "POST",
      headers: adminHeaders("viewer", "viewer-1"),
      body: JSON.stringify({ id: "draft-viewer", config: simpleConfig })
    });
    await createDraft("draft-api-2");
    const updateResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-api-2`, {
      method: "PUT",
      headers: adminHeaders("support", "support-1"),
      body: JSON.stringify({ config: { ...simpleConfig, versionId: "simple-config-support-edit" } })
    });

    expect(createResponse.status).toBe(403);
    expect(updateResponse.status).toBe(403);
    await expect(createResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "ADMIN_FORBIDDEN" }
    });
    await expect(updateResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "ADMIN_FORBIDDEN" }
    });
  });

  it("admin draft configs are ignored by the live spin endpoint", async () => {
    await createDraft("draft-active");
    configRepository.activateDraft({ id: "draft-active", actor: "operator-1" });
    await createDraft("draft-not-live", {
      ...simpleConfig,
      versionId: "simple-config-draft-high-pay",
      paytable: [
        { id: "a-3", symbols: ["A", "A", "A", "any", "any"], pay: 500, freeSpins: 0 }
      ]
    });

    const sessionId = await createSession();
    const response = await fetch(`${baseUrl}/api/spins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientSpinId: "spin-draft-isolation",
        sessionId,
        wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
      })
    });
    const body = await response.json() as ApiEnvelope<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      configVersionId: "simple-config-v1",
      payout: 5,
      balanceAfter: 1004
    });
  });
});
