import { Router } from "express";
import { ZodError } from "zod";
import type { GameConfigurationRecord, InMemoryGameConfigurationRepository } from "../domain/game-configuration-repository.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";
import {
  createDraftConfigRequestSchema,
  updateDraftConfigRequestSchema
} from "../schemas/admin-config.schema.js";

type AdminRole = "operator" | "support" | "viewer";

export function createAdminConfigRouter(configRepository: InMemoryGameConfigurationRepository): Router {
  const router = Router();

  router.post("/admin/configs/drafts", (request, response, next) => {
    try {
      const actor = requireRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator"]);
      const parsedRequest = createDraftConfigRequestSchema.parse(request.body);
      const draft = configRepository.createDraft({
        id: parsedRequest.id,
        config: parsedRequest.config,
        actor,
        metadata: parsedRequest.reason ? { reason: parsedRequest.reason } : {}
      });
      response.status(201).json(okEnvelope({ draft: serializeRecord(draft) }, request.requestId));
    } catch (error) {
      next(normalizeDraftError(error));
    }
  });

  router.put("/admin/configs/drafts/:id", (request, response, next) => {
    try {
      const actor = requireRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator"]);
      const parsedRequest = updateDraftConfigRequestSchema.parse(request.body);
      const draft = configRepository.updateDraft({
        id: request.params.id ?? "",
        config: parsedRequest.config,
        actor,
        metadata: parsedRequest.reason ? { reason: parsedRequest.reason } : {}
      });
      response.status(200).json(okEnvelope({ draft: serializeRecord(draft) }, request.requestId));
    } catch (error) {
      next(normalizeDraftError(error));
    }
  });

  router.get("/admin/configs/drafts", (request, response, next) => {
    try {
      requireRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support", "viewer"]);
      const drafts = configRepository.list()
        .filter((record) => record.status === "draft")
        .map((record) => serializeRecord(record));
      response.status(200).json(okEnvelope({ drafts }, request.requestId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/configs/drafts/:id", (request, response, next) => {
    try {
      requireRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support", "viewer"]);
      const record = configRepository.read(request.params.id ?? "");
      if (!record || record.status !== "draft") {
        throw new ApiHttpError(404, {
          code: "CONFIG_NOT_FOUND",
          message: "Draft configuration was not found.",
          details: { id: request.params.id }
        });
      }
      response.status(200).json(okEnvelope({ draft: serializeRecord(record) }, request.requestId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function requireRole(roleHeader: string | undefined, actorHeader: string | undefined, allowed: AdminRole[]): string {
  const role = roleHeader as AdminRole | undefined;
  if (!role || !allowed.includes(role)) {
    throw new ApiHttpError(403, {
      code: "ADMIN_UNAUTHORIZED",
      message: "Admin role is not authorized for this operation.",
      details: { requiredRoles: allowed }
    });
  }

  return actorHeader?.trim() || "operator-system";
}

function normalizeDraftError(error: unknown): unknown {
  if (error instanceof ZodError) {
    return new ApiHttpError(400, {
      code: "INVALID_CONFIG_DRAFT",
      message: "Draft configuration payload is invalid.",
      details: { issues: error.issues }
    });
  }
  return error;
}

function serializeRecord(record: GameConfigurationRecord): Record<string, unknown> {
  return {
    id: record.id,
    configId: record.configId,
    versionId: record.versionId,
    versionNumber: record.versionNumber ?? null,
    status: record.status,
    config: record.config,
    metadata: record.metadata,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    activatedBy: record.activatedBy ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    activatedAt: record.activatedAt?.toISOString() ?? null
  };
}
