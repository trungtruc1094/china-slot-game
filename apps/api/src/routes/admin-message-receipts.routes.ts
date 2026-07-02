import { Router } from "express";
import { z, ZodError } from "zod";
import type { AdminAuditRepository } from "../domain/admin-audit-repository.js";
import type {
  TeviMessageReceiptRecord,
  TeviMessageReceiptStatus,
  TeviMessageReceiptType,
  TeviReceiptServicePort
} from "../domain/tevi-receipt-service.js";
import { getRewardModelMetadata } from "../domain/reward-boundary.js";
import { requireAdminRole } from "../middleware/admin-auth.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";

const receiptSearchQuerySchema = z.object({
  playerId: z.string().trim().min(1).max(128).optional(),
  receiptId: z.string().trim().min(1).max(128).optional(),
  sourceEventId: z.string().trim().min(1).max(128).optional(),
  messageType: z.enum(["topup_credit", "cashout_dispatch"]).optional(),
  status: z.enum(["pending", "sent", "failed_retryable", "failed_terminal"]).optional(),
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

export function createAdminMessageReceiptsRouter(
  receiptService: TeviReceiptServicePort,
  adminAuditRepository?: AdminAuditRepository
): Router {
  const router = Router();

  router.get("/admin/message-receipts", async (request, response, next) => {
    try {
      const identity = requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support"]);
      const query = receiptSearchQuerySchema.parse(request.query);
      const searchResult = await receiptService.searchRecords({
        ...(query.playerId ? { playerId: query.playerId } : {}),
        ...(query.receiptId ? { receiptId: query.receiptId } : {}),
        ...(query.sourceEventId ? { sourceEventId: query.sourceEventId } : {}),
        ...(query.messageType ? { messageType: query.messageType as TeviMessageReceiptType } : {}),
        ...(query.status ? { status: query.status as TeviMessageReceiptStatus } : {}),
        ...(query.from ? { from: new Date(query.from) } : {}),
        ...(query.to ? { to: new Date(query.to) } : {}),
        limit: query.limit,
        offset: query.offset
      });
      const records = searchResult.records.map(serializeReceiptRecord);

      adminAuditRepository?.record({
        actor: identity.actor,
        role: identity.role,
        action: "admin.message_receipts.search",
        resource: { type: "admin_search", id: request.requestId ?? "req_unavailable" },
        requestId: request.requestId ?? null,
        source: "support-search",
        outcome: "succeeded",
        before: null,
        after: null,
        metadata: {
          resultCount: records.length,
          total: searchResult.total,
          filters: {
            playerId: query.playerId ?? null,
            messageType: query.messageType ?? null,
            status: query.status ?? null
          }
        }
      });

      response.json(okEnvelope({
        records,
        total: searchResult.total,
        limit: query.limit,
        offset: query.offset,
        reward_model: getRewardModelMetadata()
      }, request.requestId ?? "req_unavailable"));
    } catch (error) {
      next(error instanceof ZodError ? new ApiHttpError(400, {
        code: "INVALID_QUERY",
        message: "Invalid message receipt search query.",
        details: { issues: error.issues }
      }) : error);
    }
  });

  router.get("/admin/message-receipts/:receiptId", async (request, response, next) => {
    try {
      const identity = requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support"]);
      const record = await receiptService.getRecord(request.params.receiptId);
      if (!record) {
        throw new ApiHttpError(404, {
          code: "RECEIPT_NOT_FOUND",
          message: "Message receipt not found.",
          details: { receiptId: request.params.receiptId }
        });
      }

      adminAuditRepository?.record({
        actor: identity.actor,
        role: identity.role,
        action: "admin.message_receipts.detail",
        resource: { type: "message_receipt", id: record.receiptId },
        requestId: request.requestId ?? null,
        source: "support-search",
        outcome: "succeeded",
        before: null,
        after: null,
        metadata: { messageType: record.messageType, status: record.status }
      });

      response.json(okEnvelope({
        record: serializeReceiptRecord(record),
        reward_model: getRewardModelMetadata()
      }, request.requestId ?? "req_unavailable"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/message-receipts/:receiptId/retry", async (request, response, next) => {
    try {
      const identity = requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator"]);
      const result = await receiptService.retryDispatch(
        request.params.receiptId,
        request.requestId ?? `req_admin_receipt_retry_${Date.now()}`
      );

      adminAuditRepository?.record({
        actor: identity.actor,
        role: identity.role,
        action: "admin.message_receipts.retry",
        resource: { type: "message_receipt", id: request.params.receiptId },
        requestId: request.requestId ?? null,
        source: "admin-api",
        outcome: result.ok ? "succeeded" : "failed",
        before: null,
        after: result.ok ? { status: result.status, dispatchAttemptCount: result.dispatchAttemptCount } : null,
        metadata: result.ok ? {} : { code: result.code, reasonCode: result.reasonCode }
      });

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

      response.json(okEnvelope({
        receipt_id: result.receiptId,
        status: result.status,
        dispatch_attempt_count: result.dispatchAttemptCount,
        reward_model: getRewardModelMetadata()
      }, request.requestId ?? "req_unavailable"));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function serializeReceiptRecord(record: TeviMessageReceiptRecord): Record<string, unknown> {
  return {
    receipt_id: record.receiptId,
    message_type: record.messageType,
    recipient_tevi_subject: record.recipientTeviSubject,
    player_id: record.playerId,
    source_event_id: record.sourceEventId,
    source_correlation_key: record.sourceCorrelationKey,
    amount: record.amount,
    cashout_status: record.cashoutStatus,
    status: record.status,
    dispatch_attempt_count: record.dispatchAttemptCount,
    failure_reason: record.failureReason,
    provider_status_code: record.providerStatusCode,
    provider_response_summary: record.providerResponseSummary,
    message_body_preview: record.messageBodyPreview,
    request_id: record.requestId,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
    sent_at: record.sentAt?.toISOString() ?? null
  };
}

function messageForRetryFailure(code: string): string {
  switch (code) {
    case "RECEIPT_NOT_FOUND":
      return "Message receipt not found.";
    case "RECEIPT_RETRY_NOT_ALLOWED":
      return "This message receipt cannot be retried.";
    case "RECEIPT_RETRY_DISPATCH_FAILED":
      return "Message receipt retry failed.";
    default:
      return "Message receipt retry failed.";
  }
}
