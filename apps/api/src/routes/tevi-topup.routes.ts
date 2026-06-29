import { Router } from "express";
import { ZodError, z } from "zod";
import type { SessionService } from "../domain/session-service.js";
import type { TeviAuthVerifier } from "../domain/tevi-auth-adapter.js";
import type { TopupSignatureRequest, TopupSignatureResult } from "../domain/topup-service.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { createTeviAuthMiddleware } from "../middleware/tevi-auth.js";
import { okEnvelope } from "../schemas/api-envelope.js";

export interface TopupServicePort {
  issueSignature(request: TopupSignatureRequest): Promise<TopupSignatureResult>;
}

const topupSignatureRequestSchema = z.object({
  amount: z.number().int().positive().safe()
});

export function createTeviTopupRouter(
  topupService: TopupServicePort,
  sessionService: SessionService,
  verifier: TeviAuthVerifier
): Router {
  const router = Router();
  const requireTeviAuth = createTeviAuthMiddleware(verifier);

  router.post("/v1/payments/top-up-signature", requireTeviAuth, async (request, response, next) => {
    try {
      const parsedRequest = topupSignatureRequestSchema.parse(request.body ?? {});
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
      if (!request.teviAuthToken) {
        throw new ApiHttpError(401, {
          code: "TEVI_AUTH_REQUIRED",
          message: "A valid Tevi bearer token is required.",
          details: {}
        });
      }

      const result = await topupService.issueSignature({
        playerId: sessionResult.response.playerId,
        teviAuth: request.teviAuth,
        amount: parsedRequest.amount,
        requestId: request.requestId,
        userAppToken: request.teviAuthToken
      });

      if (!result.ok) {
        throw new ApiHttpError(result.statusCode, {
          code: result.code,
          message: messageForTopupFailure(result.code),
          details: {
            reasonCode: result.reasonCode
          }
        });
      }

      console.info("[tevi-topup] deposit token issued", {
        requestId: request.requestId,
        playerId: sessionResult.response.playerId,
        teviSubject: request.teviAuth.subject,
        amount: parsedRequest.amount,
        status: "issued",
        depositTokenFingerprint: result.tokenFingerprint
      });
      response.status(201).json(okEnvelope({ deposit_token: result.depositToken }, request.requestId));
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ApiHttpError(400, {
          code: "INVALID_TOP_UP_AMOUNT",
          message: "Top-up amount must be a positive integer Star amount.",
          details: { issues: error.issues }
        }));
        return;
      }

      next(error);
    }
  });

  return router;
}

function messageForTopupFailure(code: TopupSignatureResult extends infer Result ? Result extends { ok: false; code: infer Code } ? Code : never : never): string {
  switch (code) {
    case "INVALID_TOP_UP_AMOUNT":
      return "Top-up amount must be a positive integer Star amount.";
    case "TEVI_TOP_UP_LIMIT_EXCEEDED":
      return "Top-up amount exceeds configured deposit limits.";
    case "TEVI_PAYMENT_CONFIG_MISSING":
      return "Tevi payment configuration is unavailable.";
    case "TEVI_AUTH_REQUIRED":
      return "A valid Tevi bearer token is required.";
    case "TEVI_TOP_UP_DUPLICATE_REQUEST":
      return "Top-up request was already processed.";
    case "TEVI_TOP_UP_SIGNATURE_FAILED":
      return "Tevi top-up signature could not be issued.";
  }
}
