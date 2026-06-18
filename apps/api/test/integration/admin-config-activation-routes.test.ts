import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GameConfiguration } from "@china-slot-game/game-math";
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
let configRepository: InMemoryGameConfigurationRepository;
let spinService: SpinService;

beforeEach(async () => {
  const clock = new MutableClock();
  configRepository = new InMemoryGameConfigurationRepository(clock);
  const sessionService = new SessionService(new InMemoryPlayerIdentityAdapter(), clock);
  const walletService = new WalletService(clock);
  spinService = new SpinService(
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
    "x-request-id": "req_admin_activation_test"
  };
}

async function prepareDraft(id: string, config: GameConfiguration): Promise<void> {
  const draftResponse = await fetch(`${baseUrl}/api/admin/configs/drafts`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ id, config })
  });
  expect(draftResponse.status).toBe(201);
  const reportResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/${id}/math-report`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ wager: { lineBet: 1, selectedWays: 1, totalWager: 1 } })
  });
  expect(reportResponse.status).toBe(201);
  const simulationResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/${id}/simulations`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ spinCount: 8, seed: `${id}-seed`, wager: { lineBet: 1, selectedWays: 1, totalWager: 1 } })
  });
  expect(simulationResponse.status).toBe(201);
}

async function activateDraft(id: string, reason: string, actor = "operator-1"): Promise<Response> {
  return fetch(`${baseUrl}/api/admin/configs/drafts/${id}/activate`, {
    method: "POST",
    headers: adminHeaders("operator", actor),
    body: JSON.stringify({ reason })
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

async function spin(sessionId: string, clientSpinId: string): Promise<ApiEnvelope<Record<string, unknown>>> {
  const response = await fetch(`${baseUrl}/api/spins`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientSpinId,
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    })
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<ApiEnvelope<Record<string, unknown>>>;
}

describe("admin config activation routes", () => {
  it("atomically activates, rolls back, preserves spin history, and persists audit events", async () => {
    const highPayConfig: GameConfiguration = {
      ...simpleConfig,
      versionId: "simple-config-v2",
      paytable: [
        { id: "a-3", symbols: ["A", "A", "A", "any", "any"], pay: 500, freeSpins: 0 }
      ]
    };
    await prepareDraft("draft-v1", simpleConfig);
    const firstActivation = await activateDraft("draft-v1", "launch version", "operator-1");
    await prepareDraft("draft-v2", highPayConfig);
    const secondActivation = await activateDraft("draft-v2", "high pay test", "operator-2");
    const sessionId = await createSession();
    const highPaySpin = await spin(sessionId, "spin-high-pay");
    const rollbackResponse = await fetch(`${baseUrl}/api/admin/configs/rollback`, {
      method: "POST",
      headers: adminHeaders("operator", "operator-3"),
      body: JSON.stringify({ targetVersionId: "simple-config-v1", reason: "restore prior economics" })
    });
    const rollbackBody = await rollbackResponse.json() as ApiEnvelope<{ activeConfig: Record<string, unknown> }>;
    const restoredSpin = await spin(sessionId, "spin-restored-pay");
    const auditResponse = await fetch(`${baseUrl}/api/admin/configs/audit-events`, {
      headers: adminHeaders("viewer", "viewer-1")
    });
    const auditBody = await auditResponse.json() as ApiEnvelope<{ auditEvents: Array<Record<string, unknown>> }>;

    expect(firstActivation.status).toBe(200);
    expect(secondActivation.status).toBe(200);
    expect(highPaySpin.data).toMatchObject({
      configVersionId: "simple-config-v2",
      payout: 500
    });
    expect(rollbackResponse.status).toBe(200);
    expect(rollbackBody.data?.activeConfig).toMatchObject({
      versionId: "simple-config-v1",
      status: "active"
    });
    expect(restoredSpin.data).toMatchObject({
      configVersionId: "simple-config-v1",
      payout: 5
    });
    expect(configRepository.getActiveConfig()).toEqual(simpleConfig);
    expect(spinService.getLedger()).toMatchObject([
      { spinId: "spin_1", configVersionId: "simple-config-v2", payout: 500 },
      { spinId: "spin_2", configVersionId: "simple-config-v1", payout: 5 }
    ]);
    expect(auditResponse.status).toBe(200);
    expect(auditBody.data?.auditEvents).toMatchObject([
      {
        action: "config.activate",
        actor: "operator-1",
        reason: "launch version",
        metadata: { versionId: "simple-config-v1", mathReportId: "math_report_1" }
      },
      {
        action: "config.activate",
        actor: "operator-2",
        reason: "high pay test",
        metadata: { versionId: "simple-config-v2", mathReportId: "math_report_2" }
      },
      {
        action: "config.rollback",
        actor: "operator-3",
        reason: "restore prior economics",
        metadata: {
          targetVersionId: "simple-config-v1",
          previousActiveVersionId: "simple-config-v2",
          restoredConfig: simpleConfig
        }
      }
    ]);
  });

  it("allows only one concurrent activation attempt to win", async () => {
    await prepareDraft("draft-concurrent", {
      ...simpleConfig,
      versionId: "simple-config-concurrent"
    });

    const responses = await Promise.all([
      activateDraft("draft-concurrent", "first attempt", "operator-1"),
      activateDraft("draft-concurrent", "second attempt", "operator-2")
    ]);
    const statuses = responses.map((response) => response.status).sort();
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(statuses).toEqual([200, 409]);
    expect(bodies).toEqual(expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ activeConfig: expect.objectContaining({ status: "active" }) }) }),
      expect.objectContaining({ data: null, error: expect.objectContaining({ code: "CONFIG_STATUS_CONFLICT" }) })
    ]));
    expect(configRepository.list().filter((record) => record.status === "active")).toHaveLength(1);
  });

  it("requires validation artifacts before activation and operator authorization for rollback", async () => {
    const draftResponse = await fetch(`${baseUrl}/api/admin/configs/drafts`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ id: "draft-unvalidated", config: simpleConfig })
    });
    expect(draftResponse.status).toBe(201);
    const activationResponse = await activateDraft("draft-unvalidated", "missing validation");
    const rollbackResponse = await fetch(`${baseUrl}/api/admin/configs/rollback`, {
      method: "POST",
      headers: adminHeaders("viewer", "viewer-1"),
      body: JSON.stringify({ targetVersionId: "simple-config-v1", reason: "not allowed" })
    });

    expect(activationResponse.status).toBe(404);
    expect(rollbackResponse.status).toBe(403);
    await expect(activationResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "MATH_REPORT_NOT_FOUND" }
    });
    await expect(rollbackResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "ADMIN_UNAUTHORIZED" }
    });
  });
});
