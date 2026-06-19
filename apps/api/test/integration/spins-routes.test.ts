import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryAdminAuditRepository } from "../../src/domain/admin-audit-repository.js";
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
let walletService: WalletService;
let spinService: SpinService;
let operatorLimitsRepository: InMemoryOperatorLimitsRepository;
let auditRepository: InMemoryAdminAuditRepository;

const permissiveOperatorLimits: OperatorLimits = {
  currency: "POINTS",
  perSpin: { minBet: 1, maxBet: 1000, maxPayout: 1000 },
  perSession: { maxSpins: 100, maxWager: 10_000 },
  perDay: { playerMaxWager: 10_000, playerMaxReward: 10_000 },
  campaign: { budget: 100_000, jackpotCap: 10_000 }
};

async function startServer(options: {
  activeConfig?: typeof simpleConfig | null;
  failLedgerCommit?: () => boolean;
  nextRandom?: () => number;
  operatorLimits?: OperatorLimits;
} = {}): Promise<void> {
  const activeConfig = options.activeConfig === null ? undefined : options.activeConfig ?? simpleConfig;
  clock = new MutableClock();
  const sessionService = new SessionService(new InMemoryPlayerIdentityAdapter(), clock);
  walletService = new WalletService(clock);
  auditRepository = new InMemoryAdminAuditRepository(clock);
  operatorLimitsRepository = new InMemoryOperatorLimitsRepository(clock);
  if (options.operatorLimits) {
    operatorLimitsRepository.create({ scopeId: "default", limits: options.operatorLimits, actor: "operator-1" });
  }
  const appOptions: Parameters<typeof createApp>[0] = {
    clock,
    sessionService,
    walletService,
    adminAuditRepository: auditRepository,
    operatorLimitsRepository
  };
  const spinOptions = {
    ...(activeConfig ? { activeConfig } : {}),
    nextRandom: options.nextRandom ?? (() => 0),
    operatorLimitsProvider: operatorLimitsRepository,
    ...(options.failLedgerCommit ? { failLedgerCommit: options.failLedgerCommit } : {})
  };
  spinService = new SpinService(sessionService, walletService, spinOptions, clock);
  appOptions.spinService = spinService;
  server = createServer(createApp(appOptions));
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

beforeEach(async () => {
  await startServer();
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

async function postSpin(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/spins`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "req_spin_test"
    },
    body: JSON.stringify(body)
  });
}

async function currentBalanceAfterValidSpin(sessionId: string): Promise<number> {
  currentBalanceSpinCounter += 1;
  const response = await postSpin({
    clientSpinId: `spin-balance-check-${currentBalanceSpinCounter}`,
    sessionId,
    wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
  });
  const body = await response.json() as ApiEnvelope<{ balanceAfter: number }>;
  return body.data?.balanceAfter ?? Number.NaN;
}

let currentBalanceSpinCounter = 0;

describe("spin routes", () => {
  it("returns an authoritative backend spin result and updates backend balance", async () => {
    const sessionId = await createSession();
    const response = await postSpin({
      clientSpinId: "spin-success",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    });
    const body = await response.json() as ApiEnvelope<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      spinId: "spin_1",
      configVersionId: "simple-config-v1",
      reelStops: [
        { reelIndex: 0, stopIndex: 0 },
        { reelIndex: 1, stopIndex: 0 },
        { reelIndex: 2, stopIndex: 0 }
      ],
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 },
      payout: 5,
      balanceAfter: 1004,
      rewardModel: {
        mode: "mvp_non_cash",
        unit: "points",
        cashEquivalent: false,
        redemptionEnabled: false,
        cashOutEnabled: false,
        cryptoEnabled: false
      },
      freeSpinState: { awarded: 0, remaining: 0 },
      jackpotState: { awarded: 0 }
    });
    expect(body.data?.visibleWindow).toEqual({
      rows: 1,
      reels: [
        [{ reelIndex: 0, rowIndex: 0, symbolId: "A", stripIndex: 0 }],
        [{ reelIndex: 1, rowIndex: 0, symbolId: "A", stripIndex: 0 }],
        [{ reelIndex: 2, rowIndex: 0, symbolId: "A", stripIndex: 0 }]
      ]
    });
    expect(body.data?.winBreakdown).toMatchObject({
      totalPay: 5,
      totalFreeSpins: 0
    });
    expect(walletService.getTransactions("player_1")).toMatchObject([
      { type: "debit", amount: 1, balanceBefore: 1000, balanceAfter: 999 },
      { type: "credit", amount: 5, balanceBefore: 999, balanceAfter: 1004 }
    ]);
    expect(spinService.getLedger()).toMatchObject([
      {
        spinId: "spin_1",
        sessionId,
        playerId: "player_1",
        walletTransactions: [
          { type: "debit", amount: 1 },
          { type: "credit", amount: 5 }
        ]
      }
    ]);
  });

  it("rejects invalid wagers without mutating balance", async () => {
    const sessionId = await createSession();
    const response = await postSpin({
      clientSpinId: "spin-invalid-wager",
      sessionId,
      wager: { lineBet: 1, selectedWays: 2, totalWager: 2 }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "INVALID_WAGER" }
    });
    await expect(currentBalanceAfterValidSpin(sessionId)).resolves.toBe(1004);
  });

  it("rejects cash-equivalent spin payload fields before wallet or ledger state changes", async () => {
    const sessionId = await createSession();
    const response = await postSpin({
      clientSpinId: "spin-cashout-bypass",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 },
      rewardType: "cash",
      cashOutEnabled: true
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: {
        code: "REWARD_TYPE_FORBIDDEN",
        details: { rewardType: "cash" }
      },
      requestId: "req_spin_test"
    });
    expect(walletService.getWallet("player_1")).toMatchObject({ balance: 1000 });
    expect(walletService.getTransactions("player_1")).toEqual([]);
    expect(spinService.getLedger()).toEqual([]);
    expect(auditRepository.list()).toEqual([
      expect.objectContaining({
        action: "reward_boundary.reject",
        resource: { type: "reward_type", id: "cash" },
        requestId: "req_spin_test",
        source: "reward-boundary",
        outcome: "failed",
        metadata: expect.objectContaining({
          rewardType: "cash",
          route: "POST /api/spins"
        })
      })
    ]);
  });

  it("rejects cash-equivalent spin payload key names before Zod stripping", async () => {
    const sessionId = await createSession();
    const response = await postSpin({
      clientSpinId: "spin-cashout-key-bypass",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 },
      cash_out: true
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: {
        code: "REWARD_TYPE_FORBIDDEN",
        details: { rewardType: "cash_out" }
      },
      requestId: "req_spin_test"
    });
    expect(walletService.getTransactions("player_1")).toEqual([]);
    expect(spinService.getLedger()).toEqual([]);
    expect(auditRepository.list()).toEqual([
      expect.objectContaining({
        action: "reward_boundary.reject",
        resource: { type: "reward_type", id: "cash_out" },
        requestId: "req_spin_test",
        source: "reward-boundary",
        outcome: "failed"
      })
    ]);
  });

  it("rejects inactive sessions", async () => {
    const sessionId = await createSession();
    clock.current = new Date("2026-06-18T09:00:00.000Z");
    const response = await postSpin({
      clientSpinId: "spin-expired",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "SESSION_EXPIRED" }
    });
    clock.current = new Date("2026-06-18T08:30:00.000Z");
    const recoveredSessionId = await createSession();
    await expect(currentBalanceAfterValidSpin(recoveredSessionId)).resolves.toBe(1004);
  });

  it("rejects missing active config without mutating balance", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await startServer({ activeConfig: null });
    const sessionId = await createSession();
    const response = await postSpin({
      clientSpinId: "spin-no-config",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "ACTIVE_CONFIG_MISSING" }
    });
    expect(walletService.getWallet("player_1").balance).toBe(1000);
    expect(spinService.getLedger()).toEqual([]);
  });

  it("uses only active configuration versions and ignores draft configs", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clock = new MutableClock();
    const sessionService = new SessionService(new InMemoryPlayerIdentityAdapter(), clock);
    walletService = new WalletService(clock);
    const configRepository = new InMemoryGameConfigurationRepository(clock);
    configRepository.createDraft({ id: "draft-live", config: simpleConfig, actor: "operator-1" });
    configRepository.activateDraft({ id: "draft-live", actor: "operator-1" });
    configRepository.createDraft({
      id: "draft-ignored",
      config: {
        ...simpleConfig,
        versionId: "draft-ignored-v2",
        paytable: [
          { id: "a-3", symbols: ["A", "A", "A", "any", "any"], pay: 500, freeSpins: 0 }
        ]
      },
      actor: "operator-2"
    });
    spinService = new SpinService(
      sessionService,
      walletService,
      { configProvider: configRepository, nextRandom: () => 0 },
      clock
    );
    server = createServer(createApp({
      clock,
      sessionService,
      walletService,
      spinService
    }));
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    const sessionId = await createSession();
    const response = await postSpin({
      clientSpinId: "spin-ignores-draft",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    });
    const body = await response.json() as ApiEnvelope<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      configVersionId: "simple-config-v1",
      payout: 5,
      balanceAfter: 1004
    });
  });

  it("rejects insufficient balance without accepting the spin", async () => {
    const sessionId = await createSession();
    const response = await postSpin({
      clientSpinId: "spin-insufficient",
      sessionId,
      wager: { lineBet: 1001, selectedWays: 1, totalWager: 1001 }
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "INSUFFICIENT_BALANCE" }
    });
    await expect(currentBalanceAfterValidSpin(sessionId)).resolves.toBe(1004);
  });

  it("allows a spin exactly at the active operator wager limit", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await startServer({
      operatorLimits: {
        ...permissiveOperatorLimits,
        perSpin: { ...permissiveOperatorLimits.perSpin, maxBet: 1 },
        perDay: { ...permissiveOperatorLimits.perDay, playerMaxWager: 2 }
      }
    });
    const sessionId = await createSession();
    await postSpin({
      clientSpinId: "spin-at-limit-1",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    });
    const response = await postSpin({
      clientSpinId: "spin-at-limit-2",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    });
    const body = await response.json() as ApiEnvelope<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      spinId: "spin_2",
      balanceAfter: 1008
    });
    expect(walletService.getTransactions("player_1")).toHaveLength(4);
    expect(spinService.getLedger()).toHaveLength(2);
  });

  it("rejects one minor unit over active operator limits before wallet debit or reel generation", async () => {
    let randomCalls = 0;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await startServer({
      nextRandom: () => {
        randomCalls += 1;
        return 0;
      },
      operatorLimits: {
        ...permissiveOperatorLimits,
        perSpin: { ...permissiveOperatorLimits.perSpin, maxBet: 1 },
        perDay: { ...permissiveOperatorLimits.perDay, playerMaxWager: 1 }
      }
    });
    const sessionId = await createSession();
    const acceptedResponse = await postSpin({
      clientSpinId: "spin-limit-accepted",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    });
    const randomCallsAfterAcceptedSpin = randomCalls;
    const walletBeforeRejectedSpin = walletService.getWallet("player_1");
    const transactionsBeforeRejectedSpin = walletService.getTransactions("player_1");
    const ledgerBeforeRejectedSpin = spinService.getLedger();
    const rejectedResponse = await postSpin({
      clientSpinId: "spin-limit-rejected",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    });

    expect(acceptedResponse.status).toBe(200);
    expect(rejectedResponse.status).toBe(409);
    await expect(rejectedResponse.json()).resolves.toMatchObject({
      data: null,
      error: {
        code: "OPERATOR_LIMIT_EXCEEDED",
        details: {
          limit: "perDay.playerMaxWager",
          current: 1,
          attempted: 1,
          maximum: 1
        }
      }
    });
    expect(randomCalls).toBe(randomCallsAfterAcceptedSpin);
    expect(walletService.getWallet("player_1")).toEqual(walletBeforeRejectedSpin);
    expect(walletService.getTransactions("player_1")).toEqual(transactionsBeforeRejectedSpin);
    expect(spinService.getLedger()).toEqual(ledgerBeforeRejectedSpin);

    const retryResponse = await postSpin({
      clientSpinId: "spin-after-limit-rejection",
      sessionId,
      wager: { lineBet: 2, selectedWays: 1, totalWager: 2 }
    });
    expect(retryResponse.status).toBe(409);
    expect(spinService.getLedger()).toHaveLength(1);
  });

  it("ignores manipulated client outcome fields", async () => {
    const sessionId = await createSession();
    const response = await postSpin({
      clientSpinId: "spin-manipulated",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 },
      rng: { seed: "client-seed" },
      reelStops: [{ reelIndex: 0, stopIndex: 1 }],
      payout: 999999,
      balanceAfter: 999999
    });
    const body = await response.json() as ApiEnvelope<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      reelStops: [
        { reelIndex: 0, stopIndex: 0 },
        { reelIndex: 1, stopIndex: 0 },
        { reelIndex: 2, stopIndex: 0 }
      ],
      payout: 5,
      balanceAfter: 1004
    });
  });

  it("rolls back wallet updates when the spin ledger commit fails", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await startServer({ failLedgerCommit: () => true });
    const sessionId = await createSession();
    const response = await postSpin({
      clientSpinId: "spin-ledger-fails",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "WALLET_TRANSACTION_FAILED" }
    });
    expect(walletService.getWallet("player_1").balance).toBe(1000);
    expect(walletService.getTransactions("player_1")).toEqual([]);
    expect(spinService.getLedger()).toEqual([]);
  });

  it("does not cache failed idempotency attempts so the same key can be retried after recovery", async () => {
    let shouldFailLedger = true;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await startServer({ failLedgerCommit: () => shouldFailLedger });
    const sessionId = await createSession();
    const request = {
      clientSpinId: "spin-retry-after-rollback",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    };

    const failedResponse = await postSpin(request);
    shouldFailLedger = false;
    const retryResponse = await postSpin(request);
    const retryBody = await retryResponse.json() as ApiEnvelope<Record<string, unknown>>;

    expect(failedResponse.status).toBe(500);
    expect(retryResponse.status).toBe(200);
    expect(retryBody.data).toMatchObject({
      spinId: "spin_2",
      balanceAfter: 1004
    });
    expect(walletService.getTransactions("player_1")).toHaveLength(2);
    expect(spinService.getLedger()).toHaveLength(1);
  });

  it("returns the original result for duplicate matching clientSpinId without double debit", async () => {
    const sessionId = await createSession();
    const request = {
      clientSpinId: "spin-duplicate",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    };

    const firstResponse = await postSpin(request);
    const secondResponse = await postSpin(request);
    const firstBody = await firstResponse.json();
    const secondBody = await secondResponse.json();

    expect(secondResponse.status).toBe(200);
    expect(secondBody).toEqual(firstBody);
    expect(walletService.getTransactions("player_1")).toHaveLength(2);
    expect(spinService.getLedger()).toHaveLength(1);
  });

  it("does not return cached results after the idempotency retry window", async () => {
    const sessionId = await createSession();
    const request = {
      clientSpinId: "spin-expiring-idempotency",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    };

    const firstResponse = await postSpin(request);
    const firstBody = await firstResponse.json() as ApiEnvelope<{ spinId: string }>;
    clock.current = new Date("2026-06-19T08:00:00.001Z");
    const secondResponse = await postSpin(request);

    expect(firstBody.data?.spinId).toBe("spin_1");
    expect(secondResponse.status).toBe(401);
    await expect(secondResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "SESSION_EXPIRED" }
    });
    expect(walletService.getTransactions("player_1")).toHaveLength(2);
    expect(spinService.getLedger()).toHaveLength(1);
  });

  it("does not return idempotency conflicts after the retry window expires", async () => {
    const sessionId = await createSession();
    await postSpin({
      clientSpinId: "spin-expired-conflict-window",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    });

    clock.current = new Date("2026-06-19T08:00:00.001Z");
    const response = await postSpin({
      clientSpinId: "spin-expired-conflict-window",
      sessionId,
      wager: { lineBet: 2, selectedWays: 1, totalWager: 2 }
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "SESSION_EXPIRED" }
    });
    expect(walletService.getTransactions("player_1")).toHaveLength(2);
    expect(spinService.getLedger()).toHaveLength(1);
  });

  it("rejects conflicting clientSpinId reuse with different wager data", async () => {
    const sessionId = await createSession();
    await postSpin({
      clientSpinId: "spin-conflict",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    });
    const response = await postSpin({
      clientSpinId: "spin-conflict",
      sessionId,
      wager: { lineBet: 2, selectedWays: 1, totalWager: 2 }
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "IDEMPOTENCY_CONFLICT" }
    });
    expect(walletService.getTransactions("player_1")).toHaveLength(2);
    expect(spinService.getLedger()).toHaveLength(1);
  });
});
