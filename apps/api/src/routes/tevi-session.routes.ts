import { Router } from "express";
import { ZodError, z } from "zod";
import type { SessionService } from "../domain/session-service.js";
import type { TeviAuthVerifier } from "../domain/tevi-auth-adapter.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { createTeviAuthMiddleware } from "../middleware/tevi-auth.js";
import { okEnvelope } from "../schemas/api-envelope.js";

const teviSessionRequestSchema = z.object({
  resumeSessionId: z.string().trim().min(1).optional()
});

export function createTeviSessionRouter(sessionService: SessionService, verifier: TeviAuthVerifier): Router {
  const router = Router();
  const requireTeviAuth = createTeviAuthMiddleware(verifier);

  router.post("/tevi/session", requireTeviAuth, async (request, response, next) => {
    try {
      if (!request.teviAuth) {
        throw new ApiHttpError(401, {
          code: "TEVI_AUTH_REQUIRED",
          message: "A valid Tevi bearer token is required.",
          details: {}
        });
      }

      const parsedRequest = teviSessionRequestSchema.parse(request.body ?? {});
      const result = await sessionService.createOrResume({
        identity: request.teviAuth,
        ...parsedRequest
      });
      response.status(result.statusCode).json(okEnvelope(result.response, request.requestId));
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ApiHttpError(400, {
          code: "INVALID_TEVI_SESSION_REQUEST",
          message: "Tevi session payload is invalid.",
          details: { issues: error.issues }
        }));
        return;
      }

      next(error);
    }
  });

  router.get("/tevi/me", requireTeviAuth, (request, response, next) => {
    if (!request.teviAuth) {
      next(new ApiHttpError(401, {
        code: "TEVI_AUTH_REQUIRED",
        message: "A valid Tevi bearer token is required.",
        details: {}
      }));
      return;
    }

    response.status(200).json(okEnvelope({
      provider: request.teviAuth.provider,
      expiresAt: request.teviAuth.expiresAt
    }, request.requestId));
  });

  return router;
}
