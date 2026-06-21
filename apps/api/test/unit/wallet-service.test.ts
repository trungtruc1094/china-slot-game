import { describe, expect, it } from "vitest";
import { ApiHttpError } from "../../src/middleware/error-handler.js";
import type { Clock } from "../../src/domain/session-service.js";
import { WalletService } from "../../src/domain/wallet-service.js";

class FixedClock implements Clock {
  public now(): Date {
    return new Date("2026-06-18T08:00:00.000Z");
  }
}

function createWalletService(): WalletService {
  return new WalletService(new FixedClock());
}

function creditLikeTypes(): Array<"free_spin_award" | "jackpot_award" | "adjustment"> {
  return ["free_spin_award", "jackpot_award", "adjustment"];
}

describe("WalletService", () => {
  it("applies debits through the transactional path and records balance history", async () => {
    const service = createWalletService();

    const result = await service.applyTransaction({
      playerId: "player_1",
      type: "debit",
      amount: 250,
      actor: "spin-service",
      source: "spin:sess_1"
    });

    expect(result.wallet).toEqual({ playerId: "player_1", balance: 750 });
    expect(result.transaction).toEqual({
      transactionId: "txn_1",
      playerId: "player_1",
      type: "debit",
      amount: 250,
      balanceBefore: 1000,
      balanceAfter: 750,
      actor: "spin-service",
      source: "spin:sess_1",
      correlationId: null,
      createdAt: "2026-06-18T08:00:00.000Z",
      metadata: {}
    });
    expect(service.getTransactions("player_1")).toEqual([result.transaction]);
  });

  it("applies credits as integer point units", async () => {
    const service = createWalletService();

    const result = await service.applyTransaction({
      playerId: "player_1",
      type: "credit",
      amount: 125,
      actor: "admin",
      source: "manual-adjustment",
      metadata: { reason: "test" }
    });

    expect(result.wallet.balance).toBe(1125);
    expect(result.transaction.balanceBefore).toBe(1000);
    expect(result.transaction.balanceAfter).toBe(1125);
    expect(result.transaction.metadata).toEqual({ reason: "test" });
  });

  it.each(creditLikeTypes())("records %s transactions with balance before and after", async (type) => {
    const service = createWalletService();

    const result = await service.applyTransaction({
      playerId: "player_1",
      type,
      amount: 50,
      actor: "reward-service",
      source: `reward:${type}`
    });

    expect(result.wallet.balance).toBe(1050);
    expect(result.transaction).toMatchObject({
      type,
      amount: 50,
      balanceBefore: 1000,
      balanceAfter: 1050,
      actor: "reward-service",
      source: `reward:${type}`
    });
    expect(service.getTransactions("player_1")).toEqual([result.transaction]);
  });

  it("rejects insufficient balance without mutating balance or appending a transaction", async () => {
    const service = createWalletService();

    await expect(service.applyTransaction({
      playerId: "player_1",
      type: "debit",
      amount: 1001,
      actor: "spin-service",
      source: "spin:sess_1"
    })).rejects.toMatchObject({
      apiError: {
        code: "INSUFFICIENT_BALANCE"
      }
    });

    expect(service.getWallet("player_1").balance).toBe(1000);
    expect(service.getTransactions("player_1")).toEqual([]);
  });

  it("rejects credit results that would exceed safe integer balance storage", async () => {
    const service = createWalletService();

    await expect(service.applyTransaction({
      playerId: "player_1",
      type: "credit",
      amount: Number.MAX_SAFE_INTEGER,
      actor: "admin",
      source: "manual-adjustment"
    })).rejects.toMatchObject({
      apiError: {
        code: "INVALID_BALANCE_RESULT"
      }
    });

    expect(service.getWallet("player_1").balance).toBe(1000);
    expect(service.getTransactions("player_1")).toEqual([]);
  });

  it("ignores client-provided balance-looking fields", async () => {
    const service = createWalletService();

    const result = await service.applyTransaction({
      playerId: "player_1",
      type: "debit",
      amount: 100,
      actor: "spin-service",
      source: "spin:sess_1",
      metadata: {
        clientBalance: 999999
      }
    });

    expect(result.transaction.balanceBefore).toBe(1000);
    expect(result.transaction.balanceAfter).toBe(900);
    expect(service.getWallet("player_1").balance).toBe(900);
  });

  it("rolls back balance and transaction history when a mid-flight failure occurs", async () => {
    const service = new WalletService(new FixedClock(), {
      failAfterBalanceUpdate: (request) => request.source === "spin:sess_1"
    });

    await expect(service.applyTransaction({
      playerId: "player_1",
      type: "debit",
      amount: 100,
      actor: "spin-service",
      source: "spin:sess_1"
    })).rejects.toBeInstanceOf(ApiHttpError);

    expect(service.getWallet("player_1").balance).toBe(1000);
    expect(service.getTransactions("player_1")).toEqual([]);
  });

  it("serializes concurrent debits on the same wallet so negative balances are impossible", async () => {
    const service = createWalletService();

    const results = await Promise.allSettled([
      service.applyTransaction({
        playerId: "player_1",
        type: "debit",
        amount: 700,
        actor: "spin-service",
        source: "spin:sess_1"
      }),
      service.applyTransaction({
        playerId: "player_1",
        type: "debit",
        amount: 700,
        actor: "spin-service",
        source: "spin:sess_2"
      })
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(service.getWallet("player_1").balance).toBe(300);
    expect(service.getTransactions("player_1")).toHaveLength(1);
  });
});
