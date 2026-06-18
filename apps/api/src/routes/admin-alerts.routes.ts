import { Router } from "express";
import { ZodError } from "zod";
import { AlertService } from "../domain/alert-service.js";
import type { AlertHistoryEventRecord, AlertRuleRecord, InMemoryAlertRepository } from "../domain/alert-repository.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";
import {
  acknowledgeAlertRequestSchema,
  alertEvaluationRequestSchema,
  alertRuleRequestSchema
} from "../schemas/alert.schema.js";

type AdminRole = "operator" | "support" | "viewer";

export function createAdminAlertsRouter(
  alertRepository: InMemoryAlertRepository,
  alertService: AlertService
): Router {
  const router = Router();

  router.post("/admin/alert-rules", (request, response, next) => {
    try {
      const actor = requireRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator"]);
      const parsedRequest = alertRuleRequestSchema.parse(request.body);
      const alertRule = alertRepository.upsertRule({ ...parsedRequest, actor });
      response.status(201).json(okEnvelope({ alertRule: serializeRule(alertRule) }, request.requestId));
    } catch (error) {
      next(normalizeAlertError(error, "INVALID_ALERT_RULE"));
    }
  });

  router.get("/admin/alert-rules", (request, response, next) => {
    try {
      requireRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support", "viewer"]);
      const scopeId = typeof request.query.scopeId === "string" && request.query.scopeId.trim().length > 0
        ? request.query.scopeId.trim()
        : undefined;
      response.status(200).json(okEnvelope({
        alertRules: alertRepository.listRules(scopeId).map((rule) => serializeRule(rule))
      }, request.requestId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/alerts/evaluate", (request, response, next) => {
    try {
      requireRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support"]);
      const parsedRequest = alertEvaluationRequestSchema.parse(request.body);
      const alerts = alertService.evaluate({
        ...(parsedRequest.from ? { from: new Date(parsedRequest.from) } : {}),
        ...(parsedRequest.to ? { to: new Date(parsedRequest.to) } : {}),
        ...(parsedRequest.scopeId ? { scopeId: parsedRequest.scopeId } : {}),
        ...(parsedRequest.configVersionId ? { configVersionId: parsedRequest.configVersionId } : {})
      });
      response.status(200).json(okEnvelope({ alerts: alerts.map((alert) => serializeEvent(alert)) }, request.requestId));
    } catch (error) {
      next(normalizeAlertError(error, "INVALID_ALERT_EVALUATION"));
    }
  });

  router.get("/admin/alerts", (request, response, next) => {
    try {
      requireRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support", "viewer"]);
      const scopeId = typeof request.query.scopeId === "string" && request.query.scopeId.trim().length > 0
        ? request.query.scopeId.trim()
        : undefined;
      response.status(200).json(okEnvelope({
        alerts: alertRepository.listHistory(scopeId).map((alert) => serializeEvent(alert))
      }, request.requestId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/alerts/:id/acknowledge", (request, response, next) => {
    try {
      const actor = requireRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support"]);
      const parsedRequest = acknowledgeAlertRequestSchema.parse(request.body);
      const alert = alertRepository.acknowledge(request.params.id ?? "", actor, parsedRequest.reason);
      response.status(200).json(okEnvelope({ alert: serializeEvent(alert) }, request.requestId));
    } catch (error) {
      next(normalizeAlertError(error, "INVALID_ALERT_ACKNOWLEDGMENT"));
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

function normalizeAlertError(error: unknown, code: string): unknown {
  if (error instanceof ZodError) {
    return new ApiHttpError(400, {
      code,
      message: "Alert payload is invalid.",
      details: { issues: error.issues }
    });
  }
  return error;
}

function serializeRule(rule: AlertRuleRecord): Record<string, unknown> {
  return {
    ...rule,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString()
  };
}

function serializeEvent(alert: AlertHistoryEventRecord): Record<string, unknown> {
  return {
    ...alert,
    windowStartAt: alert.windowStartAt?.toISOString() ?? null,
    windowEndAt: alert.windowEndAt?.toISOString() ?? null,
    createdAt: alert.createdAt.toISOString()
  };
}
