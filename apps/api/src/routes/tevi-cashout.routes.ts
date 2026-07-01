import { Router } from "express";
import { ZodError, z } from "zod";
import type { CashoutRequestResult } from "../domain/cashout-request-service.js";
import type { TeviAuthContext } from "../domain/tevi-auth-adapter.js";
import type { SessionService } from "../domain/session-service.js";
import type { TeviAuthVerifier } from "../domain/tevi-auth-adapter.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { createTeviAuthMiddleware } from "../middleware/tevi-auth.js";
import { okEnvelope } from "../schemas/api-envelope.js";

export interface CashoutRequestServicePort {
  requestCashout(request: {
    playerId: string;
    teviAuth: TeviAuthContext;
    amount: number;
    requestId: string;
  }): Promise<CashoutRequestResult>;
}

const cashoutRequestSchema = z.object({
  amount: z.number().int().positive().safe()
});

export function createTeviCashoutRouter(
  cashoutService: CashoutRequestServicePort,
  sessionService: SessionService,
  verifier: TeviAuthVerifier
): Router {
  const router = Router();
  const requireTeviAuth = createTeviAuthMiddleware(verifier);

  router.post("/v1/payments/cashout-requests", requireTeviAuth, async (request, response, next) => {
    try {
      const parsedRequest = cashoutRequestSchema.parse(request.body ?? {});
      if (!request.teviAuth) {
        throw new ApiHttpError(401, {
          code: "TEVI_AUTH_REQUIRED",
          message: "A valid Tevi bearer token is required.",
          details: {}
        });
      }

      const sessionResult = await sessionService.createOrResume({
        identity: request.teviAuth
      });

      const result = await cashoutService.requestCashout({
        playerId: sessionResult.response.playerId,
        teviAuth: request.teviAuth,
        amount: parsedRequest.amount,
        requestId: request.requestId
      });

      if (!result.ok) {
        throw new ApiHttpError(result.statusCode, {
          code: result.code,
          message: messageForCashoutFailure(result.code),
          details: {
            reasonCode: result.reasonCode,
            providerStatusCode: result.providerStatusCode
          }
        });
      }

      console.info("[tevi-cashout] cashout request processed", {
        requestId: request.requestId,
        playerId: sessionResult.response.playerId,
        teviSubject: request.teviAuth.subject,
        amount: parsedRequest.amount,
        status: result.status,
        cashoutRequestId: result.cashoutRequestId
      });

      response.status(201).json(okEnvelope({
        cashout_request_id: result.cashoutRequestId,
        status: result.status,
        amount: result.amount,
        balance_after: result.balanceAfter,
        idempotency_key: result.idempotencyKey,
        wallet_transaction_id: result.walletTransactionId
      }, request.requestId));
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ApiHttpError(400, {
          code: "INVALID_CASHOUT_AMOUNT",
          message: "Cashout amount must be a positive integer Star amount.",
          details: { issues: error.issues }
        }));
        return;
      }

      next(error);
    }
  });

  return router;
}

function messageForCashoutFailure(code: CashoutRequestResult extends infer Result ? Result extends { ok: false; code: infer Code } ? Code : never : never): string {
  switch (code) {
    case "INVALID_CASHOUT_AMOUNT":
      return "Cashout amount must be a positive integer Star amount.";
    case "INSUFFICIENT_BALANCE":
      return "Cashout amount exceeds your withdrawable Stars balance.";
    case "TEVI_AUTH_REQUIRED":
      return "A valid Tevi bearer token is required.";
    case "TEVI_PAYMENT_CONFIG_MISSING":
      return "Tevi payment configuration is unavailable.";
    case "TEVI_CASHOUT_DUPLICATE_REQUEST":
      return "Cashout request was already processed.";
    case "TEVI_CASHOUT_IDEMPOTENCY_CONFLICT":
      return "Cashout idempotency conflict requires operator review.";
    case "TEVI_CASHOUT_DISPATCH_FAILED":
      return "Tevi cashout dispatch failed.";
  }
}
