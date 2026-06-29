import { z } from "zod";
import type { IssueDepositTokenRequest, TeviPaymentClientPort, TeviPaymentClientResult } from "./topup-service.js";

export interface TeviPaymentClientConfig {
  apiBase: string;
  depositTokenPath: string;
  apiKey: string;
  secretKey: string;
}

export interface TeviPaymentClientDependencies {
  fetchImpl?: typeof fetch;
}

const depositTokenResponseSchema = z.union([
  z.object({
    success: z.boolean().optional(),
    data: z.object({
      deposit_token: z.string().trim().min(1)
    })
  }),
  z.object({
    deposit_token: z.string().trim().min(1)
  })
]);

export class TeviPaymentClient implements TeviPaymentClientPort {
  private readonly fetchImpl: typeof fetch;

  public constructor(
    private readonly config: TeviPaymentClientConfig,
    dependencies: TeviPaymentClientDependencies = {}
  ) {
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
  }

  public async issueDepositToken(request: IssueDepositTokenRequest): Promise<TeviPaymentClientResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.buildUrl(), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
          "x-tevi-secret-key": this.config.secretKey,
          "x-request-id": request.requestId
        },
        body: JSON.stringify({
          app_id: request.appId,
          billing_channel_id: request.billingChannelId,
          amount: request.amount,
          external_player_id: request.playerId,
          tevi_user_id: request.teviSubject
        })
      });
    } catch {
      console.warn("[tevi-payment] provider request failed", {
        requestId: request.requestId,
        reasonCode: "PROVIDER_UNAVAILABLE"
      });
      return {
        ok: false,
        code: "TEVI_TOP_UP_SIGNATURE_FAILED",
        reasonCode: "PROVIDER_UNAVAILABLE",
        statusCode: 503
      };
    }

    if (!response.ok) {
      return this.mapProviderStatus(response.status, request.requestId);
    }

    const parsedJson = await this.readJson(response, request.requestId);
    if (!parsedJson.ok) {
      return parsedJson.failure;
    }

    const parsedResponse = depositTokenResponseSchema.safeParse(parsedJson.value);
    if (!parsedResponse.success) {
      console.warn("[tevi-payment] provider response rejected", {
        requestId: request.requestId,
        reasonCode: "PROVIDER_RESPONSE_INVALID"
      });
      return {
        ok: false,
        code: "TEVI_TOP_UP_SIGNATURE_FAILED",
        reasonCode: "PROVIDER_RESPONSE_INVALID",
        statusCode: 502
      };
    }

    const depositToken = "data" in parsedResponse.data
      ? parsedResponse.data.data.deposit_token
      : parsedResponse.data.deposit_token;

    return {
      ok: true,
      depositToken
    };
  }

  private buildUrl(): string {
    return new URL(this.config.depositTokenPath, this.config.apiBase).toString();
  }

  private mapProviderStatus(status: number, requestId: string): TeviPaymentClientResult {
    if (status === 401 || status === 403) {
      console.warn("[tevi-payment] provider rejected deposit token request", {
        requestId,
        providerStatusCode: status,
        reasonCode: "PROVIDER_REJECTED"
      });
      return {
        ok: false,
        code: "TEVI_TOP_UP_SIGNATURE_FAILED",
        reasonCode: "PROVIDER_REJECTED",
        statusCode: 401,
        providerStatusCode: status
      };
    }

    console.warn("[tevi-payment] provider unavailable for deposit token request", {
      requestId,
      providerStatusCode: status,
      reasonCode: "PROVIDER_UNAVAILABLE"
    });
    return {
      ok: false,
      code: "TEVI_TOP_UP_SIGNATURE_FAILED",
      reasonCode: "PROVIDER_UNAVAILABLE",
      statusCode: 503,
      providerStatusCode: status
    };
  }

  private async readJson(response: Response, requestId: string): Promise<{ ok: true; value: unknown } | { ok: false; failure: TeviPaymentClientResult }> {
    try {
      return { ok: true, value: await response.json() };
    } catch {
      console.warn("[tevi-payment] provider response was not JSON", {
        requestId,
        reasonCode: "PROVIDER_RESPONSE_INVALID"
      });
      return {
        ok: false,
        failure: {
          ok: false,
          code: "TEVI_TOP_UP_SIGNATURE_FAILED",
          reasonCode: "PROVIDER_RESPONSE_INVALID",
          statusCode: 502
        }
      };
    }
  }
}
