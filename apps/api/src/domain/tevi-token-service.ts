import { z } from "zod";

export interface TeviTokenServiceConfig {
  appId: string;
  apiBase: string;
}

export interface TeviTokenServiceDependencies {
  fetchImpl?: typeof fetch;
  clock?: { now: () => Date };
}

export type TeviTokenExchangeResult = TeviTokenExchangeSuccess | TeviTokenExchangeFailure;

export interface TeviTokenExchangeSuccess {
  ok: true;
  accessToken: string;
  refreshToken: string;
  expiresAt?: string;
}

export interface TeviTokenExchangeFailure {
  ok: false;
  code: "TEVI_TOKEN_EXCHANGE_FAILED" | "TEVI_TOKEN_REFRESH_FAILED" | "TEVI_REAUTH_REQUIRED";
  reasonCode: "PROVIDER_REJECTED" | "PROVIDER_RESPONSE_INVALID" | "PROVIDER_UNAVAILABLE";
  statusCode: 401 | 502 | 503;
}

export interface TeviTokenServicePort {
  exchangeRuntimeToken(runtimeToken: string, requestId: string): Promise<TeviTokenExchangeResult>;
  refreshAccessToken(refreshToken: string, requestId: string): Promise<TeviTokenExchangeResult>;
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive().optional()
});

const tokenEnvelopeResponseSchema = z.object({
  success: z.literal(true).optional(),
  data: tokenResponseSchema
});

function parseTokenResponse(rawBody: unknown): z.infer<typeof tokenResponseSchema> | undefined {
  const parsedEnvelope = tokenEnvelopeResponseSchema.safeParse(rawBody);
  if (parsedEnvelope.success) {
    return parsedEnvelope.data.data;
  }

  const parsedFlatBody = tokenResponseSchema.safeParse(rawBody);
  if (parsedFlatBody.success) {
    return parsedFlatBody.data;
  }

  return undefined;
}

// Structure-only summary (key names + types, never values) of a provider error body, so a
// rejection can be diagnosed from logs without leaking whatever the body contains.
function describeResponseShape(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return { type: value === null ? "null" : typeof value };
  }
  const record = value as Record<string, unknown>;
  const shape: Record<string, unknown> = { topKeys: Object.keys(record).sort() };
  const data = record.data;
  if (data && typeof data === "object") {
    shape.dataKeys = Object.keys(data as Record<string, unknown>).sort();
  }
  return shape;
}

async function describeErrorBody(response: Response): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { bodyReadFailed: true };
  }
  if (!text) {
    return { empty: true };
  }
  try {
    return describeResponseShape(JSON.parse(text));
  } catch {
    // Non-JSON error body (e.g. plain "Unauthorized") — record only its length, not the text.
    return { nonJson: true, length: text.length };
  }
}

// Decode ONLY the non-sensitive claims (exp / iat / app_id) of the bearer we sent, so a 401 can
// be triaged as "token expired" vs "wrong app" without ever logging the token itself.
function decodeSafeTokenClaims(token: string): { exp?: number; iat?: number; app_id?: string } | undefined {
  const segments = token.split(".");
  const payloadSegment = segments[1];
  if (!payloadSegment) {
    return undefined;
  }
  try {
    const payloadJson = Buffer.from(payloadSegment.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const claims = JSON.parse(payloadJson) as Record<string, unknown>;
    const safe: { exp?: number; iat?: number; app_id?: string } = {};
    if (typeof claims.exp === "number") safe.exp = claims.exp;
    if (typeof claims.iat === "number") safe.iat = claims.iat;
    if (typeof claims.app_id === "string") safe.app_id = claims.app_id;
    return Object.keys(safe).length > 0 ? safe : undefined;
  } catch {
    return undefined;
  }
}

export class TeviTokenService implements TeviTokenServicePort {
  private readonly fetchImpl: typeof fetch;
  private readonly clock: { now: () => Date };

  public constructor(private readonly config: TeviTokenServiceConfig, dependencies: TeviTokenServiceDependencies = {}) {
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.clock = dependencies.clock ?? { now: () => new Date("2026-06-28T00:00:00.000Z") };
  }

  public async exchangeRuntimeToken(runtimeToken: string, requestId: string): Promise<TeviTokenExchangeResult> {
    return this.requestTokenGrant(runtimeToken, requestId, "TEVI_TOKEN_EXCHANGE_FAILED");
  }

  public async refreshAccessToken(refreshToken: string, requestId: string): Promise<TeviTokenExchangeResult> {
    return this.requestTokenGrant(refreshToken, requestId, "TEVI_TOKEN_REFRESH_FAILED");
  }

  private async requestTokenGrant(bearerToken: string, requestId: string, failureCode: TeviTokenExchangeFailure["code"]): Promise<TeviTokenExchangeResult> {
    const endpoint = new URL("/api/v1/auth/token", this.config.apiBase);
    endpoint.searchParams.set("app_id", this.config.appId);

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint.toString(), {
        method: "GET",
        headers: {
          authorization: `Bearer ${bearerToken}`
        }
      });
    } catch {
      this.logFailure(requestId, "PROVIDER_UNAVAILABLE");
      return {
        ok: false,
        code: failureCode,
        reasonCode: "PROVIDER_UNAVAILABLE",
        statusCode: 503
      };
    }

    if (!response.ok) {
      // Token-safe diagnostics: the error body's *shape* (key names only) and the *sent* token's
      // non-sensitive exp/app_id claims — enough to tell "expired" vs "wrong app" vs "shape change"
      // apart, without ever logging the token or the provider response values.
      const diagnostics = {
        responseShape: await describeErrorBody(response),
        sentTokenClaims: decodeSafeTokenClaims(bearerToken)
      };

      if (response.status >= 500 || response.status === 429) {
        this.logFailure(requestId, "PROVIDER_UNAVAILABLE", response.status, diagnostics);
        return {
          ok: false,
          code: failureCode,
          reasonCode: "PROVIDER_UNAVAILABLE",
          statusCode: 503
        };
      }

      this.logFailure(requestId, "PROVIDER_REJECTED", response.status, diagnostics);
      return {
        ok: false,
        code: failureCode,
        reasonCode: "PROVIDER_REJECTED",
        statusCode: 401
      };
    }

    let rawBody: unknown;
    try {
      rawBody = await response.json();
    } catch {
      this.logFailure(requestId, "PROVIDER_RESPONSE_INVALID", response.status);
      return {
        ok: false,
        code: failureCode,
        reasonCode: "PROVIDER_RESPONSE_INVALID",
        statusCode: 502
      };
    }

    const parsedBody = parseTokenResponse(rawBody);
    if (!parsedBody) {
      this.logFailure(requestId, "PROVIDER_RESPONSE_INVALID", response.status);
      return {
        ok: false,
        code: failureCode,
        reasonCode: "PROVIDER_RESPONSE_INVALID",
        statusCode: 502
      };
    }

    const result: TeviTokenExchangeSuccess = {
      ok: true,
      accessToken: parsedBody.access_token,
      refreshToken: parsedBody.refresh_token
    };
    if (parsedBody.expires_in) {
      result.expiresAt = new Date(this.clock.now().getTime() + parsedBody.expires_in * 1000).toISOString();
    }

    return result;
  }

  private logFailure(
    requestId: string,
    reasonCode: TeviTokenExchangeFailure["reasonCode"],
    providerStatus?: number,
    diagnostics?: Record<string, unknown>
  ): void {
    console.warn("[tevi-token] token operation failed", {
      requestId,
      endpointPath: "/api/v1/auth/token",
      reasonCode,
      providerStatus,
      ...diagnostics
    });
  }
}
