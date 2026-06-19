import type { RequestHandler } from "express";
import type { RequestTraceRepository } from "../domain/request-trace-repository.js";
import type { Clock } from "../domain/session-service.js";

export function requestTracingMiddleware(
  repository: RequestTraceRepository,
  clock: Clock = { now: () => new Date() }
): RequestHandler {
  return (request, response, next) => {
    const startedAt = clock.now().getTime();
    response.on("finish", () => {
      const statusCode = response.statusCode;
      repository.record({
        correlationId: request.requestId,
        method: request.method,
        path: request.originalUrl.split("?")[0] ?? request.path,
        statusCode,
        latencyMs: Math.max(0, clock.now().getTime() - startedAt),
        outcome: statusCode >= 500 || statusCode >= 400 ? "failed" : "succeeded",
        occurredAt: clock.now().toISOString()
      });
    });
    next();
  };
}
