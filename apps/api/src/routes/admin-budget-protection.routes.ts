import { Router } from "express";
import { ZodError } from "zod";
import type {
  BudgetProtectionActionRecord,
  BudgetProtectionAuditEventRecord,
  InMemoryBudgetProtectionRepository
} from "../domain/budget-protection-repository.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";
import {
  applyBudgetProtectionRequestSchema,
  revertBudgetProtectionRequestSchema
} from "../schemas/budget-protection.schema.js";

type AdminRole = "operator" | "support" | "viewer";

export function createAdminBudgetProtectionRouter(
  budgetProtectionRepository: InMemoryBudgetProtectionRepository,
  enabled: boolean
): Router {
  const router = Router();

  router.post("/admin/budget-protection/actions", (request, response, next) => {
    try {
      assertEnabled(enabled);
      const actor = requireRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator"]);
      const parsedRequest = applyBudgetProtectionRequestSchema.parse(request.body);
      const action = budgetProtectionRepository.apply({ ...parsedRequest, actor });
      response.status(201).json(okEnvelope({ action: serializeAction(action) }, request.requestId));
    } catch (error) {
      next(normalizeBudgetProtectionError(error));
    }
  });

  router.post("/admin/budget-protection/actions/:id/revert", (request, response, next) => {
    try {
      assertEnabled(enabled);
      const actor = requireRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator"]);
      const parsedRequest = revertBudgetProtectionRequestSchema.parse(request.body);
      const action = budgetProtectionRepository.revert(request.params.id ?? "", actor, parsedRequest.reason);
      response.status(200).json(okEnvelope({ action: serializeAction(action) }, request.requestId));
    } catch (error) {
      next(normalizeBudgetProtectionError(error));
    }
  });

  router.get("/admin/budget-protection/actions", (request, response, next) => {
    try {
      requireRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support", "viewer"]);
      const scopeId = typeof request.query.scopeId === "string" && request.query.scopeId.trim().length > 0
        ? request.query.scopeId.trim()
        : undefined;
      response.status(200).json(okEnvelope({
        actions: budgetProtectionRepository.list(scopeId).map((action) => serializeAction(action))
      }, request.requestId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/budget-protection/audit-events", (request, response, next) => {
    try {
      requireRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support", "viewer"]);
      response.status(200).json(okEnvelope({
        auditEvents: budgetProtectionRepository.listAuditEvents().map((event) => serializeAuditEvent(event))
      }, request.requestId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function assertEnabled(enabled: boolean): void {
  if (!enabled) {
    throw new ApiHttpError(409, {
      code: "BUDGET_PROTECTION_DISABLED",
      message: "Budget protection actions are disabled for this environment.",
      details: {}
    });
  }
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

function normalizeBudgetProtectionError(error: unknown): unknown {
  if (error instanceof ZodError) {
    return new ApiHttpError(400, {
      code: "INVALID_BUDGET_PROTECTION_ACTION",
      message: "Budget protection payload is invalid.",
      details: { issues: error.issues }
    });
  }
  return error;
}

function serializeAction(record: BudgetProtectionActionRecord): Record<string, unknown> {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    revertedAt: record.revertedAt?.toISOString() ?? null,
    revertedBy: record.revertedBy ?? null,
    revertedReason: record.revertedReason ?? null
  };
}

function serializeAuditEvent(record: BudgetProtectionAuditEventRecord): Record<string, unknown> {
  return {
    ...record,
    createdAt: record.createdAt.toISOString()
  };
}
