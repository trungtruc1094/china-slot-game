import { Router } from "express";
import { z, ZodError } from "zod";
import type { AdminAuditEventRecord, AdminAuditRepository } from "../domain/admin-audit-repository.js";
import { requireAdminRole } from "../middleware/admin-auth.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";

const adminAuditQuerySchema = z.object({
  actor: z.string().trim().min(1).max(128).optional(),
  action: z.string().trim().min(1).max(128).optional(),
  resourceType: z.string().trim().min(1).max(128).optional(),
  resourceId: z.string().trim().min(1).max(128).optional(),
  requestId: z.string().trim().min(1).max(128).optional(),
  source: z.string().trim().min(1).max(128).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0)
}).refine((query) => {
  if (!query.from || !query.to) {
    return true;
  }
  return new Date(query.from).getTime() <= new Date(query.to).getTime();
}, {
  message: "from must be before or equal to to",
  path: ["from"]
});

export function createAdminAuditRouter(adminAuditRepository: AdminAuditRepository): Router {
  const router = Router();

  router.get("/admin/audit-events", async (request, response, next) => {
    try {
      requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support"]);
      const query = adminAuditQuerySchema.parse(request.query);
      const matchingEvents = (await adminAuditRepository.list())
        .filter((event) => matchesQuery(event, query))
        .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime() || right.id.localeCompare(left.id));
      const events = matchingEvents
        .slice(query.offset, query.offset + query.limit)
        .map((event) => serializeEvent(event));

      response.status(200).json(okEnvelope({
        events,
        page: {
          limit: query.limit,
          offset: query.offset,
          total: matchingEvents.length,
          hasMore: query.offset + query.limit < matchingEvents.length
        }
      }, request.requestId));
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ApiHttpError(400, {
          code: "INVALID_ADMIN_AUDIT_QUERY",
          message: "Admin audit query is invalid.",
          details: { issues: error.issues }
        }));
        return;
      }
      next(error);
    }
  });

  return router;
}

type ParsedAdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;

function matchesQuery(event: AdminAuditEventRecord, query: ParsedAdminAuditQuery): boolean {
  if (query.actor && event.actor !== query.actor) {
    return false;
  }
  if (query.action && event.action !== query.action) {
    return false;
  }
  if (query.resourceType && event.resource.type !== query.resourceType) {
    return false;
  }
  if (query.resourceId && event.resource.id !== query.resourceId) {
    return false;
  }
  if (query.requestId && event.requestId !== query.requestId) {
    return false;
  }
  if (query.source && event.source !== query.source) {
    return false;
  }
  if (query.from && event.occurredAt.getTime() < new Date(query.from).getTime()) {
    return false;
  }
  if (query.to && event.occurredAt.getTime() > new Date(query.to).getTime()) {
    return false;
  }
  return true;
}

function serializeEvent(event: AdminAuditEventRecord): Record<string, unknown> {
  return {
    id: event.id,
    occurredAt: event.occurredAt.toISOString(),
    actor: event.actor,
    role: event.role,
    action: event.action,
    resource: event.resource,
    requestId: event.requestId,
    reason: event.reason,
    source: event.source,
    outcome: event.outcome,
    before: event.before,
    after: event.after,
    metadata: event.metadata
  };
}
