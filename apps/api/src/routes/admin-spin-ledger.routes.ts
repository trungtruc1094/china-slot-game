import { Router } from "express";
import { z, ZodError } from "zod";
import type { SpinLedgerEntry, SpinService } from "../domain/spin-service.js";
import type { WalletTransactionType } from "../domain/wallet-service.js";
import { requireAdminRole } from "../middleware/admin-auth.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";

const spinLedgerQuerySchema = z.object({
  playerId: z.string().trim().min(1).max(128).optional(),
  sessionId: z.string().trim().min(1).max(128).optional(),
  spinId: z.string().trim().min(1).max(128).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  configVersionId: z.string().trim().min(1).max(128).optional(),
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

export function createAdminSpinLedgerRouter(spinService: SpinService): Router {
  const router = Router();

  router.get("/admin/spins", (request, response, next) => {
    try {
      requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support"]);
      const query = spinLedgerQuerySchema.parse(request.query);
      const matchingEntries = spinService.getLedger()
        .filter((entry) => matchesQuery(entry, query))
        .sort((left, right) => right.acceptedAt.getTime() - left.acceptedAt.getTime());
      const records = matchingEntries
        .slice(query.offset, query.offset + query.limit)
        .map((entry) => serializeSpinLedgerEntry(entry));

      response.status(200).json(okEnvelope({
        records,
        page: {
          limit: query.limit,
          offset: query.offset,
          total: matchingEntries.length,
          hasMore: query.offset + query.limit < matchingEntries.length
        }
      }, request.requestId));
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ApiHttpError(400, {
          code: "INVALID_SPIN_LEDGER_QUERY",
          message: "Spin ledger query is invalid.",
          details: { issues: error.issues }
        }));
        return;
      }
      next(error);
    }
  });

  return router;
}

type ParsedSpinLedgerQuery = z.infer<typeof spinLedgerQuerySchema>;

function matchesQuery(entry: SpinLedgerEntry, query: ParsedSpinLedgerQuery): boolean {
  if (query.playerId && entry.playerId !== query.playerId) {
    return false;
  }
  if (query.sessionId && entry.sessionId !== query.sessionId) {
    return false;
  }
  if (query.spinId && entry.spinId !== query.spinId) {
    return false;
  }
  if (query.configVersionId && entry.configVersionId !== query.configVersionId) {
    return false;
  }
  if (query.from && entry.acceptedAt.getTime() < new Date(query.from).getTime()) {
    return false;
  }
  if (query.to && entry.acceptedAt.getTime() > new Date(query.to).getTime()) {
    return false;
  }
  if (query.transactionType && !entry.walletTransactions.some((transaction) => transaction.type === query.transactionType)) {
    return false;
  }
  return true;
}

function serializeSpinLedgerEntry(entry: SpinLedgerEntry): Record<string, unknown> {
  const firstTransaction = entry.walletTransactions[0];
  const lastTransaction = entry.walletTransactions[entry.walletTransactions.length - 1];
  return {
    spinId: entry.spinId,
    sessionId: entry.sessionId,
    playerId: entry.playerId,
    configVersionId: entry.configVersionId,
    wager: entry.wager,
    reelStops: entry.reelStops,
    visibleWindow: entry.visibleWindow,
    winBreakdown: entry.winBreakdown,
    payout: entry.payout,
    balanceBefore: firstTransaction?.balanceBefore ?? null,
    balanceAfter: lastTransaction?.balanceAfter ?? entry.balanceAfter,
    transactionTypes: entry.walletTransactions.map((transaction) => transaction.type satisfies WalletTransactionType),
    acceptedAt: entry.acceptedAt.toISOString()
  };
}
