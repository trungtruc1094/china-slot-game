import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryPlayerSessionRepository } from "../../src/domain/player-identity.js";
import { SessionService, type Clock } from "../../src/domain/session-service.js";
import type { TeviAuthResult, TeviAuthVerifier } from "../../src/domain/tevi-auth-adapter.js";
import type { ApiEnvelope } from "../../src/schemas/api-envelope.js";
import type { SessionResponse } from "../../src/schemas/session.schema.js";

class FixedClock implements Clock {
  public now(): Date {
    return new Date("2026-06-28T12:00:00.000Z");
  }
}

class FakeTeviVerifier implements TeviAuthVerifier {
  public async verify(token: string): Promise<TeviAuthResult> {
    if (token === "valid-same-user" || token === "valid-same-user-again") {
      return {
        ok: true,
        context: {
          provider: "tevi",
          subject: "tevi-user-1",
          displayName: "Tevi Player",
          expiresAt: "2026-06-28T13:00:00.000Z"
        }
      };
    }

    if (token === "valid-other-user") {
      return {
        ok: true,
        context: {
          provider: "tevi",
          subject: "tevi-user-2",
          expiresAt: "2026-06-28T13:00:00.000Z"
        }
      };
    }

    if (token === "wrong-app") {
      return { ok: false, statusCode: 403, errorCode: "TEVI_WRONG_APP", reasonCode: "APP_ID_MISMATCH" };
    }

    if (token === "inactive") {
      return { ok: false, statusCode: 403, errorCode: "TEVI_USER_INACTIVE", reasonCode: "USER_INACTIVE" };
    }

    if (token === "anonymous") {
      return { ok: false, statusCode: 403, errorCode: "TEVI_ANONYMOUS_BLOCKED", reasonCode: "ANONYMOUS_USER_BLOCKED" };
    }

    return { ok: false, statusCode: 401, errorCode: "TEVI_TOKEN_INVALID", reasonCode: "TOKEN_VERIFICATION_FAILED" };
  }
}

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let repository: InMemoryPlayerSessionRepository;
let sessionService: SessionService;

beforeEach(async () => {
  repository = new InMemoryPlayerSessionRepository();
  sessionService = new SessionService(repository, new FixedClock());
  server = createServer(createApp({
    clock: new FixedClock(),
    sessionService,
    teviAuthVerifier: new FakeTeviVerifier()
  }));
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
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

async function postTeviSession(token?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/tevi/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "req_tevi_auth_test",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({})
  });
}

async function postTeviSessionWithAuthorization(authorization: string): Promise<Response> {
  return fetch(`${baseUrl}/api/tevi/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "req_tevi_auth_test",
      authorization
    },
    body: JSON.stringify({})
  });
}

describe("Tevi authenticated routes", () => {
  it("rejects missing bearer tokens with the standard envelope", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await postTeviSession();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: "TEVI_AUTH_REQUIRED",
        message: "A valid Tevi bearer token is required.",
        details: {}
      },
      requestId: "req_tevi_auth_test"
    });
    expect(warnSpy).toHaveBeenCalledWith("[tevi-auth] authentication rejected", {
      requestId: "req_tevi_auth_test",
      provider: "tevi",
      reasonCode: "TOKEN_MISSING",
      appIdMatched: undefined
    });
    warnSpy.mockRestore();
  });

  it("accepts bearer auth schemes case-insensitively", async () => {
    const response = await postTeviSessionWithAuthorization("bearer valid-same-user");
    const body = await response.json() as ApiEnvelope<SessionResponse>;

    expect(response.status).toBe(201);
    expect(body.data?.playerId).toMatch(/^player_/);
  });

  it("rejects invalid bearer tokens without creating Tevi sessions", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await postTeviSession("invalid-token");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: {
        code: "TEVI_TOKEN_INVALID",
        message: "Tevi token could not be authenticated.",
        details: { reasonCode: "TOKEN_VERIFICATION_FAILED" }
      },
      requestId: "req_tevi_auth_test"
    });
    await expect(sessionService.searchSessions({ provider: "tevi" })).resolves.toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith("[tevi-auth] authentication rejected", {
      requestId: "req_tevi_auth_test",
      provider: "tevi",
      reasonCode: "TOKEN_VERIFICATION_FAILED",
      appIdMatched: undefined
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("invalid-token");
    warnSpy.mockRestore();
  });

  it.each([
    ["wrong-app", 403, "TEVI_WRONG_APP"],
    ["inactive", 403, "TEVI_USER_INACTIVE"],
    ["anonymous", 403, "TEVI_ANONYMOUS_BLOCKED"]
  ])("maps %s failures to stable status and error codes", async (token, expectedStatus, expectedCode) => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await postTeviSession(token);

    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: expectedCode },
      requestId: "req_tevi_auth_test"
    });
    await expect(sessionService.searchSessions({ provider: "tevi" })).resolves.toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("creates or resumes sessions against the stable internal player identity", async () => {
    const firstResponse = await postTeviSession("valid-same-user");
    const firstBody = await firstResponse.json() as ApiEnvelope<SessionResponse>;
    const secondResponse = await postTeviSession("valid-same-user-again");
    const secondBody = await secondResponse.json() as ApiEnvelope<SessionResponse>;
    const otherTeviResponse = await postTeviSession("valid-other-user");
    const otherTeviBody = await otherTeviResponse.json() as ApiEnvelope<SessionResponse>;
    const demoResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_demo_session"
      },
      body: JSON.stringify({
        identity: {
          provider: "demo",
          subject: "tevi-user-1",
          expiresAt: "2026-06-28T13:00:00.000Z"
        }
      })
    });
    const demoBody = await demoResponse.json() as ApiEnvelope<SessionResponse>;

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(otherTeviResponse.status).toBe(201);
    expect(demoResponse.status).toBe(201);
    expect(firstBody.data?.playerId).toBe(secondBody.data?.playerId);
    expect(otherTeviBody.data?.playerId).not.toBe(firstBody.data?.playerId);
    expect(demoBody.data?.playerId).not.toBe(firstBody.data?.playerId);
    expect(firstBody.data?.playerId).not.toBe("tevi-user-1");
    expect(firstBody.data?.balance.points).toBe(1000);
  });

  it("rejects raw Tevi identity on the generic session route when Tevi auth is enabled", async () => {
    const response = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_raw_tevi_session"
      },
      body: JSON.stringify({
        identity: {
          provider: "tevi",
          subject: "client-supplied-tevi-user",
          expiresAt: "2026-06-28T13:00:00.000Z"
        }
      })
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: {
        code: "TEVI_AUTH_REQUIRED",
        message: "Use the authenticated Tevi session route for Tevi identities.",
        details: { route: "/api/tevi/session" }
      },
      requestId: "req_raw_tevi_session"
    });
    await expect(sessionService.searchSessions({ provider: "tevi" })).resolves.toHaveLength(0);
  });
});
