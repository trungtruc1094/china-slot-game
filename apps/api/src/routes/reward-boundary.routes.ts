import { Router } from "express";
import { ZodError } from "zod";
import type { AdminAuditRepository } from "../domain/admin-audit-repository.js";
import {
  getRewardBoundaryMetadata,
  isDeniedRewardType,
  findDeniedRewardTypeSignal,
  normalizeRewardType,
  rewardBoundaryMode,
  validateAllowedRewardType
} from "../domain/reward-boundary.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";
import { validateRewardTypeRequestSchema } from "../schemas/reward-boundary.schema.js";

export function createRewardBoundaryRouter(adminAuditRepository: AdminAuditRepository): Router {
  const router = Router();

  router.get("/reward-boundary", (request, response) => {
    response.status(200).json(okEnvelope(getRewardBoundaryMetadata(), request.requestId));
  });

  router.post("/reward-boundary/validate", (request, response, next) => {
    try {
      const parsedRequest = validateRewardTypeRequestSchema.parse(request.body);
      const rewardType = normalizeRewardType(parsedRequest.rewardType);

      const deniedSignal = findDeniedRewardTypeSignal(parsedRequest.rewardType);
      if (deniedSignal || isDeniedRewardType(rewardType)) {
        const deniedRewardType = deniedSignal ?? rewardType;
        adminAuditRepository.record({
          actor: "system",
          role: "system",
          action: "reward_boundary.reject",
          resource: { type: "reward_type", id: deniedRewardType },
          requestId: request.requestId,
          reason: "cash-equivalent reward type is disabled",
          source: "reward-boundary",
          outcome: "failed",
          metadata: {
            rewardType: deniedRewardType,
            boundaryMode: rewardBoundaryMode
          }
        });

        throw new ApiHttpError(403, {
          code: "REWARD_TYPE_FORBIDDEN",
          message: "Cash-equivalent or redeemable rewards are disabled for MVP launch.",
          details: { rewardType: deniedRewardType }
        });
      }

      const validation = validateAllowedRewardType(rewardType);
      if (!validation.allowed) {
        throw new ApiHttpError(400, {
          code: "UNKNOWN_REWARD_TYPE",
          message: "Reward type is not supported by the MVP reward boundary.",
          details: { rewardType }
        });
      }

      response.status(200).json(okEnvelope(validation, request.requestId));
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ApiHttpError(400, {
          code: "INVALID_REWARD_BOUNDARY_REQUEST",
          message: "Reward boundary payload is invalid.",
          details: { issues: error.issues }
        }));
        return;
      }

      next(error);
    }
  });

  return router;
}
