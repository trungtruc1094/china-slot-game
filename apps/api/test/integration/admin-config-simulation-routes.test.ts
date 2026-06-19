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
let configRepository: InMemoryGameConfigurationRepository;
let walletService: WalletService;
let spinService: SpinService;

beforeEach(async () => {
  const clock = new MutableClock();
  configRepository = new InMemoryGameConfigurationRepository(clock);
  const sessionService = new SessionService(new InMemoryPlayerIdentityAdapter(), clock);
  walletService = new WalletService(clock);
  spinService = new SpinService(sessionService, walletService, { configProvider: configRepository }, clock);
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
    "x-request-id": "req_admin_simulation_test"
  };
}

async function createDraftWithMathReport(): Promise<void> {
  const draftResponse = await fetch(`${baseUrl}/api/admin/configs/drafts`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ id: "draft-sim", config: simpleConfig })
  });
  expect(draftResponse.status).toBe(201);
  const reportResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-sim/math-report`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ wager: { lineBet: 1, selectedWays: 1, totalWager: 1 } })
  });
  expect(reportResponse.status).toBe(201);
}

describe("admin config simulation routes", () => {
  it("runs, stores, retrieves, and reproduces a small simulation batch without wallet or spin mutations", async () => {
    await createDraftWithMathReport();
    const requestBody = {
      spinCount: 8,
      seed: "seed-3-4",
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    };
    const firstResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-sim/simulations`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(requestBody)
    });
    const secondResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-sim/simulations`, {
      method: "POST",
      headers: adminHeaders("operator", "operator-2"),
      body: JSON.stringify(requestBody)
    });
    const listResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-sim/simulations`, {
      headers: adminHeaders("viewer", "viewer-1")
    });
    const firstBody = await firstResponse.json() as ApiEnvelope<{ simulationRun: Record<string, unknown> }>;
    const secondBody = await secondResponse.json() as ApiEnvelope<{ simulationRun: Record<string, unknown> }>;
    const listBody = await listResponse.json() as ApiEnvelope<{ simulationRuns: Array<Record<string, unknown>> }>;
    const firstResult = firstBody.data?.simulationRun.result as Record<string, unknown>;
    const secondResult = secondBody.data?.simulationRun.result as Record<string, unknown>;
    const getResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-sim/simulations/simulation_run_1`, {
      headers: adminHeaders("support", "support-1")
    });
    const getBody = await getResponse.json() as ApiEnvelope<{ simulationRun: Record<string, unknown> }>;

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(firstBody.data?.simulationRun).toMatchObject({
      id: "simulation_run_1",
      draftId: "draft-sim",
      configId: simpleConfig.id,
      configVersionId: simpleConfig.versionId,
      input: requestBody,
      createdBy: "operator-1"
    });
    expect(firstResult).toMatchObject({
      spinCount: 8,
      seed: "seed-3-4",
      totalWagered: 8,
      observedRtp: expect.any(Number),
      hitRate: expect.any(Number),
      largestWin: expect.any(Number),
      volatility: expect.any(Object),
      confidenceNotes: expect.any(Array)
    });
    expect(secondResult).toEqual(firstResult);
    expect(listBody.data?.simulationRuns).toHaveLength(2);
    expect(getResponse.status).toBe(200);
    expect(getBody.data?.simulationRun).toEqual(firstBody.data?.simulationRun);
    expect(walletService.getWallet("player_1").balance).toBe(1000);
    expect(walletService.getTransactions("player_1")).toEqual([]);
    expect(spinService.getLedger()).toEqual([]);
  });

  it("requires a valid math report before simulation", async () => {
    const draftResponse = await fetch(`${baseUrl}/api/admin/configs/drafts`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ id: "draft-no-report", config: simpleConfig })
    });
    expect(draftResponse.status).toBe(201);
    const response = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-no-report/simulations`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ spinCount: 8 })
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "MATH_REPORT_NOT_FOUND" }
    });
  });

  it("enforces bounded simulation resource usage and authorization", async () => {
    await createDraftWithMathReport();
    const tooLargeResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-sim/simulations`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ spinCount: 10_001 })
    });
    const unauthorizedResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-sim/simulations`, {
      method: "POST",
      headers: adminHeaders("viewer", "viewer-1"),
      body: JSON.stringify({ spinCount: 8 })
    });

    expect(tooLargeResponse.status).toBe(400);
    expect(unauthorizedResponse.status).toBe(403);
    await expect(tooLargeResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "INVALID_SIMULATION_REQUEST" }
    });
    await expect(unauthorizedResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "ADMIN_FORBIDDEN" }
    });
  });
});
