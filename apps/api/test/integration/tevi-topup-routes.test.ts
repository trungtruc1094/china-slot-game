import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryPlayerSessionRepository } from "../../src/domain/player-identity.js";
import { SessionService, type Clock } from "../../src/domain/session-service.js";
import type { TeviAuthResult, TeviAuthVerifier } from "../../src/domain/tevi-auth-adapter.js";
import type { TopupSignatureResult } from "../../src/domain/topup-service.js";
import type { TopupServicePort } from "../../src/routes/tevi-topup.routes.js";

class FixedClock implements Clock {
  public now(): Date {
    return new Date("2026-06-29T00:00:00.000Z");
  }
}

class FakeTeviVerifier implements TeviAuthVerifier {
  public async verify(token: string): Promise<TeviAuthResult> {
    if (token === "valid-token") {
      return {
        ok: true,
        context: {
          provider: "tevi",
          subject: "tevi-user-1",
          displayName: "Tevi Player",
          expiresAt: "2026-06-30T00:00:00.000Z"
        }
      };
    }

    return { ok: false, statusCode: 401, errorCode: "TEVI_TOKEN_INVALID", reasonCode: "TOKEN_VERIFICATION_FAILED" };
  }
}

class FakeTopupService implements TopupServicePort {
  public calls: Parameters<TopupServicePort["issueSignature"]>[0][] = [];

  public constructor(private readonly result: TopupSignatureResult) {}

  public async issueSignature(request: Parameters<TopupServicePort["issueSignature"]>[0]): Promise<TopupSignatureResult> {
    this.calls.push(request);
    return this.result;
  }
}

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let topupService: FakeTopupService;

const successResult: TopupSignatureResult = {
  ok: true,
  depositToken: "provider.deposit.token",
  tokenFingerprint: "safe-token-fingerprint"
};

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

async function startServer(result: TopupSignatureResult = successResult): Promise<void> {
  const sessionRepository = new InMemoryPlayerSessionRepository();
  topupService = new FakeTopupService(result);
  server = createServer(createApp({
    clock: new FixedClock(),
    sessionService: new SessionService(sessionRepository, new FixedClock()),
    teviAuthVerifier: new FakeTeviVerifier(),
    topupService
  }));
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function postTopup(body: unknown, token = "valid-token"): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/payments/top-up-signature`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "req_tevi_topup_test",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

describe("Tevi top-up signature route", () => {
  it("issues a deposit token for an authenticated Tevi player", async () => {
    await startServer();

    const response = await postTopup({ amount: 100 });

    expect(response.status).toBe(201);
    const bodyText = await response.text();
    expect(bodyText).toContain("provider.deposit.token");
    expect(bodyText).not.toContain("safe-token-fingerprint");
    expect(JSON.parse(bodyText)).toEqual({
      data: { deposit_token: "provider.deposit.token" },
      error: null,
      requestId: "req_tevi_topup_test"
    });
    expect(topupService.calls).toEqual([expect.objectContaining({
      playerId: expect.stringMatching(/^player_/),
      teviAuth: expect.objectContaining({ subject: "tevi-user-1" }),
      amount: 100,
      requestId: "req_tevi_topup_test"
    })]);
  });

  it("requires bearer authentication", async () => {
    await startServer();

    const response = await postTopup({ amount: 100 }, "");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "TEVI_AUTH_REQUIRED" },
      requestId: "req_tevi_topup_test"
    });
    expect(topupService.calls).toHaveLength(0);
  });

  it("rejects invalid bearer tokens before service calls", async () => {
    await startServer();

    const response = await postTopup({ amount: 100 }, "invalid-token");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "TEVI_TOKEN_INVALID" },
      requestId: "req_tevi_topup_test"
    });
    expect(topupService.calls).toHaveLength(0);
  });

  it.each([{ amount: 0 }, { amount: -1 }, { amount: 1.5 }, { amount: "100" }, { amount: null }, {}])("rejects invalid body %o before service calls", async (body) => {
    await startServer();

    const response = await postTopup(body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "INVALID_TOP_UP_AMOUNT" },
      requestId: "req_tevi_topup_test"
    });
    expect(topupService.calls).toHaveLength(0);
  });

  it("maps service failures to stable API envelopes without token leakage", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await startServer({
      ok: false,
      code: "TEVI_TOP_UP_SIGNATURE_FAILED",
      reasonCode: "PROVIDER_UNAVAILABLE",
      statusCode: 503,
      providerStatusCode: 503
    });

    const response = await postTopup({ amount: 100 });

    expect(response.status).toBe(503);
    const bodyText = await response.text();
    expect(bodyText).not.toContain("provider.deposit.token");
    expect(JSON.parse(bodyText)).toEqual({
      data: null,
      error: {
        code: "TEVI_TOP_UP_SIGNATURE_FAILED",
        message: "Tevi top-up signature could not be issued.",
        details: {
          reasonCode: "PROVIDER_UNAVAILABLE"
        }
      },
      requestId: "req_tevi_topup_test"
    });
    warnSpy.mockRestore();
  });

  it.each([
    ["TEVI_TOP_UP_LIMIT_EXCEEDED" as const, "AMOUNT_ABOVE_MAX", 400, "Top-up amount exceeds configured deposit limits."],
    ["TEVI_PAYMENT_CONFIG_MISSING" as const, "PAYMENT_CONFIG_MISSING", 503, "Tevi payment configuration is unavailable."],
    ["TEVI_TOP_UP_DUPLICATE_REQUEST" as const, "REQUEST_ID_ALREADY_USED", 409, "Top-up request was already processed."]
  ])("maps %s service failures to safe envelopes", async (code, reasonCode, statusCode, message) => {
    await startServer({
      ok: false,
      code,
      reasonCode,
      statusCode
    });

    const response = await postTopup({ amount: 100 });

    expect(response.status).toBe(statusCode);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code,
        message,
        details: { reasonCode }
      },
      requestId: "req_tevi_topup_test"
    });
  });
});
