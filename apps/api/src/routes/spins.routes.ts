import { Router } from "express";
import { ZodError } from "zod";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";
import { createSpinRequestSchema } from "../schemas/spin.schema.js";
import type { SpinService } from "../domain/spin-service.js";

export function createSpinsRouter(spinService: SpinService): Router {
  const router = Router();

  router.post("/spins", async (request, response, next) => {
    try {
      const parsedRequest = createSpinRequestSchema.parse(request.body);
      const spin = await spinService.spin(parsedRequest);
      response.status(200).json(okEnvelope(spin, request.requestId));
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ApiHttpError(400, {
          code: "INVALID_WAGER",
          message: "Spin request is invalid.",
          details: { issues: error.issues }
        }));
        return;
      }

      next(error);
    }
  });

  return router;
}
