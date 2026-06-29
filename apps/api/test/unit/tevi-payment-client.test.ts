import { describe, expect, it, vi } from "vitest";
import { TeviPaymentClient } from "../../src/domain/tevi-payment-client.js";

const config = {
  apiBase: "https://developer-api.sbx.tevi.dev",
  depositTokenPath: "/api/v1/payments/deposit-token",
  apiKey: "provider-api-key",
  secretKey: "provider-secret-key"
};

const request = {
  appId: "AZX29173",
  billingChannelId: "2300210851",
  playerId: "player_123",
  teviSubject: "tevi-user-1",
  amount: 100,
  requestId: "req_payment"
};

describe("TeviPaymentClient", () => {
  it("requests a deposit token using backend credentials only", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        deposit_token: "provider.deposit.token"
      }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new TeviPaymentClient(config, { fetchImpl });

    await expect(client.issueDepositToken(request)).resolves.toEqual({
      ok: true,
      depositToken: "provider.deposit.token"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://developer-api.sbx.tevi.dev/api/v1/payments/deposit-token",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer provider-api-key",
          "content-type": "application/json",
          "x-tevi-secret-key": "provider-secret-key",
          "x-request-id": "req_payment"
        },
        body: JSON.stringify({
          app_id: "AZX29173",
          billing_channel_id: "2300210851",
          amount: 100,
          external_player_id: "player_123",
          tevi_user_id: "tevi-user-1"
        })
      })
    );
  });

  it.each([401, 403])("maps provider auth status %s without leaking secrets", async (status) => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "provider-secret-key provider.deposit.token" }), { status }));
    const client = new TeviPaymentClient(config, { fetchImpl });

    await expect(client.issueDepositToken(request)).resolves.toEqual({
      ok: false,
      code: "TEVI_TOP_UP_SIGNATURE_FAILED",
      reasonCode: "PROVIDER_REJECTED",
      statusCode: 401,
      providerStatusCode: status
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("provider-secret-key");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("provider.deposit.token");
    warnSpy.mockRestore();
  });

  it.each([429, 500, 503])("maps provider outage status %s to unavailable", async (status) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "secret body" }), { status }));
    const client = new TeviPaymentClient(config, { fetchImpl });

    await expect(client.issueDepositToken(request)).resolves.toEqual({
      ok: false,
      code: "TEVI_TOP_UP_SIGNATURE_FAILED",
      reasonCode: "PROVIDER_UNAVAILABLE",
      statusCode: 503,
      providerStatusCode: status
    });
  });

  it.each([
    ["not json", "PROVIDER_RESPONSE_INVALID"],
    [JSON.stringify({ success: true, data: {} }), "PROVIDER_RESPONSE_INVALID"],
    [JSON.stringify({ deposit_token: 123 }), "PROVIDER_RESPONSE_INVALID"]
  ])("rejects malformed provider response %s", async (body, reasonCode) => {
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    const client = new TeviPaymentClient(config, { fetchImpl });

    await expect(client.issueDepositToken(request)).resolves.toEqual({
      ok: false,
      code: "TEVI_TOP_UP_SIGNATURE_FAILED",
      reasonCode,
      statusCode: 502
    });
  });

  it("maps network failures without leaking error text", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNRESET provider-api-key provider-secret-key");
    });
    const client = new TeviPaymentClient(config, { fetchImpl });

    await expect(client.issueDepositToken(request)).resolves.toEqual({
      ok: false,
      code: "TEVI_TOP_UP_SIGNATURE_FAILED",
      reasonCode: "PROVIDER_UNAVAILABLE",
      statusCode: 503
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("provider-api-key");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("provider-secret-key");
    warnSpy.mockRestore();
  });
});
