import { describe, expect, it, vi } from "vitest";
import {
  CashoutReconciliationService,
  deriveReconciliationState
} from "../../src/domain/cashout-reconciliation-service.js";
import type { CashoutRequestDetailRecord, CashoutRequestRepository } from "../../src/domain/cashout-request-service.js";
import type { CashoutCommitResult } from "../../src/domain/cashout-request-service.js";

function detail(overrides: Partial<CashoutRequestDetailRecord> = {}): CashoutRequestDetailRecord {
  return {
    cashoutRequestId: "cashout_test_1",
    playerId: "player_1",
    teviSubject: "tevi-user-1",
    amount: 100,
    status: "failed_retryable",
    reconciliationState: "retry_required",
    dispatchAttemptCount: 1,
    failureReason: "PROVIDER_UNAVAILABLE",
    providerStatusCode: 503,
    providerResponseSummary: { providerStatusCode: 503, failureReason: "PROVIDER_UNAVAILABLE" },
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    payloadFingerprint: "abc123",
    requestId: "req_player_cashout",
    walletTransactionId: "txn_test_1",
    relatedSpinId: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    dispatchedAt: null,
    ...overrides
  };
}

class FakeReconciliationRepository implements CashoutRequestRepository {
  public outcomes: unknown[] = [];

  public constructor(
    private readonly record: CashoutRequestDetailRecord | null,
    private readonly afterRetry?: CashoutRequestDetailRecord
  ) {}

  public async findByRequestId(): Promise<CashoutCommitResult | null> {
    return null;
  }

  public async findByIdempotencyKey(): Promise<CashoutCommitResult | null> {
    return null;
  }

  public async commitCashoutDebit(): Promise<CashoutCommitResult> {
    throw new Error("not implemented");
  }

  public async recordDispatchOutcome(cashoutRequestId: string, outcome: unknown): Promise<void> {
    this.outcomes.push({ cashoutRequestId, outcome });
  }

  public async reconcileUserWithdraw(): Promise<{ status: "no_match"; cashoutRequestId: null }> {
    return { status: "no_match", cashoutRequestId: null };
  }

  public async findDetailById(cashoutRequestId: string): Promise<CashoutRequestDetailRecord | null> {
    if (this.afterRetry && this.outcomes.length > 0) {
      return this.afterRetry;
    }
    return this.record?.cashoutRequestId === cashoutRequestId ? this.record : null;
  }

  public async searchCashoutRequests(): Promise<{ records: CashoutRequestDetailRecord[]; total: number }> {
    return { records: this.record ? [this.record] : [], total: this.record ? 1 : 0 };
  }
}

describe("deriveReconciliationState", () => {
  it("maps webhook metadata to reconciled", () => {
    expect(deriveReconciliationState("dispatched", { webhookProviderEventId: "evt_1" })).toBe("reconciled");
  });

  it("maps failed_retryable to retry_required", () => {
    expect(deriveReconciliationState("failed_retryable", {})).toBe("retry_required");
  });

  it("maps idempotency_conflict to operator_review_required", () => {
    expect(deriveReconciliationState("idempotency_conflict", {})).toBe("operator_review_required");
  });
});

describe("CashoutReconciliationService", () => {
  it("retries failed_retryable cashouts with the original idempotency key", async () => {
    const repository = new FakeReconciliationRepository(
      detail(),
      detail({ status: "dispatched", reconciliationState: "provider_dispatched", dispatchAttemptCount: 2 })
    );
    const dispatch = vi.fn(async () => ({ ok: true as const }));
    const service = new CashoutReconciliationService(repository, { dispatchCashout: dispatch });

    const result = await service.retryDispatch("cashout_test_1", "req_admin_retry");

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      teviSubject: "tevi-user-1",
      amount: 100,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      requestId: "req_admin_retry"
    }));
    expect(result).toMatchObject({
      ok: true,
      status: "dispatched",
      dispatchAttemptCount: 2
    });
    expect(repository.outcomes).toHaveLength(1);
  });

  it("rejects retry for terminal idempotency_conflict without dispatch", async () => {
    const repository = new FakeReconciliationRepository(detail({ status: "idempotency_conflict", reconciliationState: "operator_review_required" }));
    const dispatch = vi.fn();
    const service = new CashoutReconciliationService(repository, { dispatchCashout: dispatch });

    const result = await service.retryDispatch("cashout_test_1", "req_admin_retry");

    expect(result).toMatchObject({
      ok: false,
      code: "CASHOUT_RETRY_NOT_ALLOWED",
      reasonCode: "IDEMPOTENCY_CONFLICT_REQUIRES_OPERATOR_REVIEW"
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("returns not found when cashout row is missing", async () => {
    const service = new CashoutReconciliationService(
      new FakeReconciliationRepository(null),
      { dispatchCashout: vi.fn() }
    );

    const result = await service.retryDispatch("cashout_missing", "req_admin_retry");
    expect(result).toMatchObject({ ok: false, code: "CASHOUT_NOT_FOUND" });
  });
});
