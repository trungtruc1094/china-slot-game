import { Router } from "express";
import { z, ZodError } from "zod";
import type { AdminAuditRepository } from "../domain/admin-audit-repository.js";
import type {
  CashoutReconciliationService,
  CashoutRequestDetailRecord
} from "../domain/cashout-reconciliation-service.js";
import type { CashoutRequestStatus } from "../domain/cashout-request-service.js";
import { getRewardModelMetadata } from "../domain/reward-boundary.js";
import { requireAdminRole } from "../middleware/admin-auth.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";

const cashoutSearchQuerySchema = z.object({
  playerId: z.string().trim().min(1).max(128).optional(),
  cashoutRequestId: z.string().trim().min(1).max(128).optional(),
  requestId: z.string().trim().min(1).max(128).optional(),
  status: z.enum(["pending", "dispatched", "failed_retryable", "failed_terminal", "idempotency_conflict"]).optional(),
  reconciliationState: z.enum([
    "awaiting_dispatch",
    "provider_dispatched",
    "reconciled",
    "retry_required",
    "operator_review_required",
    "unknown"
  ]).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0)
}).refine((query) => {
  if (!query.from || !query.to) {
    return true;
  }
  return new Date(query.from).getTime() <= new Date(query.to).getTime();
}, {
  message: "from must be before or equal to to",
  path: ["from"]
});

export interface CashoutReconciliationServicePort {
  searchRecords(filters: Parameters<CashoutReconciliationService["searchRecords"]>[0]): ReturnType<CashoutReconciliationService["searchRecords"]>;
  getRecord(cashoutRequestId: string): ReturnType<CashoutReconciliationService["getRecord"]>;
  retryDispatch(cashoutRequestId: string, actorRequestId: string): ReturnType<CashoutReconciliationService["retryDispatch"]>;
}

export function createAdminCashoutRequestsRouter(
  reconciliationService: CashoutReconciliationServicePort,
  adminAuditRepository?: AdminAuditRepository
): Router {
  const router = Router();

  router.get("/admin/cashout-requests", async (request, response, next) => {
    try {
      const identity = requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support"]);
      const query = cashoutSearchQuerySchema.parse(request.query);
      const searchResult = await reconciliationService.searchRecords({
        ...(query.playerId ? { playerId: query.playerId } : {}),
        ...(query.cashoutRequestId ? { cashoutRequestId: query.cashoutRequestId } : {}),
        ...(query.requestId ? { requestId: query.requestId } : {}),
        ...(query.status ? { status: query.status as CashoutRequestStatus } : {}),
        ...(query.reconciliationState ? { reconciliationState: query.reconciliationState } : {}),
        ...(query.from ? { from: new Date(query.from) } : {}),
        ...(query.to ? { to: new Date(query.to) } : {}),
        limit: query.limit,
        offset: query.offset
      });
      const records = searchResult.records.map(serializeCashoutRecord);

      adminAuditRepository?.record({
        actor: identity.actor,
        role: identity.role,
        action: "admin.cashout_requests.search",
        resource: { type: "admin_search", id: request.requestId ?? "req_unavailable" },
        requestId: request.requestId ?? null,
        source: "support-search",
        outcome: "succeeded",
        before: null,
        after: null,
        metadata: {
          filters: redactQuery(query),
          returned: records.length,
          total: searchResult.total
        }
      });

      response.status(200).json(okEnvelope({
        rewardModel: getRewardModelMetadata(),
        records,
        page: {
          limit: query.limit,
          offset: query.offset,
          total: searchResult.total,
          hasMore: query.offset + query.limit < searchResult.total
        }
      }, request.requestId));
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ApiHttpError(400, {
          code: "INVALID_CASHOUT_REQUEST_QUERY",
          message: "Cashout request query is invalid.",
          details: { issues: error.issues }
        }));
        return;
      }
      recordAuthFailure(error, adminAuditRepository, request.requestId ?? null, "GET /api/admin/cashout-requests");
      next(error);
    }
  });

  router.get("/admin/cashout-requests/:cashoutRequestId", async (request, response, next) => {
    try {
      const identity = requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support"]);
      const cashoutRequestId = z.string().trim().min(1).max(128).parse(request.params.cashoutRequestId);
      const record = await reconciliationService.getRecord(cashoutRequestId);
      if (!record) {
        throw new ApiHttpError(404, {
          code: "CASHOUT_NOT_FOUND",
          message: "Cashout request was not found.",
          details: { cashoutRequestId }
        });
      }

      adminAuditRepository?.record({
        actor: identity.actor,
        role: identity.role,
        action: "admin.cashout_requests.get",
        resource: { type: "cashout_request", id: cashoutRequestId },
        requestId: request.requestId ?? null,
        source: "support-search",
        outcome: "succeeded",
        before: null,
        after: null,
        metadata: { status: record.status, reconciliationState: record.reconciliationState }
      });

      response.status(200).json(okEnvelope({
        rewardModel: getRewardModelMetadata(),
        record: serializeCashoutRecord(record)
      }, request.requestId));
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ApiHttpError(400, {
          code: "INVALID_CASHOUT_REQUEST_ID",
          message: "Cashout request ID is invalid.",
          details: { issues: error.issues }
        }));
        return;
      }
      recordAuthFailure(error, adminAuditRepository, request.requestId ?? null, "GET /api/admin/cashout-requests/:cashoutRequestId");
      next(error);
    }
  });

  router.post("/admin/cashout-requests/:cashoutRequestId/retry", async (request, response, next) => {
    try {
      const identity = requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator"]);
      const cashoutRequestId = z.string().trim().min(1).max(128).parse(request.params.cashoutRequestId);
      const actorRequestId = request.requestId ?? `req_admin_cashout_retry_${cashoutRequestId}`;
      const result = await reconciliationService.retryDispatch(cashoutRequestId, actorRequestId);

      if (!result.ok) {
        throw new ApiHttpError(result.statusCode, {
          code: result.code,
          message: messageForRetryFailure(result.code),
          details: {
            reasonCode: result.reasonCode,
            providerStatusCode: result.providerStatusCode
          }
        });
      }

      adminAuditRepository?.record({
        actor: identity.actor,
        role: identity.role,
        action: "admin.cashout_requests.retry",
        resource: { type: "cashout_request", id: cashoutRequestId },
        requestId: request.requestId ?? null,
        source: "admin-api",
        outcome: "succeeded",
        before: null,
        after: { status: result.status, reconciliationState: result.reconciliationState },
        metadata: {
          dispatchAttemptCount: result.dispatchAttemptCount
        }
      });

      console.info("[admin-cashout] cashout retry dispatched", {
        requestId: actorRequestId,
        cashoutRequestId,
        actor: identity.actor,
        status: result.status,
        dispatchAttemptCount: result.dispatchAttemptCount
      });

      response.status(200).json(okEnvelope({
        cashout_request_id: result.cashoutRequestId,
        status: result.status,
        reconciliation_state: result.reconciliationState,
        dispatch_attempt_count: result.dispatchAttemptCount
      }, request.requestId));
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ApiHttpError(400, {
          code: "INVALID_CASHOUT_REQUEST_ID",
          message: "Cashout request ID is invalid.",
          details: { issues: error.issues }
        }));
        return;
      }
      recordAuthFailure(error, adminAuditRepository, request.requestId ?? null, "POST /api/admin/cashout-requests/:cashoutRequestId/retry");
      next(error);
    }
  });

  return router;
}

function serializeCashoutRecord(record: CashoutRequestDetailRecord): Record<string, unknown> {
  return {
    cashoutRequestId: record.cashoutRequestId,
    playerId: record.playerId,
    teviSubject: record.teviSubject,
    amount: record.amount,
    status: record.status,
    reconciliationState: record.reconciliationState,
    dispatchAttemptCount: record.dispatchAttemptCount,
    failureReason: record.failureReason,
    providerStatusCode: record.providerStatusCode,
    providerResponseSummary: record.providerResponseSummary,
    requestId: record.requestId,
    walletTransactionId: record.walletTransactionId,
    relatedSpinId: record.relatedSpinId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    dispatchedAt: record.dispatchedAt?.toISOString() ?? null
  };
}

function messageForRetryFailure(code: "CASHOUT_NOT_FOUND" | "CASHOUT_RETRY_NOT_ALLOWED" | "CASHOUT_RETRY_DISPATCH_FAILED"): string {
  switch (code) {
    case "CASHOUT_NOT_FOUND":
      return "Cashout request was not found.";
    case "CASHOUT_RETRY_NOT_ALLOWED":
      return "Cashout retry is not allowed for the current status.";
    case "CASHOUT_RETRY_DISPATCH_FAILED":
      return "Cashout retry dispatch failed.";
  }
}

function redactQuery(query: ParsedCashoutSearchQuery): Record<string, unknown> {
  return {
    hasPlayerId: Boolean(query.playerId),
    hasCashoutRequestId: Boolean(query.cashoutRequestId),
    hasRequestId: Boolean(query.requestId),
    status: query.status ?? null,
    reconciliationState: query.reconciliationState ?? null,
    from: query.from ?? null,
    to: query.to ?? null,
    limit: query.limit,
    offset: query.offset
  };
}

type ParsedCashoutSearchQuery = z.infer<typeof cashoutSearchQuerySchema>;

function recordAuthFailure(
  error: unknown,
  adminAuditRepository: AdminAuditRepository | undefined,
  requestId: string | null,
  route: string
): void {
  if (!(error instanceof ApiHttpError) || !["ADMIN_UNAUTHENTICATED", "ADMIN_FORBIDDEN"].includes(error.apiError.code)) {
    return;
  }
  adminAuditRepository?.record({
    actor: "unknown-admin",
    role: "unknown",
    action: error.apiError.code === "ADMIN_UNAUTHENTICATED" ? "admin.auth.unauthenticated" : "admin.auth.forbidden",
    resource: { type: "admin_search", id: requestId ?? "req_unavailable" },
    requestId,
    source: "auth",
    outcome: "failed",
    before: null,
    after: null,
    metadata: { route }
  });
}
