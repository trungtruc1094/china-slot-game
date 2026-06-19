import { Router } from "express";
import { z, ZodError } from "zod";
import type { WalletService, WalletTransactionRecord } from "../domain/wallet-service.js";
import { requireAdminRole } from "../middleware/admin-auth.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";

const balanceTransactionQuerySchema = z.object({
  playerId: z.string().trim().min(1).max(128).optional(),
  sessionId: z.string().trim().min(1).max(128).optional(),
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

export function createAdminBalanceTransactionsRouter(walletService: WalletService): Router {
  const router = Router();

  router.get("/admin/balance-transactions", (request, response, next) => {
    try {
      requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support"]);
      const query = balanceTransactionQuerySchema.parse(request.query);
      const matchingTransactions = walletService.listTransactions()
        .filter((transaction) => matchesQuery(transaction, query))
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
      const records = matchingTransactions
        .slice(query.offset, query.offset + query.limit)
        .map((transaction) => serializeTransaction(transaction));

      response.status(200).json(okEnvelope({
        records,
        page: {
          limit: query.limit,
          offset: query.offset,
          total: matchingTransactions.length,
          hasMore: query.offset + query.limit < matchingTransactions.length
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
      next(error);
    }
  });

  return router;
}

type ParsedBalanceTransactionQuery = z.infer<typeof balanceTransactionQuerySchema>;

function matchesQuery(transaction: WalletTransactionRecord, query: ParsedBalanceTransactionQuery): boolean {
  if (query.playerId && transaction.playerId !== query.playerId) {
    return false;
  }
  if (query.sessionId && transaction.source !== query.sessionId) {
    return false;
  }
  if (query.transactionType && transaction.type !== query.transactionType) {
    return false;
  }
  if (query.from && new Date(transaction.createdAt).getTime() < new Date(query.from).getTime()) {
    return false;
  }
  if (query.to && new Date(transaction.createdAt).getTime() > new Date(query.to).getTime()) {
    return false;
  }
  return true;
}

function serializeTransaction(transaction: WalletTransactionRecord): Record<string, unknown> {
  return {
    transactionId: transaction.transactionId,
    playerId: transaction.playerId,
    transactionType: transaction.type,
    amount: transaction.amount,
    balanceBefore: transaction.balanceBefore,
    balanceAfter: transaction.balanceAfter,
    actor: transaction.actor,
    source: transaction.source,
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
