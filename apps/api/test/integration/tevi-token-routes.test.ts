import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryPlayerSessionRepository } from "../../src/domain/player-identity.js";
import { SessionService, type Clock } from "../../src/domain/session-service.js";
import type { TeviAuthResult, TeviAuthVerifier } from "../../src/domain/tevi-auth-adapter.js";
import type { TeviTokenExchangeResult, TeviTokenServicePort } from "../../src/domain/tevi-token-service.js";

class FixedClock implements Clock {
  public now(): Date {
    return new Date("2026-06-28T12:00:00.000Z");
  }
}

class FakeTeviVerifier implements TeviAuthVerifier {
  public async verify(token: string): Promise<TeviAuthResult> {
    if (token === "provider-access-token" || token === "provider-refreshed-access-token") {
      return {
        ok: true,
        context: {
          provider: "tevi",
          subject: "tevi-user-1",
          displayName: "Tevi Player",
          expiresAt: "2026-06-29T00:00:00.000Z"
        }
      };
    }

    return { ok: false, statusCode: 401, errorCode: "TEVI_TOKEN_INVALID", reasonCode: "TOKEN_VERIFICATION_FAILED" };
  }
}

class FakeTeviTokenService implements TeviTokenServicePort {
  public constructor(
    private readonly result: TeviTokenExchangeResult,
    private readonly refreshResult: TeviTokenExchangeResult = result
  ) {}

  public async exchangeRuntimeToken(): Promise<TeviTokenExchangeResult> {
    return this.result;
  }

  public async refreshAccessToken(): Promise<TeviTokenExchangeResult> {
    return this.refreshResult;
  }
}

let server: ReturnType<typeof createServer>;
let baseUrl: string;
const recoverableFailureCases: Array<["TEVI_TOKEN_EXCHANGE_FAILED" | "TEVI_TOKEN_REFRESH_FAILED", "PROVIDER_REJECTED", 401]> = [
  ["TEVI_TOKEN_EXCHANGE_FAILED", "PROVIDER_REJECTED", 401],
  ["TEVI_TOKEN_REFRESH_FAILED", "PROVIDER_REJECTED", 401]
];

afterEach(async () => {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

async function startServer(result: TeviTokenExchangeResult, refreshResult: TeviTokenExchangeResult = result): Promise<void> {
  const sessionService = new SessionService(new InMemoryPlayerSessionRepository(), new FixedClock());
  server = createServer(createApp({
    clock: new FixedClock(),
    sessionService,
    teviAuthVerifier: new FakeTeviVerifier(),
    teviTokenService: new FakeTeviTokenService(result, refreshResult)
  }));
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function startServerWithoutVerifier(result: TeviTokenExchangeResult): Promise<void> {
  server = createServer(createApp({
    clock: new FixedClock(),
    teviTokenService: new FakeTeviTokenService(result)
  }));
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function postToken(runtimeToken?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/tevi/token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "req_tevi_token_test"
    },
    body: JSON.stringify(runtimeToken ? { runtimeToken } : {})
  });
}

async function postRefresh(sessionId?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/tevi/token/refresh`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "req_tevi_refresh_test"
    },
    body: JSON.stringify(sessionId ? { sessionId } : {})
  });
}

describe("Tevi token route", () => {
  it("exchanges a runtime token and returns only safe auth metadata", async () => {
    await startServer({
      ok: true,
      accessToken: "provider-access-token",
      refreshToken: "provider-refresh-token",
      expiresAt: "2026-06-29T00:00:00.000Z"
    });

    const response = await postToken("runtime-token");

    expect(response.status).toBe(201);
    const bodyText = await response.text();
    expect(bodyText).not.toContain("runtime-token");
    expect(bodyText).not.toContain("provider-access-token");
    expect(bodyText).not.toContain("provider-refresh-token");
    expect(JSON.parse(bodyText)).toMatchObject({
      data: {
        status: "authenticated",
        accessTokenExpiresAt: "2026-06-29T00:00:00.000Z",
        reauthRequired: false,
        session: {
          sessionId: expect.stringMatching(/^sess_/),
          playerId: expect.stringMatching(/^player_/),
          balance: {
            points: 1000
          }
        }
      },
      error: null,
      requestId: "req_tevi_token_test"
    });
  });

  it("rejects missing runtime tokens with a recoverable envelope", async () => {
    await startServer({
      ok: true,
      accessToken: "provider-access-token",
      refreshToken: "provider-refresh-token"
    });

    const response = await postToken();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: {
        code: "INVALID_TEVI_TOKEN_REQUEST",
        message: "Tevi token exchange payload is invalid."
      },
      requestId: "req_tevi_token_test"
    });
  });

  it("fails closed when token exchange cannot bind a verified internal session", async () => {
    await startServerWithoutVerifier({
      ok: true,
      accessToken: "provider-access-token",
      refreshToken: "provider-refresh-token"
    });

    const response = await postToken("runtime-token");

    expect(response.status).toBe(503);
    const bodyText = await response.text();
    expect(bodyText).not.toContain("runtime-token");
    expect(bodyText).not.toContain("provider-access-token");
    expect(bodyText).not.toContain("provider-refresh-token");
    expect(JSON.parse(bodyText)).toEqual({
      data: null,
      error: {
        code: "TEVI_AUTH_UNAVAILABLE",
        message: "Tevi authentication is temporarily unavailable.",
        details: {
          reasonCode: "AUTH_SESSION_BINDING_UNAVAILABLE",
          reauthRequired: true
        }
      },
      requestId: "req_tevi_token_test"
    });
  });

  it("refreshes access token metadata through a session-bound backend refresh token", async () => {
    await startServer({
      ok: true,
      accessToken: "provider-access-token",
      refreshToken: "provider-refresh-token",
      expiresAt: "2026-06-29T00:00:00.000Z"
    }, {
      ok: true,
      accessToken: "provider-refreshed-access-token",
      refreshToken: "provider-rotated-refresh-token",
      expiresAt: "2026-06-30T00:00:00.000Z"
    });
    const exchangeResponse = await postToken("runtime-token");
    const exchangeBody = await exchangeResponse.json() as { data: { session: { sessionId: string } } };

    const response = await postRefresh(exchangeBody.data.session.sessionId);

    expect(response.status).toBe(200);
    const bodyText = await response.text();
    expect(bodyText).not.toContain("runtime-token");
    expect(bodyText).not.toContain("provider-access-token");
    expect(bodyText).not.toContain("provider-refresh-token");
    expect(bodyText).not.toContain("provider-refreshed-access-token");
    expect(bodyText).not.toContain("provider-rotated-refresh-token");
    expect(JSON.parse(bodyText)).toMatchObject({
      data: {
        status: "authenticated",
        accessTokenExpiresAt: "2026-06-30T00:00:00.000Z",
        reauthRequired: false,
        session: {
          sessionId: exchangeBody.data.session.sessionId,
          playerId: expect.stringMatching(/^player_/),
          session: {
            resumed: true
          }
        }
      },
      error: null,
      requestId: "req_tevi_refresh_test"
    });
  });

  it("maps refresh failures to safe recoverable responses", async () => {
    await startServer({
      ok: true,
      accessToken: "provider-access-token",
      refreshToken: "provider-refresh-token"
    }, {
      ok: false,
      code: "TEVI_TOKEN_REFRESH_FAILED",
      reasonCode: "PROVIDER_REJECTED",
      statusCode: 401
    });
    const exchangeResponse = await postToken("runtime-token");
    const exchangeBody = await exchangeResponse.json() as { data: { session: { sessionId: string } } };

    const response = await postRefresh(exchangeBody.data.session.sessionId);

    expect(response.status).toBe(401);
    const bodyText = await response.text();
    expect(bodyText).not.toContain("provider-refresh-token");
    expect(JSON.parse(bodyText)).toEqual({
      data: null,
      error: {
        code: "TEVI_TOKEN_REFRESH_FAILED",
        message: "Tevi authentication requires a new sign-in.",
        details: {
          reasonCode: "PROVIDER_REJECTED",
          reauthRequired: true
        }
      },
      requestId: "req_tevi_refresh_test"
    });
  });

  it.each(recoverableFailureCases)("maps %s failures to safe recoverable responses", async (code, reasonCode, statusCode) => {
    await startServer({
      ok: false,
      code,
      reasonCode,
      statusCode
    });

    const response = await postToken("runtime-token");

    expect(response.status).toBe(statusCode);
    const bodyText = await response.text();
    expect(bodyText).not.toContain("runtime-token");
    expect(JSON.parse(bodyText)).toEqual({
      data: null,
      error: {
        code,
        message: "Tevi authentication requires a new sign-in.",
        details: {
          reasonCode,
          reauthRequired: true
        }
      },
      requestId: "req_tevi_token_test"
    });
  });
});
