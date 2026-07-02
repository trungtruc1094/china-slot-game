import type { Clock } from "./session-service.js";
import type {
  CashoutDispatchClientPort,
  CashoutRequestRepository,
  CashoutRequestStatus
} from "./cashout-request-service.js";
import { ApiHttpError } from "../middleware/error-handler.js";

export type CashoutReconciliationState =
  | "awaiting_dispatch"
  | "provider_dispatched"
  | "reconciled"
  | "retry_required"
  | "operator_review_required"
  | "unknown";

export interface CashoutRequestDetailRecord {
  cashoutRequestId: string;
  playerId: string;
  teviSubject: string;
  amount: number;
  status: CashoutRequestStatus;
  reconciliationState: CashoutReconciliationState;
  dispatchAttemptCount: number;
  failureReason: string | null;
  providerStatusCode: number | null;
  providerResponseSummary: Record<string, unknown>;
  idempotencyKey: string;
  payloadFingerprint: string;
  requestId: string;
  walletTransactionId: string;
  relatedSpinId: string | null;
  createdAt: Date;
  updatedAt: Date;
  dispatchedAt: Date | null;
}

export interface CashoutRequestSearchFilters {
  playerId?: string;
  cashoutRequestId?: string;
  requestId?: string;
  status?: CashoutRequestStatus;
  reconciliationState?: CashoutReconciliationState;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export interface CashoutRequestSearchResult {
  records: CashoutRequestDetailRecord[];
  total: number;
}

export type CashoutRetryResult =
  | {
      ok: true;
      cashoutRequestId: string;
      status: CashoutRequestStatus;
      dispatchAttemptCount: number;
      reconciliationState: CashoutReconciliationState;
    }
  | {
      ok: false;
      code:
        | "CASHOUT_NOT_FOUND"
        | "CASHOUT_RETRY_NOT_ALLOWED"
        | "CASHOUT_RETRY_DISPATCH_FAILED";
      reasonCode: string;
      statusCode: number;
      providerStatusCode?: number;
    };

const systemClock: Clock = { now: () => new Date() };

export class CashoutReconciliationService {
  public constructor(
    private readonly repository: CashoutRequestRepository,
    private readonly dispatchClient: CashoutDispatchClientPort,
    private readonly clock: Clock = systemClock
  ) {}

  public async searchRecords(filters: CashoutRequestSearchFilters): Promise<CashoutRequestSearchResult> {
    return this.repository.searchCashoutRequests(filters);
  }

  public async getRecord(cashoutRequestId: string): Promise<CashoutRequestDetailRecord | null> {
    return this.repository.findDetailById(cashoutRequestId);
  }

  public async retryDispatch(cashoutRequestId: string, actorRequestId: string): Promise<CashoutRetryResult> {
    const detail = await this.repository.findDetailById(cashoutRequestId);
    if (!detail) {
      return {
        ok: false,
        code: "CASHOUT_NOT_FOUND",
        reasonCode: "CASHOUT_REQUEST_NOT_FOUND",
        statusCode: 404
      };
    }

    if (!isRetryAllowedStatus(detail.status)) {
      return {
        ok: false,
        code: "CASHOUT_RETRY_NOT_ALLOWED",
        reasonCode: retryBlockedReason(detail.status),
        statusCode: 409
      };
    }

    const dispatchResult = await this.dispatchClient.dispatchCashout({
      teviSubject: detail.teviSubject,
      amount: detail.amount,
      idempotencyKey: detail.idempotencyKey,
      requestId: actorRequestId,
      description: `China Slot cashout retry ${detail.cashoutRequestId}`
    });

    const finalStatus: CashoutRequestStatus = dispatchResult.ok
      ? "dispatched"
      : (!dispatchResult.ok && dispatchResult.idempotencyConflict)
        ? "idempotency_conflict"
        : "failed_retryable";

    await this.repository.recordDispatchOutcome(detail.cashoutRequestId, {
      status: finalStatus,
      failureReason: dispatchResult.ok ? null : dispatchResult.reasonCode,
      providerStatusCode: dispatchResult.ok ? null : dispatchResult.providerStatusCode ?? null,
      providerMetadata: {
        retryActorRequestId: actorRequestId,
        retrySource: "admin_reconciliation"
      },
      dispatchedAt: dispatchResult.ok ? this.clock.now() : null
    });

    const updated = await this.repository.findDetailById(detail.cashoutRequestId);
    if (!updated) {
      throw new ApiHttpError(500, {
        code: "CASHOUT_RETRY_STATE_MISSING",
        message: "Cashout request disappeared after retry dispatch.",
        details: { cashoutRequestId: detail.cashoutRequestId }
      });
    }

    if (!dispatchResult.ok && dispatchResult.idempotencyConflict) {
      const conflictFailure: Extract<CashoutRetryResult, { ok: false }> = {
        ok: false,
        code: "CASHOUT_RETRY_DISPATCH_FAILED",
        reasonCode: "IDEMPOTENCY_PAYLOAD_MISMATCH",
        statusCode: 409
      };
      if (dispatchResult.providerStatusCode !== undefined) {
        conflictFailure.providerStatusCode = dispatchResult.providerStatusCode;
      }
      return conflictFailure;
    }

    if (!dispatchResult.ok) {
      const failure: Extract<CashoutRetryResult, { ok: false }> = {
        ok: false,
        code: "CASHOUT_RETRY_DISPATCH_FAILED",
        reasonCode: dispatchResult.reasonCode,
        statusCode: dispatchResult.statusCode
      };
      if (dispatchResult.providerStatusCode !== undefined) {
        failure.providerStatusCode = dispatchResult.providerStatusCode;
      }
      return failure;
    }

    return {
      ok: true,
      cashoutRequestId: updated.cashoutRequestId,
      status: updated.status,
      dispatchAttemptCount: updated.dispatchAttemptCount,
      reconciliationState: updated.reconciliationState
    };
  }
}

export function deriveReconciliationState(
  status: CashoutRequestStatus,
  providerMetadata: Record<string, unknown>
): CashoutReconciliationState {
  if (typeof providerMetadata.webhookProviderEventId === "string") {
    return "reconciled";
  }
  switch (status) {
    case "pending":
      return "awaiting_dispatch";
    case "dispatched":
      return "provider_dispatched";
    case "failed_retryable":
      return "retry_required";
    case "failed_terminal":
    case "idempotency_conflict":
      return "operator_review_required";
    default:
      return "unknown";
  }
}

export function summarizeProviderResponse(
  providerStatusCode: number | null,
  failureReason: string | null,
  providerMetadata: Record<string, unknown>
): Record<string, unknown> {
  return {
    providerStatusCode,
    failureReason,
    hasWebhookCorrelation: typeof providerMetadata.webhookProviderEventId === "string",
    retrySource: typeof providerMetadata.retrySource === "string" ? providerMetadata.retrySource : null
  };
}

function isRetryAllowedStatus(status: CashoutRequestStatus): boolean {
  return status === "pending" || status === "failed_retryable";
}

function retryBlockedReason(status: CashoutRequestStatus): string {
  switch (status) {
    case "dispatched":
      return "ALREADY_DISPATCHED";
    case "failed_terminal":
      return "TERMINAL_FAILURE_REQUIRES_OPERATOR_REVIEW";
    case "idempotency_conflict":
      return "IDEMPOTENCY_CONFLICT_REQUIRES_OPERATOR_REVIEW";
    default:
      return "RETRY_NOT_ALLOWED";
  }
}
