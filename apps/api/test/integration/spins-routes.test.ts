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
let walletService: WalletService;
let spinService: SpinService;

async function startServer(options: { activeConfig?: typeof simpleConfig | null; failLedgerCommit?: () => boolean } = {}): Promise<void> {
  const activeConfig = options.activeConfig === null ? undefined : options.activeConfig ?? simpleConfig;
  clock = new MutableClock();
  const sessionService = new SessionService(new InMemoryPlayerIdentityAdapter(), clock);
  walletService = new WalletService(clock);
  const appOptions: Parameters<typeof createApp>[0] = {
    clock,
    sessionService,
    walletService
  };
  const spinOptions = {
    ...(activeConfig ? { activeConfig } : {}),
    nextRandom: () => 0,
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
