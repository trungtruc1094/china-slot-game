import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryAlertRepository } from "../../src/domain/alert-repository.js";
import { InMemoryGameConfigurationRepository } from "../../src/domain/game-configuration-repository.js";
import { InMemoryOperatorLimitsRepository, type OperatorLimits } from "../../src/domain/operator-limits-repository.js";
import { InMemoryPlayerIdentityAdapter } from "../../src/domain/player-identity.js";
import { SessionService, type Clock } from "../../src/domain/session-service.js";
import { SpinService } from "../../src/domain/spin-service.js";
import type { ApiEnvelope } from "../../src/schemas/api-envelope.js";
import { WalletService } from "../../src/domain/wallet-service.js";
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
  const sessionService = new SessionService(new InMemoryPlayerIdentityAdapter(), clock);
  const walletService = new WalletService(clock);
  const configRepository = new InMemoryGameConfigurationRepository(clock);
  configRepository.createDraft({ id: "alerts-config", config: simpleConfig, actor: "operator-1" });
  configRepository.activateDraft({ id: "alerts-config", actor: "operator-1" });
  const operatorLimitsRepository = new InMemoryOperatorLimitsRepository(clock);
  operatorLimitsRepository.create({ scopeId: "default", limits: operatorLimits, actor: "operator-1" });
  const alertRepository = new InMemoryAlertRepository(clock);
  const randomValues = [0, 0, 0, 0.9, 0.9, 0.9];
  const spinService = new SpinService(
    sessionService,
    walletService,
    {
      configProvider: configRepository,
      operatorLimitsProvider: operatorLimitsRepository,
      nextRandom: () => randomValues.shift() ?? 0.9
    },
    clock
  );
  server = createServer(createApp({
    clock,
    configRepository,
    operatorLimitsRepository,
    alertRepository,
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
    "x-request-id": "req_admin_alerts_test"
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

async function createHighRtpRule(): Promise<void> {
  await fetch(`${baseUrl}/api/admin/alert-rules`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      id: "high-rtp",
      scopeId: "default",
      metric: "observedRtpAbove",
      threshold: 1,
      severity: "critical",
      suggestedAction: "Review campaign exposure."
    })
  });
}

async function evaluateWindow(from: string, to: string): Promise<ApiEnvelope<{ alerts: Array<Record<string, unknown>> }>> {
  const response = await fetch(`${baseUrl}/api/admin/alerts/evaluate`, {
    method: "POST",
    headers: adminHeaders("support", "support-1"),
    body: JSON.stringify({ from, to, scopeId: "default", configVersionId: "simple-config-v1" })
  });
  return response.json() as Promise<ApiEnvelope<{ alerts: Array<Record<string, unknown>> }>>;
}

describe("admin alert routes", () => {
  it("fires once per metrics window and appends a resolved event when the rule stops firing", async () => {
    await createHighRtpRule();
    const sessionId = await createSession("player-a");
    clock.current = new Date("2026-06-18T08:01:00.000Z");
    await postSpin(sessionId, "alert-winning-spin");
    const firstEvaluation = await evaluateWindow("2026-06-18T08:00:00.000Z", "2026-06-18T08:01:30.000Z");
    const secondEvaluation = await evaluateWindow("2026-06-18T08:00:00.000Z", "2026-06-18T08:01:30.000Z");
    const activeMetricsResponse = await fetch(`${baseUrl}/api/admin/metrics?scopeId=default`, {
      headers: adminHeaders("viewer", "viewer-1")
    });
    const activeMetricsBody = await activeMetricsResponse.json() as ApiEnvelope<{ metrics: Record<string, unknown> }>;

    clock.current = new Date("2026-06-18T08:02:00.000Z");
    await postSpin(sessionId, "alert-losing-spin");
    const resolvedEvaluation = await evaluateWindow("2026-06-18T08:01:30.000Z", "2026-06-18T08:03:00.000Z");
    const historyResponse = await fetch(`${baseUrl}/api/admin/alerts?scopeId=default`, {
      headers: adminHeaders("viewer", "viewer-1")
    });
    const historyBody = await historyResponse.json() as ApiEnvelope<{ alerts: Array<Record<string, unknown>> }>;
    const resolvedMetricsResponse = await fetch(
      `${baseUrl}/api/admin/metrics?from=2026-06-18T08:01:30.000Z&to=2026-06-18T08:03:00.000Z&scopeId=default`,
      { headers: adminHeaders("viewer", "viewer-1") }
    );
    const resolvedMetricsBody = await resolvedMetricsResponse.json() as ApiEnvelope<{ metrics: Record<string, unknown> }>;

    expect(firstEvaluation.data?.alerts).toMatchObject([
      {
        id: "alert_1",
        ruleId: "high-rtp",
        status: "firing",
        metricValue: 5,
        threshold: 1,
        severity: "critical",
        suggestedAction: "Review campaign exposure."
      }
    ]);
    expect(secondEvaluation.data?.alerts).toEqual(firstEvaluation.data?.alerts);
    expect(activeMetricsBody.data?.metrics).toMatchObject({ alertState: "active" });
    expect(resolvedEvaluation.data?.alerts).toMatchObject([
      {
        id: "alert_2",
        ruleId: "high-rtp",
        status: "resolved",
        metricValue: 0,
        threshold: 1
      }
    ]);
    expect(historyBody.data?.alerts).toMatchObject([
      { id: "alert_1", status: "firing" },
      { id: "alert_2", status: "resolved" }
    ]);
    expect(resolvedMetricsBody.data?.metrics).toMatchObject({ alertState: "none" });
  });

  it("acknowledges firing alerts with append-only history", async () => {
    await createHighRtpRule();
    const sessionId = await createSession("player-a");
    clock.current = new Date("2026-06-18T08:01:00.000Z");
    await postSpin(sessionId, "alert-ack-spin");
    await evaluateWindow("2026-06-18T08:00:00.000Z", "2026-06-18T08:02:00.000Z");

    const acknowledgeResponse = await fetch(`${baseUrl}/api/admin/alerts/alert_1/acknowledge`, {
      method: "POST",
      headers: adminHeaders("operator", "operator-2"),
      body: JSON.stringify({ reason: "reviewed" })
    });
    const acknowledgeBody = await acknowledgeResponse.json() as ApiEnvelope<{ alert: Record<string, unknown> }>;
    const historyResponse = await fetch(`${baseUrl}/api/admin/alerts`, {
      headers: adminHeaders("viewer", "viewer-1")
    });
    const historyBody = await historyResponse.json() as ApiEnvelope<{ alerts: Array<Record<string, unknown>> }>;

    expect(acknowledgeResponse.status).toBe(200);
    expect(acknowledgeBody.data?.alert).toMatchObject({
      id: "alert_2",
      ruleId: "high-rtp",
      status: "acknowledged",
      actor: "operator-2",
      reason: "reviewed"
    });
    expect(historyBody.data?.alerts).toMatchObject([
      { id: "alert_1", status: "firing" },
      { id: "alert_2", status: "acknowledged" }
    ]);
  });
});
