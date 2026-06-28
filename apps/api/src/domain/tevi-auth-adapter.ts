import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey, JWTPayload } from "jose";

export interface TeviAuthContext {
  provider: "tevi";
  subject: string;
  displayName?: string;
  expiresAt: string;
}

export type TeviAuthFailureCode =
  | "TEVI_TOKEN_INVALID"
  | "TEVI_WRONG_APP"
  | "TEVI_USER_INACTIVE"
  | "TEVI_ANONYMOUS_BLOCKED";

export type TeviAuthFailureReason =
  | "TOKEN_MISSING"
  | "TOKEN_MALFORMED"
  | "TOKEN_EXPIRED"
  | "TOKEN_ALGORITHM_REJECTED"
  | "TOKEN_VERIFICATION_FAILED"
  | "APP_ID_MISMATCH"
  | "USER_ID_MISSING"
  | "USER_INACTIVE"
  | "ANONYMOUS_USER_BLOCKED"
  | "TOKEN_EXPIRY_MISSING";

export type TeviAuthResult = TeviAuthSuccess | TeviAuthFailure;

export interface TeviAuthSuccess {
  ok: true;
  context: TeviAuthContext;
}

export interface TeviAuthFailure {
  ok: false;
  statusCode: 401 | 403;
  errorCode: TeviAuthFailureCode;
  reasonCode: TeviAuthFailureReason;
}

export interface TeviAuthVerifier {
  verify(token: string): Promise<TeviAuthResult>;
}

export interface JoseTeviAuthVerifierOptions {
  appId: string;
  jwksUrl: string;
  allowAnonymousUsers: boolean;
  jwks?: JWTVerifyGetKey;
  currentDate?: Date;
}

interface TeviJwtPayload extends JWTPayload {
  user_id?: unknown;
  user_name?: unknown;
  user_is_active?: unknown;
  user_anonymous?: unknown;
  app_id?: unknown;
}

export class JoseTeviAuthVerifier implements TeviAuthVerifier {
  private readonly jwks: JWTVerifyGetKey;

  public constructor(private readonly options: JoseTeviAuthVerifierOptions) {
    this.jwks = options.jwks ?? createRemoteJWKSet(new URL(options.jwksUrl));
  }

  public async verify(token: string): Promise<TeviAuthResult> {
    if (!hasJwtShape(token)) {
      return tokenInvalid("TOKEN_MALFORMED");
    }

    let payload: TeviJwtPayload;
    try {
      const verifyOptions: Parameters<typeof jwtVerify<TeviJwtPayload>>[2] = {
        algorithms: ["RS256"]
      };
      if (this.options.currentDate) {
        verifyOptions.currentDate = this.options.currentDate;
      }
      const verified = await jwtVerify<TeviJwtPayload>(token, this.jwks, {
        ...verifyOptions
      });
      payload = verified.payload;
    } catch (error) {
      return mapJoseError(error);
    }

    if (payload.app_id !== this.options.appId) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: "TEVI_WRONG_APP",
        reasonCode: "APP_ID_MISMATCH"
      };
    }

    if (payload.user_is_active !== true) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: "TEVI_USER_INACTIVE",
        reasonCode: "USER_INACTIVE"
      };
    }

    if (payload.user_anonymous === true && !this.options.allowAnonymousUsers) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: "TEVI_ANONYMOUS_BLOCKED",
        reasonCode: "ANONYMOUS_USER_BLOCKED"
      };
    }

    if (typeof payload.user_id !== "string" || payload.user_id.trim().length === 0) {
      return tokenInvalid("USER_ID_MISSING");
    }

    if (typeof payload.exp !== "number") {
      return tokenInvalid("TOKEN_EXPIRY_MISSING");
    }

    const context: TeviAuthContext = {
      provider: "tevi",
      subject: payload.user_id.trim(),
      expiresAt: new Date(payload.exp * 1000).toISOString()
    };
    if (typeof payload.user_name === "string" && payload.user_name.trim().length > 0) {
      context.displayName = payload.user_name.trim();
    }

    return {
      ok: true,
      context
    };
  }
}

function hasJwtShape(token: string): boolean {
  return token.split(".").length === 3;
}

function mapJoseError(error: unknown): TeviAuthFailure {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

  if (code === "ERR_JWT_EXPIRED") {
    return tokenInvalid("TOKEN_EXPIRED");
  }

  if (code === "ERR_JOSE_ALG_NOT_ALLOWED") {
    return tokenInvalid("TOKEN_ALGORITHM_REJECTED");
  }

  if (code === "ERR_JWS_INVALID" || code === "ERR_JWT_INVALID") {
    return tokenInvalid("TOKEN_MALFORMED");
  }

  return tokenInvalid("TOKEN_VERIFICATION_FAILED");
}

function tokenInvalid(reasonCode: TeviAuthFailureReason): TeviAuthFailure {
  return {
    ok: false,
    statusCode: 401,
    errorCode: "TEVI_TOKEN_INVALID",
    reasonCode
  };
}
