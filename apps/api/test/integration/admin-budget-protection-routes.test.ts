import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryBudgetProtectionRepository, type BudgetProtectionActionType } from "../../src/domain/budget-protection-repository.js";
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
  await startServer(true);
});

afterEach(async () => {
  await closeServer();
});

async function startServer(budgetProtectionEnabled: boolean): Promise<void> {
  clock = new MutableClock();
  const sessionService = new SessionService(new InMemoryPlayerIdentityAdapter(), clock);
  const walletService = new WalletService(clock);
  const configRepository = new InMemoryGameConfigurationRepository(clock);
  configRepository.createDraft({ id: "budget-protection-config", config: simpleConfig, actor: "operator-1" });
  configRepository.activateDraft({ id: "budget-protection-config", actor: "operator-1" });
  const operatorLimitsRepository = new InMemoryOperatorLimitsRepository(clock);
  operatorLimitsRepository.create({ scopeId: "default", limits: operatorLimits, actor: "operator-1" });
  const budgetProtectionRepository = new InMemoryBudgetProtectionRepository(clock);
  const spinService = new SpinService(
    sessionService,
    walletService,
    {
      configProvider: configRepository,
      operatorLimitsProvider: operatorLimitsRepository,
      budgetProtectionProvider: budgetProtectionRepository,
      budgetProtectionEnabled,
      nextRandom: () => 0
    },
    clock
  );
  server = createServer(createApp({
    clock,
    configRepository,
    operatorLimitsRepository,
    budgetProtectionRepository,
    budgetProtectionEnabled,
    sessionService,
    walletService,
    spinService
  }));
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function closeServer(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function adminHeaders(role = "operator", actor = "operator-1"): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-admin-role": role,
    "x-admin-actor": actor,
    "x-request-id": "req_budget_protection_test"
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

async function postSpin(sessionId: string, clientSpinId: string, lineBet = 1): Promise<Response> {
  return fetch(`${baseUrl}/api/spins`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientSpinId,
      sessionId,
      wager: { lineBet, selectedWays: 1, totalWager: lineBet }
    })
  });
}

async function applyAction(action: BudgetProtectionActionType): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/api/admin/budget-protection/actions`, {
    method: "POST",
    headers: adminHeaders("operator", "operator-1"),
    body: JSON.stringify({
      scopeId: "default",
      action,
      reason: `${action} threshold crossed`,
      parameters: action === "lowerMaxBet" ? { maxBet: 1 } : {},
      metricState: { remainingBudget: 10 }
    })
  });
  const body = await response.json() as ApiEnvelope<{ action: Record<string, unknown> }>;
  expect(response.status).toBe(201);
  return body.data?.action ?? {};
}

async function revertAction(id: string): Promise<Response> {
  return fetch(`${baseUrl}/api/admin/budget-protection/actions/${id}/revert`, {
    method: "POST",
    headers: adminHeaders("operator", "operator-2"),
    body: JSON.stringify({ reason: "manual recovery" })
  });
}

describe("admin budget protection routes", () => {
  it.each([
    ["disablePaidSpins", 1],
    ["lowerMaxBet", 2],
    ["pauseCampaign", 1],
    ["requireHostApproval", 1]
  ] satisfies Array<[BudgetProtectionActionType, number]>)("triggers and reverts %s for future spins", async (actionType, lineBet) => {
    const sessionId = await createSession(`player-${actionType}`);
    const action = await applyAction(actionType);
    const rejectedResponse = await postSpin(sessionId, `${actionType}-blocked`, lineBet);
    const revertResponse = await revertAction(String(action.id));
    const acceptedResponse = await postSpin(sessionId, `${actionType}-allowed-after-revert`, lineBet);
    const acceptedBody = await acceptedResponse.json() as ApiEnvelope<Record<string, unknown>>;

    expect(rejectedResponse.status).toBe(409);
    await expect(rejectedResponse.json()).resolves.toMatchObject({
      data: null,
      error: {
        code: "BUDGET_PROTECTION_ACTIVE",
        details: {
          scopeId: "default",
          action: actionType
        }
      }
    });
    expect(revertResponse.status).toBe(200);
    expect(acceptedResponse.status).toBe(200);
    expect(acceptedBody.data).toMatchObject({
      spinId: "spin_1",
      wager: { lineBet, selectedWays: 1, totalWager: lineBet }
    });
  });

  it("records who, what, when, reason, and metric state in the audit trail", async () => {
    const action = await applyAction("pauseCampaign");
    clock.current = new Date("2026-06-18T08:10:00.000Z");
    await revertAction(String(action.id));
    const auditResponse = await fetch(`${baseUrl}/api/admin/budget-protection/audit-events`, {
      headers: adminHeaders("viewer", "viewer-1")
    });
    const auditBody = await auditResponse.json() as ApiEnvelope<{ auditEvents: Array<Record<string, unknown>> }>;

    expect(auditBody.data?.auditEvents).toMatchObject([
      {
        action: "budget_protection.apply",
        targetId: "budget_protection_1",
        actor: "operator-1",
        reason: "pauseCampaign threshold crossed",
        metadata: {
          scopeId: "default",
          action: "pauseCampaign",
          metricState: { remainingBudget: 10 }
        },
        createdAt: "2026-06-18T08:00:00.000Z"
      },
      {
        action: "budget_protection.revert",
        targetId: "budget_protection_1",
        actor: "operator-2",
        reason: "manual recovery",
        metadata: {
          scopeId: "default",
          action: "pauseCampaign"
        },
        createdAt: "2026-06-18T08:10:00.000Z"
      }
    ]);
  });

  it("can be disabled by environment configuration", async () => {
    await closeServer();
    await startServer(false);
    const response = await fetch(`${baseUrl}/api/admin/budget-protection/actions`, {
      method: "POST",
      headers: adminHeaders("operator", "operator-1"),
      body: JSON.stringify({
        scopeId: "default",
        action: "pauseCampaign",
        reason: "lower environment disabled"
      })
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "BUDGET_PROTECTION_DISABLED" }
    });
  });
});
