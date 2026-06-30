import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type AppDependencies } from "../../src/app.js";
import { TeviWebhookService } from "../../src/domain/tevi-webhook-service.js";
import { computeTeviWebhookSignature } from "../../src/domain/tevi-webhook-signature.js";
import {
  FakeCreditPort,
  FakeIdempotencyRepository,
  FakePlayerLookup,
  teviTopupPayload
} from "../helpers/tevi-webhook-fakes.js";

let server: ReturnType<typeof createServer>;
let baseUrl: string;

async function startServer(dependencies: AppDependencies = {}): Promise<void> {
  server = createServer(createApp(dependencies));
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

beforeEach(async () => {
  await startServer();
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

describe("Tevi webhook registration route", () => {
  it("echoes the Tevi challenge parameter for sandbox URL verification", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await fetch(`${baseUrl}/api/webhooks/tevi?challenge=tevi_sandbox_challenge`, {
      method: "POST",
      headers: { "x-request-id": "req_tevi_challenge" }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    await expect(response.text()).resolves.toBe("tevi_sandbox_challenge");
    expect(infoSpy).toHaveBeenCalledWith("[tevi-webhook] challenge verification", {
      requestId: "req_tevi_challenge",
      source: "query",
      challengeLength: "tevi_sandbox_challenge".length
    });
    infoSpy.mockRestore();
  });

  it("rejects non-challenge webhook posts until signature verification is implemented", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await fetch(`${baseUrl}/api/webhooks/tevi`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_tevi_placeholder"
      },
      body: JSON.stringify({ event: "user_topup", id: "evt_story_8_1_placeholder" })
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: "TEVI_WEBHOOK_PROCESSING_NOT_IMPLEMENTED",
        message: "Tevi webhook event processing requires signature verification in a later story.",
        details: {
          expectedHeader: "X-Tevi-Signature"
        }
      },
      requestId: "req_tevi_placeholder"
    });
    expect(infoSpy).toHaveBeenCalledWith("[tevi-webhook] event rejected before signature verification", {
      requestId: "req_tevi_placeholder",
      event: "user_topup",
      hasSignatureHeader: false
    });
    infoSpy.mockRestore();
  });

  it("rejects oversized Tevi challenge values", async () => {
    const response = await fetch(`${baseUrl}/api/webhooks/tevi`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_tevi_challenge_too_long"
      },
      body: JSON.stringify({ challenge: "x".repeat(1025) })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: "TEVI_WEBHOOK_CHALLENGE_TOO_LONG",
        message: "Tevi webhook challenge exceeds the allowed length.",
        details: {
          maxLength: 1024
        }
      },
      requestId: "req_tevi_challenge_too_long"
    });
  });
});

describe("Tevi webhook verified crediting route (wired)", () => {
  const webhookSecret = "whsec_integration_placeholder";
  let repository: FakeIdempotencyRepository;
  let creditPort: FakeCreditPort;

  async function startWiredServer(): Promise<void> {
    // Close the default (unwired) server started in the outer beforeEach, then start one with the service wired.
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    repository = new FakeIdempotencyRepository();
    creditPort = new FakeCreditPort(repository);
    const playerLookup = new FakePlayerLookup();
    playerLookup.bySubject.set("633505726", { playerId: "player_known", provider: "tevi", subject: "633505726" });
    const webhookService = new TeviWebhookService({ idempotencyRepository: repository, creditPort, playerLookup });
    await startServer({ teviWebhookService: webhookService, teviWebhookSecret: webhookSecret });
  }

  function signedRequest(payload: Record<string, unknown>, requestId: string): { body: string; headers: Record<string, string> } {
    // Sign over the exact compact JSON we send, so the route's parse->re-serialize reproduces the signed bytes.
    const body = JSON.stringify(payload);
    return {
      body,
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
        "X-Tevi-Signature": computeTeviWebhookSignature(webhookSecret, payload)
      }
    };
  }

  beforeEach(async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await startWiredServer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a signed user_topup, credits once, and returns 200", async () => {
    const payload = teviTopupPayload();
    const { body, headers } = signedRequest(payload, "req_signed_credit");
    const response = await fetch(`${baseUrl}/api/webhooks/tevi`, { method: "POST", headers, body });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { status: "credited", reasonCode: "credited" },
      error: null,
      requestId: "req_signed_credit"
    });
    expect(creditPort.credits).toHaveLength(1);
  });

  it("preserves the prior result on replay without double crediting", async () => {
    const payload = teviTopupPayload();
    const first = signedRequest(payload, "req_first");
    const replay = signedRequest(payload, "req_replay");
    await fetch(`${baseUrl}/api/webhooks/tevi`, { method: "POST", headers: first.headers, body: first.body });
    const response = await fetch(`${baseUrl}/api/webhooks/tevi`, { method: "POST", headers: replay.headers, body: replay.body });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { status: "replayed" } });
    expect(creditPort.credits).toHaveLength(1);
  });

  it("quarantines a conflicting payload as duplicate without crediting", async () => {
    const original = signedRequest(teviTopupPayload(), "req_original");
    const conflicting = signedRequest(teviTopupPayload({ amount: 9999 }), "req_conflict");
    await fetch(`${baseUrl}/api/webhooks/tevi`, { method: "POST", headers: original.headers, body: original.body });
    const response = await fetch(`${baseUrl}/api/webhooks/tevi`, { method: "POST", headers: conflicting.headers, body: conflicting.body });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { status: "duplicate", reasonCode: "conflicting_payload" } });
    expect(creditPort.credits).toHaveLength(1);
  });

  it("rejects a missing signature with HTTP 401 and does not credit", async () => {
    const payload = teviTopupPayload();
    const response = await fetch(`${baseUrl}/api/webhooks/tevi`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req_no_sig" },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "TEVI_WEBHOOK_SIGNATURE_INVALID", details: { reasonCode: "SIGNATURE_MISSING" } }
    });
    expect(creditPort.credits).toHaveLength(0);
  });

  it("rejects an invalid signature with HTTP 401 and does not credit", async () => {
    const payload = teviTopupPayload();
    const response = await fetch(`${baseUrl}/api/webhooks/tevi`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_bad_sig",
        "X-Tevi-Signature": computeTeviWebhookSignature("the-wrong-secret", payload)
      },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "TEVI_WEBHOOK_SIGNATURE_INVALID", details: { reasonCode: "SIGNATURE_INVALID" } }
    });
    expect(creditPort.credits).toHaveLength(0);
  });

  it("preserves the challenge echo even when the service is wired", async () => {
    const response = await fetch(`${baseUrl}/api/webhooks/tevi?challenge=wired_challenge`, {
      method: "POST",
      headers: { "x-request-id": "req_wired_challenge" }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    await expect(response.text()).resolves.toBe("wired_challenge");
  });

  it("does not invoke the service for an oversized challenge (kept verbatim)", async () => {
    const response = await fetch(`${baseUrl}/api/webhooks/tevi`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_tevi_challenge_too_long"
      },
      body: JSON.stringify({ challenge: "x".repeat(1025) })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: "TEVI_WEBHOOK_CHALLENGE_TOO_LONG",
        message: "Tevi webhook challenge exceeds the allowed length.",
        details: {
          maxLength: 1024
        }
      },
      requestId: "req_tevi_challenge_too_long"
    });
  });
});