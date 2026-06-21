import { Router } from "express";
import { z, ZodError } from "zod";
import type { AdminAuditRepository } from "../domain/admin-audit-repository.js";
import { getRewardModelMetadata } from "../domain/reward-boundary.js";
import type { WalletOperations, WalletTransactionRecord } from "../domain/wallet-service.js";
import { requireAdminRole } from "../middleware/admin-auth.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";

const balanceTransactionQuerySchema = z.object({
  playerId: z.string().trim().min(1).max(128).optional(),
  sessionId: z.string().trim().min(1).max(128).optional(),
  spinId: z.string().trim().min(1).max(128).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  transactionType: z.enum(["debit", "credit", "free_spin_award", "jackpot_award", "adjustment"]).optional(),
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

export function createAdminBalanceTransactionsRouter(
  walletService: WalletOperations,
  adminAuditRepository?: AdminAuditRepository
): Router {
  const router = Router();

  router.get("/admin/balance-transactions", async (request, response, next) => {
    try {
      const identity = requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support"]);
      const query = balanceTransactionQuerySchema.parse(request.query);
      const searchResult = await walletService.searchTransactions({
        ...(query.playerId ? { playerId: query.playerId } : {}),
        ...(query.sessionId ? { source: query.sessionId } : {}),
        ...(query.spinId ? { spinId: query.spinId } : {}),
        ...(query.transactionType ? { type: query.transactionType } : {}),
        ...(query.from ? { createdFrom: new Date(query.from) } : {}),
        ...(query.to ? { createdTo: new Date(query.to) } : {}),
        limit: query.limit,
        offset: query.offset
      });
      const records = searchResult.records.map((transaction) => serializeTransaction(transaction));

      adminAuditRepository?.record({
        actor: identity.actor,
        role: identity.role,
        action: "admin.balance_transactions.search",
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
          code: "INVALID_BALANCE_TRANSACTION_QUERY",
          message: "Balance transaction query is invalid.",
          details: { issues: error.issues }
        }));
        return;
      }
      recordAuthFailure(error, adminAuditRepository, request.requestId ?? null);
      next(error);
    }
  });

  return router;
}

function recordAuthFailure(
  error: unknown,
  adminAuditRepository: AdminAuditRepository | undefined,
  requestId: string | null
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
    metadata: { route: "GET /api/admin/balance-transactions" }
  });
}

function redactQuery(query: ParsedBalanceTransactionQuery): Record<string, unknown> {
  return {
    hasPlayerId: Boolean(query.playerId),
    hasSessionId: Boolean(query.sessionId),
    hasSpinId: Boolean(query.spinId),
    from: query.from ?? null,
    to: query.to ?? null,
    transactionType: query.transactionType ?? null,
    limit: query.limit,
    offset: query.offset
  };
}

type ParsedBalanceTransactionQuery = z.infer<typeof balanceTransactionQuerySchema>;

function serializeTransaction(transaction: WalletTransactionRecord): Record<string, unknown> {
  return {
    transactionId: transaction.transactionId,
    playerId: transaction.playerId,
    transactionType: transaction.type,
    amount: transaction.amount,
    balanceBefore: transaction.balanceBefore,
    balanceAfter: transaction.balanceAfter,
    rewardModel: getRewardModelMetadata(),
    actor: transaction.actor,
    source: transaction.source,
    correlationId: transaction.correlationId,
    sessionId: transaction.source,
    spinId: typeof transaction.metadata.spinId === "string" ? transaction.metadata.spinId : null,
    createdAt: transaction.createdAt,
    metadata: serializeMetadata(transaction.metadata)
  };
}

function serializeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => ["spinId", "clientSpinId"].includes(key))
  );
}
