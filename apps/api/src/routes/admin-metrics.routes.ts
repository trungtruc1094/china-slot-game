import { Router } from "express";
import { z, ZodError } from "zod";
import { MetricsService } from "../domain/metrics-service.js";
import { requireAdminRole } from "../middleware/admin-auth.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";

const metricsQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  configVersionId: z.string().trim().min(1).max(128).optional(),
  scopeId: z.string().trim().min(1).max(128).optional()
});

export function createAdminMetricsRouter(metricsService: MetricsService): Router {
  const router = Router();

  router.get("/admin/metrics", (request, response, next) => {
    try {
      requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support", "viewer"]);
      const parsedQuery = metricsQuerySchema.parse(request.query);
      const metrics = metricsService.getMetrics({
        ...(parsedQuery.from ? { from: new Date(parsedQuery.from) } : {}),
        ...(parsedQuery.to ? { to: new Date(parsedQuery.to) } : {}),
        ...(parsedQuery.configVersionId ? { configVersionId: parsedQuery.configVersionId } : {}),
        ...(parsedQuery.scopeId ? { scopeId: parsedQuery.scopeId } : {})
      });
      response.status(200).json(okEnvelope({ metrics }, request.requestId));
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ApiHttpError(400, {
          code: "INVALID_METRICS_QUERY",
          message: "Metrics query is invalid.",
          details: { issues: error.issues }
        }));
        return;
      }
      next(error);
    }
  });

  return router;
}
