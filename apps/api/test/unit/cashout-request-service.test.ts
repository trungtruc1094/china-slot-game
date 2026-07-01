import { describe, expect, it, vi } from "vitest";
import {
  CashoutRequestService,
  deriveCashoutIdempotencyKey,
  fingerprintCashoutPayload,
  type CashoutCommitResult,
  type CashoutRequestRepository
} from "../../src/domain/cashout-request-service.js";
import type { TeviAuthContext } from "../../src/domain/tevi-auth-adapter.js";
import { ApiHttpError } from "../../src/middleware/error-handler.js";

const teviAuth: TeviAuthContext = {
  provider: "tevi",
  subject: "tevi-user-1",
  displayName: "Player",
  expiresAt: "2026-12-31T00:00:00.000Z"
};

class InMemoryCashoutRepository implements CashoutRequestRepository {
  public commits: unknown[] = [];
  private readonly byRequestId = new Map<string, CashoutCommitResult>();
  private readonly byIdempotency = new Map<string, CashoutCommitResult>();

  public constructor(private readonly options: {
    balance?: number;
    insufficient?: boolean;
    existing?: CashoutCommitResult | null;
  } = {}) {}

  public async findByRequestId(requestId: string): Promise<CashoutCommitResult | null> {
    return this.byRequestId.get(requestId) ?? this.options.existing ?? null;
  }

  public async findByIdempotencyKey(idempotencyKey: string): Promise<CashoutCommitResult | null> {
    return this.byIdempotency.get(idempotencyKey) ?? null;
  }

  public async commitCashoutDebit(input: {
    playerId: string;
    teviSubject: string;
    amount: number;
    requestId: string;
    payloadFingerprint: string;
    createdAt: Date;
  }): Promise<CashoutCommitResult> {
    this.commits.push(input);
    if (this.options.insufficient) {
      throw new ApiHttpError(409, {
        code: "INSUFFICIENT_BALANCE",
        message: "Insufficient balance",
        details: {}
      });
    }

    const cashoutRequestId = "cashout_test_1";
    const idempotencyKey = deriveCashoutIdempotencyKey(cashoutRequestId);
    const result: CashoutCommitResult = {
      cashoutRequestId,
      walletTransactionId: "txn_test_1",
      balanceAfter: (this.options.balance ?? 1000) - input.amount,
      status: "pending",
      idempotencyKey,
      payloadFingerprint: input.payloadFingerprint,
      alreadyExists: false
    };
    this.byRequestId.set(input.requestId, result);
    this.byIdempotency.set(idempotencyKey, result);
    return result;
  }

  public async recordDispatchOutcome(): Promise<void> {}
}

describe("CashoutRequestService", () => {
  it("rejects invalid amounts without repository calls", async () => {
    const repository = new InMemoryCashoutRepository();
    const service = new CashoutRequestService(repository, { dispatchCashout: vi.fn() });

    const result = await service.requestCashout({
      playerId: "player_1",
      teviAuth,
      amount: 0,
      requestId: "req_1"
    });

    expect(result).toMatchObject({ ok: false, code: "INVALID_CASHOUT_AMOUNT" });
    expect(repository.commits).toHaveLength(0);
  });

  it("rejects insufficient balance without mutating state", async () => {
    const repository = new InMemoryCashoutRepository({ insufficient: true });
    const dispatch = vi.fn();
    const service = new CashoutRequestService(repository, { dispatchCashout: dispatch });

    const result = await service.requestCashout({
      playerId: "player_1",
      teviAuth,
      amount: 100,
      requestId: "req_2"
    });

    expect(result).toMatchObject({ ok: false, code: "INSUFFICIENT_BALANCE" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("commits debit before dispatch and returns dispatched on provider success", async () => {
    const repository = new InMemoryCashoutRepository({ balance: 500 });
    const dispatch = vi.fn(async () => ({ ok: true as const }));
    const service = new CashoutRequestService(repository, { dispatchCashout: dispatch });

    const result = await service.requestCashout({
      playerId: "player_1",
      teviAuth,
      amount: 100,
      requestId: "req_3"
    });

    expect(repository.commits).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      teviSubject: "tevi-user-1",
      amount: 100,
      requestId: "req_3"
    }));
    expect(result).toMatchObject({
      ok: true,
      status: "dispatched",
      amount: 100,
      balanceAfter: 400
    });
  });

  it("returns failed_retryable when provider dispatch fails after debit", async () => {
    const repository = new InMemoryCashoutRepository({ balance: 500 });
    const dispatch = vi.fn(async () => ({
      ok: false as const,
      reasonCode: "PROVIDER_UNAVAILABLE",
      statusCode: 503
    }));
    const service = new CashoutRequestService(repository, { dispatchCashout: dispatch });

    const result = await service.requestCashout({
      playerId: "player_1",
      teviAuth,
      amount: 100,
      requestId: "req_4"
    });

    expect(result).toMatchObject({ ok: true, status: "failed_retryable", balanceAfter: 400 });
  });

  it("replays the same request id without a second commit", async () => {
    const existing: CashoutCommitResult = {
      cashoutRequestId: "cashout_existing",
      walletTransactionId: "txn_existing",
      balanceAfter: 900,
      status: "dispatched",
      idempotencyKey: deriveCashoutIdempotencyKey("cashout_existing"),
      payloadFingerprint: fingerprintCashoutPayload("tevi-user-1", 100),
      alreadyExists: true
    };
    const repository = new InMemoryCashoutRepository({ existing });
    const dispatch = vi.fn();
    const service = new CashoutRequestService(repository, { dispatchCashout: dispatch });

    const result = await service.requestCashout({
      playerId: "player_1",
      teviAuth,
      amount: 100,
      requestId: "req_replay"
    });

    expect(repository.commits).toHaveLength(0);
    expect(dispatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, cashoutRequestId: "cashout_existing" });
  });
});

describe("deriveCashoutIdempotencyKey", () => {
  it("derives a stable UUID-shaped key from the cashout request id", () => {
    const key = deriveCashoutIdempotencyKey("cashout_abc");
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deriveCashoutIdempotencyKey("cashout_abc")).toBe(key);
  });
});
