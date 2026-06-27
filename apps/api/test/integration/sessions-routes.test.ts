import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import type { Clock } from "../../src/domain/session-service.js";
import { WalletService } from "../../src/domain/wallet-service.js";
import type { SessionResponse } from "../../src/schemas/session.schema.js";
import type { ApiEnvelope } from "../../src/schemas/api-envelope.js";

class MutableClock implements Clock {
  public current = new Date("2026-06-18T08:00:00.000Z");

  public now(): Date {
    return this.current;
  }
}

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let clock: MutableClock;
let walletService: WalletService;

beforeEach(async () => {
  clock = new MutableClock();
  walletService = new WalletService(clock);
  server = createServer(createApp({ clock, walletService }));
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

function identity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: "demo",
    subject: "player-123",
    displayName: "Player 123",
    expiresAt: "2026-06-18T09:00:00.000Z",
    ...overrides
  };
}

async function postSession(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "req_session_test"
    },
    body: JSON.stringify(body)
  });
}

describe("session routes", () => {
  it("creates a new session for a valid identity and ignores client balance", async () => {
    const response = await postSession({
      identity: identity(),
      balance: { points: 999999 }
    });
    const body = await response.json() as ApiEnvelope<SessionResponse>;

    expect(response.status).toBe(201);
    expect(body.error).toBeNull();
    expect(body.requestId).toBe("req_session_test");
    expect(body.data).toMatchObject({
      sessionId: "sess_1",
      playerId: "player_1",
      balance: { points: 1000 },
      rewardModel: {
        mode: "mvp_non_cash",
        unit: "points",
        cashEquivalent: false,
        redemptionEnabled: false,
        cashOutEnabled: false,
        cryptoEnabled: false
      },
      session: {
        status: "active",
        createdAt: "2026-06-18T08:00:00.000Z",
        expiresAt: "2026-06-18T09:00:00.000Z",
        resumed: false
      }
    });
  });

  it("returns the current server wallet balance on session start", async () => {
    await walletService.applyTransaction({
      playerId: "player_1",
      type: "credit",
      amount: 250,
      actor: "test",
      source: "session-route-test"
    });

    const response = await postSession({ identity: identity() });
    const body = await response.json() as ApiEnvelope<SessionResponse>;

    expect(response.status).toBe(201);
    expect(body.error).toBeNull();
    expect(body.data).toMatchObject({
      playerId: "player_1",
      balance: { points: 1250 }
    });
  });

  it("looks up and resumes the active session for the same identity", async () => {
    const firstResponse = await postSession({ identity: identity() });
    const firstBody = await firstResponse.json() as ApiEnvelope<SessionResponse>;

    const secondResponse = await postSession({
      identity: identity(),
      resumeSessionId: firstBody.data?.sessionId
    });
    const secondBody = await secondResponse.json() as ApiEnvelope<SessionResponse>;

    expect(secondResponse.status).toBe(200);
    expect(secondBody.error).toBeNull();
    expect(secondBody.data).toMatchObject({
      sessionId: firstBody.data?.sessionId,
      playerId: firstBody.data?.playerId,
      balance: { points: 1000 },
      session: {
        status: "active",
        resumed: true
      }
    });
  });

  it("creates a new session instead of implicit resume when resumeSessionId is omitted", async () => {
    const firstResponse = await postSession({ identity: identity() });
    const firstBody = await firstResponse.json() as ApiEnvelope<SessionResponse>;

    const secondResponse = await postSession({ identity: identity() });
    const secondBody = await secondResponse.json() as ApiEnvelope<SessionResponse>;

    expect(secondResponse.status).toBe(201);
    expect(secondBody.data?.playerId).toBe(firstBody.data?.playerId);
    expect(secondBody.data?.sessionId).not.toBe(firstBody.data?.sessionId);
    expect(secondBody.data?.session.resumed).toBe(false);
  });

  it("keeps delimiter-colliding external identities as distinct players", async () => {
    const firstResponse = await postSession({
      identity: identity({ provider: "a", subject: "b:c" })
    });
    const secondResponse = await postSession({
      identity: identity({ provider: "a:b", subject: "c" })
    });
    const firstBody = await firstResponse.json() as ApiEnvelope<SessionResponse>;
    const secondBody = await secondResponse.json() as ApiEnvelope<SessionResponse>;

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(secondBody.data?.playerId).not.toBe(firstBody.data?.playerId);
  });

  it("rejects resume attempts for another player's session", async () => {
    const firstResponse = await postSession({ identity: identity() });
    const firstBody = await firstResponse.json() as ApiEnvelope<SessionResponse>;

    const response = await postSession({
      identity: identity({ subject: "different-player" }),
      resumeSessionId: firstBody.data?.sessionId
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: {
        code: "SESSION_NOT_FOUND",
        message: "Session could not be found for this player.",
        details: { sessionId: firstBody.data?.sessionId }
      },
      requestId: "req_session_test"
    });
  });

  it("returns a recoverable error for expired session resume attempts", async () => {
    const firstResponse = await postSession({ identity: identity() });
    const firstBody = await firstResponse.json() as ApiEnvelope<SessionResponse>;

    clock.current = new Date("2026-06-18T09:00:00.000Z");
    const response = await postSession({
      identity: identity({ expiresAt: "2026-06-18T10:00:00.000Z" }),
      resumeSessionId: firstBody.data?.sessionId
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: {
        code: "SESSION_EXPIRED",
        message: "Session has expired. Start a new session to continue.",
        details: { sessionId: firstBody.data?.sessionId }
      },
      requestId: "req_session_test"
    });
  });

  it("returns a recoverable invalid identity error when identity is missing", async () => {
    const response = await postSession({});

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: "INVALID_IDENTITY",
        message: "Session identity payload is invalid.",
        details: {}
      },
      requestId: "req_session_test"
    });
  });

  it("returns a recoverable invalid identity error for malformed identity payloads", async () => {
    const response = await postSession({
      identity: identity({ provider: "" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: {
        code: "INVALID_IDENTITY",
        message: "Session identity payload is invalid."
      },
      requestId: "req_session_test"
    });
  });

  it("returns a recoverable unauthenticated error for expired identity assertions", async () => {
    const response = await postSession({
      identity: identity({ expiresAt: "2026-06-18T07:59:59.000Z" })
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: {
        code: "UNAUTHENTICATED",
        message: "Identity assertion has expired.",
        details: { provider: "demo" }
      },
      requestId: "req_session_test"
    });
  });
});
