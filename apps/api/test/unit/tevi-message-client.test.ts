import { describe, expect, it, vi } from "vitest";
import { TeviMessageClient } from "../../src/domain/tevi-message-client.js";

const config = {
  apiBase: "https://developer-api.sbx.tevi.dev",
  messagePath: "/api/v1/conversations/messages/send",
  apiKey: "provider-api-key"
};

describe("TeviMessageClient", () => {
  it("sends a plain-text message with X-API-Key auth", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { id: "msg_123" }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new TeviMessageClient(config, { fetchImpl });

    await expect(client.sendMessage({
      teviSubject: "1168097029",
      text: "Your Stars top-up of 100 was credited. Reference: req_1.",
      requestId: "req_receipt"
    })).resolves.toEqual({
      ok: true,
      providerMessageId: "msg_123"
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://developer-api.sbx.tevi.dev/api/v1/conversations/messages/send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "provider-api-key",
          "x-request-id": "req_receipt"
        }),
        body: JSON.stringify({
          user: "1168097029",
          text: "Your Stars top-up of 100 was credited. Reference: req_1.",
          type: "TEXT",
          parser: "PLAIN"
        })
      })
    );
  });

  it("maps provider auth failures without leaking secrets", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => new Response("provider-api-key leaked", { status: 401 }));
    const client = new TeviMessageClient(config, { fetchImpl });

    await expect(client.sendMessage({
      teviSubject: "1168097029",
      text: "hello",
      requestId: "req_receipt"
    })).resolves.toEqual({
      ok: false,
      reasonCode: "PROVIDER_REJECTED",
      statusCode: 401,
      providerStatusCode: 401
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("provider-api-key");
    warnSpy.mockRestore();
  });

  it("maps 403 responses to provider rejection", async () => {
    const client = new TeviMessageClient(config, {
      fetchImpl: vi.fn(async () => new Response("forbidden", { status: 403 }))
    });

    await expect(client.sendMessage({
      teviSubject: "1168097029",
      text: "hello",
      requestId: "req_forbidden"
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "PROVIDER_REJECTED",
      statusCode: 401,
      providerStatusCode: 403
    });
  });

  it("maps provider network failures and non-auth HTTP errors", async () => {
    const unavailableClient = new TeviMessageClient(config, {
      fetchImpl: vi.fn(async () => { throw new Error("network down"); })
    });
    await expect(unavailableClient.sendMessage({
      teviSubject: "1168097029",
      text: "hello",
      requestId: "req_network"
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "PROVIDER_UNAVAILABLE",
      statusCode: 503
    });

    const outageClient = new TeviMessageClient(config, {
      fetchImpl: vi.fn(async () => new Response("busy", { status: 503 }))
    });
    await expect(outageClient.sendMessage({
      teviSubject: "1168097029",
      text: "hello",
      requestId: "req_outage"
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "PROVIDER_UNAVAILABLE",
      statusCode: 503,
      providerStatusCode: 503
    });
  });

  it("rejects malformed JSON and explicit provider failure payloads", async () => {
    const invalidJsonClient = new TeviMessageClient(config, {
      fetchImpl: vi.fn(async () => new Response("not-json", { status: 200 }))
    });
    await expect(invalidJsonClient.sendMessage({
      teviSubject: "1168097029",
      text: "hello",
      requestId: "req_invalid_json"
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "PROVIDER_RESPONSE_INVALID",
      statusCode: 502
    });

    const rejectedClient = new TeviMessageClient(config, {
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        success: false,
        error_code: "MSG_001"
      }), { status: 200, headers: { "content-type": "application/json" } }))
    });
    await expect(rejectedClient.sendMessage({
      teviSubject: "1168097029",
      text: "hello",
      requestId: "req_rejected"
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "PROVIDER_REJECTED",
      statusCode: 502,
      providerStatusCode: 200
    });
  });

  it("accepts alternate provider message id shapes", async () => {
    const client = new TeviMessageClient(config, {
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        success: true,
        message_id: "msg_top"
      }), { status: 200, headers: { "content-type": "application/json" } }))
    });

    await expect(client.sendMessage({
      teviSubject: "1168097029",
      text: "hello",
      requestId: "req_alt_id"
    })).resolves.toEqual({
      ok: true,
      providerMessageId: "msg_top"
    });
  });
});
