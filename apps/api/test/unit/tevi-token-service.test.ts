import { describe, expect, it, vi } from "vitest";
import { TeviTokenService } from "../../src/domain/tevi-token-service.js";

const config = {
  appId: "AZX29173",
  apiBase: "https://developer-api.sbx.tevi.dev"
};

describe("TeviTokenService", () => {
  it("exchanges a runtime token through the configured Tevi auth endpoint", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      access_token: "provider-access-token",
      refresh_token: "provider-refresh-token",
      expires_in: 86400
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const service = new TeviTokenService(config, { fetchImpl });

    await expect(service.exchangeRuntimeToken("runtime-token", "req_exchange_success")).resolves.toEqual({
      ok: true,
      accessToken: "provider-access-token",
      refreshToken: "provider-refresh-token",
      expiresAt: "2026-06-29T00:00:00.000Z"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://developer-api.sbx.tevi.dev/api/v1/auth/token?app_id=AZX29173",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: "Bearer runtime-token" }
      })
    );
  });

  it.each([
    [401, "TEVI_TOKEN_EXCHANGE_FAILED"],
    [403, "TEVI_TOKEN_EXCHANGE_FAILED"]
  ])("maps provider status %s to a safe exchange failure", async (status, code) => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "secret body" }), { status }));
    const service = new TeviTokenService(config, { fetchImpl });

    await expect(service.exchangeRuntimeToken("runtime-token", "req_exchange_denied")).resolves.toEqual({
      ok: false,
      code,
      reasonCode: "PROVIDER_REJECTED",
      statusCode: 401
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("runtime-token");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("secret body");
    warnSpy.mockRestore();
  });

  it.each([429, 500, 503])("maps provider outage status %s to unavailable", async (status) => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "secret body" }), { status }));
    const service = new TeviTokenService(config, { fetchImpl });

    await expect(service.exchangeRuntimeToken("runtime-token", "req_provider_unavailable")).resolves.toEqual({
      ok: false,
      code: "TEVI_TOKEN_EXCHANGE_FAILED",
      reasonCode: "PROVIDER_UNAVAILABLE",
      statusCode: 503
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("runtime-token");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("secret body");
    warnSpy.mockRestore();
  });

  it("rejects non-json provider responses without leaking body text", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => new Response("access_token=secret", { status: 200 }));
    const service = new TeviTokenService(config, { fetchImpl });

    await expect(service.exchangeRuntimeToken("runtime-token", "req_non_json")).resolves.toMatchObject({
      ok: false,
      code: "TEVI_TOKEN_EXCHANGE_FAILED",
      reasonCode: "PROVIDER_RESPONSE_INVALID",
      statusCode: 502
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("access_token=secret");
    warnSpy.mockRestore();
  });

  it("rejects provider responses missing required token fields", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: "provider-access-token" }), { status: 200 }));
    const service = new TeviTokenService(config, { fetchImpl });

    await expect(service.exchangeRuntimeToken("runtime-token", "req_missing_refresh")).resolves.toMatchObject({
      ok: false,
      code: "TEVI_TOKEN_EXCHANGE_FAILED",
      reasonCode: "PROVIDER_RESPONSE_INVALID",
      statusCode: 502
    });
  });

  it("maps network failures to recoverable exchange failures", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNRESET runtime-token");
    });
    const service = new TeviTokenService(config, { fetchImpl });

    await expect(service.exchangeRuntimeToken("runtime-token", "req_network_failure")).resolves.toEqual({
      ok: false,
      code: "TEVI_TOKEN_EXCHANGE_FAILED",
      reasonCode: "PROVIDER_UNAVAILABLE",
      statusCode: 503
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("runtime-token");
    warnSpy.mockRestore();
  });

  it("refreshes an access token through the configured Tevi auth endpoint", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      access_token: "provider-refreshed-access-token",
      refresh_token: "provider-rotated-refresh-token",
      expires_in: 86400
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const service = new TeviTokenService(config, { fetchImpl });

    await expect(service.refreshAccessToken("provider-refresh-token", "req_refresh_success")).resolves.toEqual({
      ok: true,
      accessToken: "provider-refreshed-access-token",
      refreshToken: "provider-rotated-refresh-token",
      expiresAt: "2026-06-29T00:00:00.000Z"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://developer-api.sbx.tevi.dev/api/v1/auth/token?app_id=AZX29173",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: "Bearer provider-refresh-token" }
      })
    );
  });

  it("maps refresh failures without exposing token material", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "secret body" }), { status: 401 }));
    const service = new TeviTokenService(config, { fetchImpl });

    await expect(service.refreshAccessToken("refresh-token", "req_refresh")).resolves.toEqual({
      ok: false,
      code: "TEVI_TOKEN_REFRESH_FAILED",
      reasonCode: "PROVIDER_REJECTED",
      statusCode: 401
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("refresh-token");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("secret body");
    warnSpy.mockRestore();
  });
});
