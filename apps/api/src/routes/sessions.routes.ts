import { Router } from "express";
import { ZodError } from "zod";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";
import { createSessionRequestSchema } from "../schemas/session.schema.js";
import type { SessionService } from "../domain/session-service.js";

export function createSessionsRouter(sessionService: SessionService): Router {
  const router = Router();

  router.post("/sessions", (request, response, next) => {
    try {
      const parsedRequest = createSessionRequestSchema.parse(request.body);
      const result = sessionService.createOrResume(parsedRequest);
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
