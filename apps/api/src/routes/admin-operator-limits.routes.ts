import { Router } from "express";
import { ZodError } from "zod";
import type {
  InMemoryOperatorLimitsRepository,
  OperatorLimitAuditEventRecord,
  OperatorLimitRecord
} from "../domain/operator-limits-repository.js";
import { requireAdminRole } from "../middleware/admin-auth.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";
import {
  createOperatorLimitsRequestSchema,
  updateOperatorLimitsRequestSchema
} from "../schemas/operator-limits.schema.js";

export function createAdminOperatorLimitsRouter(operatorLimitsRepository: InMemoryOperatorLimitsRepository): Router {
  const router = Router();

  router.post("/admin/operator-limits", (request, response, next) => {
    try {
      const { actor } = requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator"]);
      const parsedRequest = createOperatorLimitsRequestSchema.parse(request.body);
      const operatorLimits = operatorLimitsRepository.create({
        scopeId: parsedRequest.scopeId,
        limits: parsedRequest.limits,
        actor,
        ...(parsedRequest.reason ? { reason: parsedRequest.reason } : {})
      });
      response.status(201).json(okEnvelope({ operatorLimits: serializeRecord(operatorLimits) }, request.requestId));
    } catch (error) {
      next(normalizeOperatorLimitError(error));
    }
  });

  router.put("/admin/operator-limits/:scopeId", (request, response, next) => {
    try {
      const { actor } = requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator"]);
      const parsedRequest = updateOperatorLimitsRequestSchema.parse(request.body);
      const operatorLimits = operatorLimitsRepository.update({
        scopeId: request.params.scopeId ?? "",
        limits: parsedRequest.limits,
        actor,
        ...(parsedRequest.reason ? { reason: parsedRequest.reason } : {})
      });
      response.status(200).json(okEnvelope({ operatorLimits: serializeRecord(operatorLimits) }, request.requestId));
    } catch (error) {
      next(normalizeOperatorLimitError(error));
    }
  });

  router.get("/admin/operator-limits/active", (request, response, next) => {
    try {
      requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support", "viewer"]);
      const scopeId = typeof request.query.scopeId === "string" && request.query.scopeId.trim().length > 0
        ? request.query.scopeId.trim()
        : "default";
      const operatorLimits = operatorLimitsRepository.getActiveLimits(scopeId);
      response.status(200).json(okEnvelope({
        operatorLimits: operatorLimits ? serializeRecord(operatorLimits) : null
      }, request.requestId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/operator-limits", (request, response, next) => {
    try {
      requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support", "viewer"]);
      const scopeId = typeof request.query.scopeId === "string" && request.query.scopeId.trim().length > 0
        ? request.query.scopeId.trim()
        : undefined;
      const operatorLimits = operatorLimitsRepository.list(scopeId)
        .map((record) => serializeRecord(record));
      response.status(200).json(okEnvelope({ operatorLimits }, request.requestId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/operator-limits/audit-events", (request, response, next) => {
    try {
      requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support", "viewer"]);
      const auditEvents = operatorLimitsRepository.listAuditEvents()
        .map((event) => serializeAuditEvent(event));
      response.status(200).json(okEnvelope({ auditEvents }, request.requestId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function normalizeOperatorLimitError(error: unknown): unknown {
  if (error instanceof ZodError) {
    return new ApiHttpError(400, {
      code: "INVALID_OPERATOR_LIMITS",
      message: "Operator limits payload is invalid.",
      details: { issues: error.issues }
    });
  }
  return error;
}

function serializeRecord(record: OperatorLimitRecord): Record<string, unknown> {
  return {
    id: record.id,
    scopeId: record.scopeId,
    version: record.version,
    status: record.status,
    limits: record.limits,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function serializeAuditEvent(record: OperatorLimitAuditEventRecord): Record<string, unknown> {
  return {
    id: record.id,
    action: record.action,
    targetId: record.targetId,
    actor: record.actor,
    reason: record.reason ?? null,
    metadata: record.metadata,
    createdAt: record.createdAt.toISOString()
  };
}
