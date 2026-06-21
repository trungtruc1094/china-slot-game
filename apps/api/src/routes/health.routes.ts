import { Router } from "express";
import { errorEnvelope, okEnvelope, type ApiError } from "../schemas/api-envelope.js";

export interface HealthResponse {
  status: "ok";
  service: "china-slot-api";
}

export interface ReadinessResponse extends HealthResponse {
  dependencies: {
    api: "ready";
    postgres?: "ready";
  };
}

export interface HealthRouterOptions {
  readinessCheck?: () => Promise<Record<string, "ready">>;
}

export function createHealthRouter(options: HealthRouterOptions = {}): Router {
  const router = Router();

  router.get("/health", (request, response) => {
    response.json(okEnvelope<HealthResponse>({
      status: "ok",
      service: "china-slot-api"
    }, request.requestId));
  });

  router.get("/ready", async (request, response) => {
    try {
      const dependencies = options.readinessCheck ? await options.readinessCheck() : {};
      response.json(okEnvelope<ReadinessResponse>({
        status: "ok",
        service: "china-slot-api",
        dependencies: {
          api: "ready",
          ...dependencies
        }
      }, request.requestId));
    } catch (error) {
      response.status(503).json(errorEnvelope(toReadinessApiError(error), request.requestId));
    }
  });

  return router;
}

function toReadinessApiError(error: unknown): ApiError {
  if (typeof error === "object" && error !== null && "toErrorDetails" in error && typeof error.toErrorDetails === "function") {
    return error.toErrorDetails() as ApiError;
  }

  return {
    code: "READINESS_CHECK_FAILED",
    message: error instanceof Error ? error.message : "Readiness check failed",
    details: {}
  };
}
