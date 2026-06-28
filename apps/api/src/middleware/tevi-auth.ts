import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiHttpError } from "./error-handler.js";
import type { TeviAuthContext, TeviAuthFailure, TeviAuthVerifier } from "../domain/tevi-auth-adapter.js";

const bearerPrefix = "Bearer ";

declare module "express-serve-static-core" {
  interface Request {
    teviAuth?: TeviAuthContext;
  }
}

export function createTeviAuthMiddleware(verifier: TeviAuthVerifier): RequestHandler {
  return async (request: Request, _response: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(request.header("authorization"));
    if (!token) {
      next(new ApiHttpError(401, {
        code: "TEVI_AUTH_REQUIRED",
        message: "A valid Tevi bearer token is required.",
        details: {}
      }));
      return;
    }

    const result = await verifier.verify(token);
    if (!result.ok) {
      console.warn("[tevi-auth] authentication rejected", {
        requestId: request.requestId,
        provider: "tevi",
        reasonCode: result.reasonCode,
        appIdMatched: getAppIdMatched(result)
      });
      next(new ApiHttpError(result.statusCode, {
        code: result.errorCode,
        message: messageForFailure(result),
        details: { reasonCode: result.reasonCode }
      }));
      return;
    }

    request.teviAuth = result.context;
    next();
  };
}

function extractBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue?.startsWith(bearerPrefix)) {
    return null;
  }

  const token = headerValue.slice(bearerPrefix.length).trim();
  return token.length > 0 ? token : null;
}

function getAppIdMatched(failure: TeviAuthFailure): boolean | undefined {
  return failure.reasonCode === "APP_ID_MISMATCH" ? false : undefined;
}

function messageForFailure(failure: TeviAuthFailure): string {
  switch (failure.errorCode) {
    case "TEVI_WRONG_APP":
      return "Tevi token is not valid for this app.";
    case "TEVI_USER_INACTIVE":
      return "Tevi user is inactive.";
    case "TEVI_ANONYMOUS_BLOCKED":
      return "Anonymous Tevi users are not allowed.";
    case "TEVI_TOKEN_INVALID":
      return "Tevi token could not be authenticated.";
  }
}
