import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

export const requestIdHeader = "x-request-id";
const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
  }
}

export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  const incomingRequestId = request.header(requestIdHeader);
  const trimmedRequestId = incomingRequestId?.trim();
  request.requestId = trimmedRequestId && requestIdPattern.test(trimmedRequestId)
    ? trimmedRequestId
    : `req_${randomUUID()}`;
  response.setHeader(requestIdHeader, request.requestId);
  next();
}
