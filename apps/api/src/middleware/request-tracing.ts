import type { RequestHandler } from "express";
import type { RequestTraceRepository } from "../domain/request-trace-repository.js";
import type { Clock } from "../domain/session-service.js";

const correlationIdHeader = "x-correlation-id";

export function requestTracingMiddleware(
  repository: RequestTraceRepository,
  clock: Clock = { now: () => new Date() }
): RequestHandler {
  return (request, response, next) => {
    const startedAt = clock.now().getTime();
    response.on("finish", () => {
      const statusCode = response.statusCode;
      const latencyMs = Math.max(0, clock.now().getTime() - startedAt);
      const correlationId = request.header(correlationIdHeader)?.trim() || request.requestId;
      const result = repository.record({
        requestId: request.requestId,
        correlationId,
        method: request.method,
        path: request.originalUrl.split("?")[0] ?? request.path,
        statusCode,
        latencyMs,
        outcome: statusCode >= 500 || statusCode >= 400 ? "failed" : "succeeded",
        adminActor: request.header("x-admin-actor")?.trim() || null,
        occurredAt: clock.now().toISOString()
      });
      if (result && typeof result === "object" && "catch" in result && typeof result.catch === "function") {
        result.catch((error: unknown) => {
          console.error("[api] request trace persistence failed", error);
        });
      }
      if (shouldLogRequests()) {
        console.info(`[api] ${request.method} ${request.originalUrl} ${statusCode} ${latencyMs}ms requestId=${request.requestId}`);
      }
    });
    next();
  };
}

function shouldLogRequests(): boolean {
  return process.env.NODE_ENV !== "test" && process.env.API_REQUEST_LOGS !== "false";
}
