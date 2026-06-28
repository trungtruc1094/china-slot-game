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
      if (response.status >= 500 || response.status === 429) {
        this.logFailure(requestId, "PROVIDER_UNAVAILABLE", response.status);
        return {
          ok: false,
          code: failureCode,
          reasonCode: "PROVIDER_UNAVAILABLE",
          statusCode: 503
        };
      }

      this.logFailure(requestId, "PROVIDER_REJECTED", response.status);
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

    const parsedBody = tokenResponseSchema.safeParse(rawBody);
    if (!parsedBody.success) {
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
      accessToken: parsedBody.data.access_token,
      refreshToken: parsedBody.data.refresh_token
    };
    if (parsedBody.data.expires_in) {
      result.expiresAt = new Date(this.clock.now().getTime() + parsedBody.data.expires_in * 1000).toISOString();
    }

    return result;
  }

  private logFailure(requestId: string, reasonCode: TeviTokenExchangeFailure["reasonCode"], providerStatus?: number): void {
    console.warn("[tevi-token] token operation failed", {
      requestId,
      endpointPath: "/api/v1/auth/token",
      reasonCode,
      providerStatus
    });
  }
}
