import type { ErrorRequestHandler, RequestHandler } from "express";
import { errorEnvelope, type ApiError } from "../schemas/api-envelope.js";

export class ApiHttpError extends Error {
  public readonly statusCode: number;
  public readonly apiError: ApiError;

  public constructor(statusCode: number, apiError: ApiError) {
    super(apiError.message);
    this.statusCode = statusCode;
    this.apiError = apiError;
  }
}

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(new ApiHttpError(404, {
    code: "ROUTE_NOT_FOUND",
    message: `No route matches ${request.method} ${request.path}`,
    details: { method: request.method, path: request.path }
  }));
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  const requestId = request.requestId ?? "req_unavailable";

  if (error instanceof ApiHttpError) {
    response.status(error.statusCode).json(errorEnvelope(error.apiError, requestId));
    return;
  }

  if (isJsonParseError(error)) {
    response.status(400).json(errorEnvelope({
      code: "INVALID_JSON_BODY",
      message: "Request body must be valid JSON.",
      details: {}
    }, requestId));
    return;
  }

  response.status(500).json(errorEnvelope({
    code: "INTERNAL_SERVER_ERROR",
    message: "Unexpected API error.",
    details: {}
  }, requestId));
};

function isJsonParseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { status?: unknown; type?: unknown };
  return candidate.status === 400 && candidate.type === "entity.parse.failed";
}
