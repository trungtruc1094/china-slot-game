import { Router } from "express";
import { okEnvelope } from "../schemas/api-envelope.js";

export interface HealthResponse {
  status: "ok";
  service: "china-slot-api";
}

export interface ReadinessResponse extends HealthResponse {
  dependencies: {
    api: "ready";
  };
}

export function createHealthRouter(): Router {
  const router = Router();

  router.get("/health", (request, response) => {
    response.json(okEnvelope<HealthResponse>({
      status: "ok",
      service: "china-slot-api"
    }, request.requestId));
  });

  router.get("/ready", (request, response) => {
    response.json(okEnvelope<ReadinessResponse>({
      status: "ok",
      service: "china-slot-api",
      dependencies: {
        api: "ready"
      }
    }, request.requestId));
  });

  return router;
}
