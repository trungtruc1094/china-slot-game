export interface TeviMessageClientConfig {
  apiBase: string;
  messagePath: string;
  apiKey: string;
}

export interface TeviMessageSendRequest {
  teviSubject: string;
  text: string;
  requestId: string;
}

export type TeviMessageSendResult = TeviMessageSendSuccess | TeviMessageSendFailure;

export interface TeviMessageSendSuccess {
  ok: true;
  providerMessageId: string | null;
}

export interface TeviMessageSendFailure {
  ok: false;
  reasonCode: string;
  statusCode: number;
  providerStatusCode?: number;
}

export interface TeviMessageClientPort {
  sendMessage(request: TeviMessageSendRequest): Promise<TeviMessageSendResult>;
}

export interface TeviMessageClientDependencies {
  fetchImpl?: typeof fetch;
}

function extractProviderMessageId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const data = record.data && typeof record.data === "object"
    ? record.data as Record<string, unknown>
    : null;
  const candidates = [data?.id, data?.message_id, record.id, record.message_id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

export class TeviMessageClient implements TeviMessageClientPort {
  private readonly fetchImpl: typeof fetch;

  public constructor(
    private readonly config: TeviMessageClientConfig,
    dependencies: TeviMessageClientDependencies = {}
  ) {
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
  }

  public async sendMessage(request: TeviMessageSendRequest): Promise<TeviMessageSendResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.buildUrl(), {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-api-key": this.config.apiKey,
          "x-request-id": request.requestId
        },
        body: JSON.stringify({
          user: request.teviSubject,
          text: request.text,
          type: "TEXT",
          parser: "PLAIN"
        })
      });
    } catch {
      console.warn("[tevi-receipt] message provider request failed", {
        requestId: request.requestId,
        reasonCode: "PROVIDER_UNAVAILABLE"
      });
      return {
        ok: false,
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

    const providerMessageId = extractProviderMessageId(parsedJson.value);
    const record = parsedJson.value as Record<string, unknown>;
    if (record.success === false) {
      console.warn("[tevi-receipt] message provider rejected request", {
        requestId: request.requestId,
        reasonCode: "PROVIDER_REJECTED",
        errorCode: typeof record.error_code === "string" ? record.error_code : undefined
      });
      return {
        ok: false,
        reasonCode: "PROVIDER_REJECTED",
        statusCode: 502,
        providerStatusCode: response.status
      };
    }

    return {
      ok: true,
      providerMessageId
    };
  }

  private buildUrl(): string {
    return new URL(this.config.messagePath, this.config.apiBase).toString();
  }

  private mapProviderStatus(status: number, requestId: string): TeviMessageSendResult {
    if (status === 401 || status === 403) {
      console.warn("[tevi-receipt] message provider auth rejected", {
        requestId,
        providerStatusCode: status,
        reasonCode: "PROVIDER_REJECTED"
      });
      return {
        ok: false,
        reasonCode: "PROVIDER_REJECTED",
        statusCode: 401,
        providerStatusCode: status
      };
    }

    console.warn("[tevi-receipt] message provider unavailable", {
      requestId,
      providerStatusCode: status,
      reasonCode: "PROVIDER_UNAVAILABLE"
    });
    return {
      ok: false,
      reasonCode: "PROVIDER_UNAVAILABLE",
      statusCode: 503,
      providerStatusCode: status
    };
  }

  private async readJson(
    response: Response,
    requestId: string
  ): Promise<{ ok: true; value: unknown } | { ok: false; failure: TeviMessageSendFailure }> {
    try {
      return { ok: true, value: await response.json() };
    } catch {
      console.warn("[tevi-receipt] message provider response was not JSON", {
        requestId,
        reasonCode: "PROVIDER_RESPONSE_INVALID"
      });
      return {
        ok: false,
        failure: {
          ok: false,
          reasonCode: "PROVIDER_RESPONSE_INVALID",
          statusCode: 502
        }
      };
    }
  }
}
