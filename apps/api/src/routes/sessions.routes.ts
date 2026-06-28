import { Router } from "express";
import { ZodError } from "zod";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";
import { createSessionRequestSchema } from "../schemas/session.schema.js";
import type { SessionService } from "../domain/session-service.js";

export interface SessionsRouterOptions {
  blockedIdentityProviders?: readonly string[];
}

export function createSessionsRouter(sessionService: SessionService, options: SessionsRouterOptions = {}): Router {
  const router = Router();
  const blockedIdentityProviders = new Set(options.blockedIdentityProviders ?? []);

  router.post("/sessions", async (request, response, next) => {
    try {
      const parsedRequest = createSessionRequestSchema.parse(request.body);
      if (parsedRequest.identity && blockedIdentityProviders.has(parsedRequest.identity.provider)) {
        throw new ApiHttpError(401, {
          code: "TEVI_AUTH_REQUIRED",
          message: "Use the authenticated Tevi session route for Tevi identities.",
          details: { route: "/api/tevi/session" }
        });
      }
      const result = await sessionService.createOrResume(parsedRequest);
      response.status(result.statusCode).json(okEnvelope(result.response, request.requestId));
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ApiHttpError(400, {
          code: "INVALID_IDENTITY",
          message: "Session identity payload is invalid.",
          details: { issues: error.issues }
        }));
        return;
      }

      next(error);
    }
  });

  return router;
}
