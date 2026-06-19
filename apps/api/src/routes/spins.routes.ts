import { Router } from "express";
import { ZodError } from "zod";
import type { AdminAuditRepository } from "../domain/admin-audit-repository.js";
import { findDeniedRewardTypeSignal, rewardBoundaryMode } from "../domain/reward-boundary.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";
import { createSpinRequestSchema } from "../schemas/spin.schema.js";
import type { SpinService } from "../domain/spin-service.js";

export function createSpinsRouter(spinService: SpinService, adminAuditRepository?: AdminAuditRepository): Router {
  const router = Router();

  router.post("/spins", async (request, response, next) => {
    try {
      rejectCashEquivalentSignals(request.body, request.requestId, adminAuditRepository);
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

function rejectCashEquivalentSignals(
  body: unknown,
  requestId: string,
  adminAuditRepository: AdminAuditRepository | undefined
): void {
  const deniedRewardType = findDeniedRewardTypeSignal(body);
  if (!deniedRewardType) {
    return;
  }

  adminAuditRepository?.record({
    actor: "system",
    role: "system",
    action: "reward_boundary.reject",
    resource: { type: "reward_type", id: deniedRewardType },
    requestId,
    reason: "cash-equivalent reward type is disabled",
    source: "reward-boundary",
    outcome: "failed",
    metadata: {
      rewardType: deniedRewardType,
      boundaryMode: rewardBoundaryMode,
      route: "POST /api/spins"
    }
  });

  throw new ApiHttpError(403, {
    code: "REWARD_TYPE_FORBIDDEN",
    message: "Cash-equivalent or redeemable rewards are disabled for MVP launch.",
    details: { rewardType: deniedRewardType }
  });
}
