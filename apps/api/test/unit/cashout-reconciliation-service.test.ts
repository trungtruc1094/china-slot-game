import { describe, expect, it, vi } from "vitest";
import {
  CashoutReconciliationService,
  deriveReconciliationState,
  summarizeProviderResponse
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
  private detailLoadCount = 0;

  public constructor(
    private readonly record: CashoutRequestDetailRecord | null,
    private readonly options: {
      afterRetry?: CashoutRequestDetailRecord;
      missingAfterRetry?: boolean;
    } = {}
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
    if (this.record?.cashoutRequestId !== cashoutRequestId) {
      return null;
    }
    this.detailLoadCount += 1;
    if (this.options.missingAfterRetry && this.detailLoadCount > 1) {
      return null;
    }
    if (this.options.afterRetry && this.detailLoadCount > 1) {
      return this.options.afterRetry;
    }
    return this.record;
  }

  public async searchCashoutRequests(): Promise<{ records: CashoutRequestDetailRecord[]; total: number }> {
    return { records: this.record ? [this.record] : [], total: this.record ? 1 : 0 };
  }
}

describe("deriveReconciliationState", () => {
  it("maps webhook metadata to reconciled", () => {
    expect(deriveReconciliationState("dispatched", { webhookProviderEventId: "evt_1" })).toBe("reconciled");
  });

  it("maps pending and dispatched statuses", () => {
    expect(deriveReconciliationState("pending", {})).toBe("awaiting_dispatch");
    expect(deriveReconciliationState("dispatched", {})).toBe("provider_dispatched");
  });

  it("maps failed_retryable to retry_required", () => {
    expect(deriveReconciliationState("failed_retryable", {})).toBe("retry_required");
  });

  it("maps terminal statuses to operator_review_required", () => {
    expect(deriveReconciliationState("idempotency_conflict", {})).toBe("operator_review_required");
    expect(deriveReconciliationState("failed_terminal", {})).toBe("operator_review_required");
  });

  it("maps unknown statuses to unknown", () => {
    expect(deriveReconciliationState("bogus" as CashoutRequestDetailRecord["status"], {})).toBe("unknown");
  });
});

describe("summarizeProviderResponse", () => {
  it("includes webhook correlation and retry source when present", () => {
    expect(summarizeProviderResponse(503, "PROVIDER_UNAVAILABLE", {
      webhookProviderEventId: "evt_1",
      retrySource: "admin_reconciliation"
    })).toEqual({
      providerStatusCode: 503,
      failureReason: "PROVIDER_UNAVAILABLE",
      hasWebhookCorrelation: true,
      retrySource: "admin_reconciliation"
    });
  });

  it("returns null retry source when absent", () => {
    expect(summarizeProviderResponse(null, null, {})).toMatchObject({
      hasWebhookCorrelation: false,
      retrySource: null
    });
  });
});

describe("CashoutReconciliationService", () => {
  it("delegates search and get to the repository", async () => {
    const record = detail();
    const repository = new FakeReconciliationRepository(record);
    const service = new CashoutReconciliationService(repository, { dispatchCashout: vi.fn() });

    await expect(service.searchRecords({ limit: 10, offset: 0 })).resolves.toEqual({
      records: [record],
      total: 1
    });
    await expect(service.getRecord("cashout_test_1")).resolves.toEqual(record);
  });

  it("retries failed_retryable cashouts with the original idempotency key", async () => {
    const repository = new FakeReconciliationRepository(
      detail(),
      { afterRetry: detail({ status: "dispatched", reconciliationState: "provider_dispatched", dispatchAttemptCount: 2 }) }
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

  it("rejects retry for dispatched and failed_terminal statuses", async () => {
    const dispatch = vi.fn();
    const dispatchedService = new CashoutReconciliationService(
      new FakeReconciliationRepository(detail({ status: "dispatched", reconciliationState: "provider_dispatched" })),
      { dispatchCashout: dispatch }
    );
    const terminalService = new CashoutReconciliationService(
      new FakeReconciliationRepository(detail({ status: "failed_terminal", reconciliationState: "operator_review_required" })),
      { dispatchCashout: dispatch }
    );

    expect(await dispatchedService.retryDispatch("cashout_test_1", "req_1")).toMatchObject({
      ok: false,
      reasonCode: "ALREADY_DISPATCHED"
    });
    expect(await terminalService.retryDispatch("cashout_test_1", "req_2")).toMatchObject({
      ok: false,
      reasonCode: "TERMINAL_FAILURE_REQUIRES_OPERATOR_REVIEW"
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("allows retry for pending cashouts", async () => {
    const repository = new FakeReconciliationRepository(
      detail({ status: "pending", reconciliationState: "awaiting_dispatch" }),
      { afterRetry: detail({ status: "dispatched", reconciliationState: "provider_dispatched", dispatchAttemptCount: 1 }) }
    );
    const dispatch = vi.fn(async () => ({ ok: true as const }));
    const service = new CashoutReconciliationService(repository, { dispatchCashout: dispatch });

    const result = await service.retryDispatch("cashout_test_1", "req_pending_retry");
    expect(result).toMatchObject({ ok: true, status: "dispatched" });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("returns dispatch failure without success envelope when provider retry fails", async () => {
    const repository = new FakeReconciliationRepository(
      detail(),
      { afterRetry: detail({ status: "failed_retryable", dispatchAttemptCount: 2 }) }
    );
    const service = new CashoutReconciliationService(repository, {
      dispatchCashout: vi.fn(async () => ({
        ok: false as const,
        reasonCode: "PROVIDER_UNAVAILABLE",
        statusCode: 503,
        providerStatusCode: 503
      }))
    });

    const result = await service.retryDispatch("cashout_test_1", "req_retry_fail");
    expect(result).toMatchObject({
      ok: false,
      code: "CASHOUT_RETRY_DISPATCH_FAILED",
      reasonCode: "PROVIDER_UNAVAILABLE",
      providerStatusCode: 503
    });
  });

  it("returns idempotency conflict when provider reports payload mismatch", async () => {
    const repository = new FakeReconciliationRepository(
      detail(),
      { afterRetry: detail({ status: "idempotency_conflict", reconciliationState: "operator_review_required", dispatchAttemptCount: 2 }) }
    );
    const service = new CashoutReconciliationService(repository, {
      dispatchCashout: vi.fn(async () => ({
        ok: false as const,
        reasonCode: "IDEMPOTENCY_PAYLOAD_MISMATCH",
        statusCode: 409,
        providerStatusCode: 409,
        idempotencyConflict: true
      }))
    });

    const result = await service.retryDispatch("cashout_test_1", "req_retry_conflict");
    expect(result).toMatchObject({
      ok: false,
      code: "CASHOUT_RETRY_DISPATCH_FAILED",
      reasonCode: "IDEMPOTENCY_PAYLOAD_MISMATCH",
      providerStatusCode: 409
    });
  });

  it("throws when the cashout row disappears after retry dispatch", async () => {
    const service = new CashoutReconciliationService(
      new FakeReconciliationRepository(detail(), { missingAfterRetry: true }),
      { dispatchCashout: vi.fn(async () => ({ ok: true as const })) }
    );

    await expect(service.retryDispatch("cashout_test_1", "req_missing_after_retry")).rejects.toMatchObject({
      apiError: { code: "CASHOUT_RETRY_STATE_MISSING" }
    });
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
