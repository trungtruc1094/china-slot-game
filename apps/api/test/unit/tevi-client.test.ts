import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

interface TeviClientApi {
  createFromWindow: () => TeviClient;
  resolveRuntimeConfig: () => TeviRuntimeConfig;
}

interface TeviClient {
  initialize: () => Promise<TeviCallResult>;
  getState: () => TeviState;
  getUserAppToken: (options?: { isPopup?: boolean; timeoutMs?: number }) => Promise<TeviAuthTokenResult>;
  topup: (options: TeviTopupOptions) => Promise<TeviTopupResult>;
  isTeviMode: () => boolean;
  isSdkAvailable: () => boolean;
  showBackButton: () => TeviCallResult;
  showCloseButton: () => TeviCallResult;
  loadConfig: () => TeviCallResult;
  close: () => TeviCallResult;
}

interface TeviRuntimeConfig {
  enabled: boolean;
  environment: string;
  appId: string;
  channelId: string;
  appUrl: string;
  webhookUrl: string;
  sdkUrl: string;
}

interface TeviState {
  mode: "tevi" | "local";
  environment: string;
  sdkAvailable: boolean;
  appId: string;
  channelId: string;
  appUrl: string;
  webhookUrl: string;
}

interface TeviCallResult {
  available: boolean;
  called?: boolean;
  reason?: string;
}

interface TeviAuthTokenResult {
  ok: boolean;
  runtimeToken?: string;
  status: string;
  reason?: string;
}

interface TeviTopupOptions {
  amount?: number;
  depositToken?: string;
  requestId?: string;
  attemptId?: string;
  timeoutMs?: number;
  forceSdkCallWithoutToken?: boolean;
}

interface TeviTopupResult {
  ok: boolean;
  status: string;
  reason?: string;
  reference?: string;
}

interface MockScriptElement {
  async?: boolean;
  src?: string;
  onload?: () => void;
  onerror?: () => void;
  style?: Record<string, string>;
  textContent?: string;
}

interface TeviSandbox {
  window: Record<string, unknown>;
  globalThis: Record<string, unknown>;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  document?: {
    createElement: (tagName: string) => MockScriptElement;
    querySelector: (selector: string) => MockScriptElement | null;
    head: { appendChild: (element: MockScriptElement) => void };
    body?: { appendChild: (element: MockScriptElement) => void };
  };
  location?: { search: string };
  URLSearchParams: typeof URLSearchParams;
  ChinaSlotTeviClient?: TeviClientApi;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

function loadRuntimeAndTeviClient(overrides: Partial<TeviSandbox> = {}): TeviSandbox {
  const runtimeSource = readFileSync(resolve(repoRoot, "js/runtime-config.js"), "utf8");
  const teviSource = readFileSync(resolve(repoRoot, "js/teviClient.js"), "utf8");
  const windowObject: Record<string, unknown> = overrides.window || {};
  const sandbox: TeviSandbox = {
    window: windowObject,
    globalThis: windowObject,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    ...overrides
  };

  vm.createContext(sandbox);
  vm.runInContext(runtimeSource, sandbox);
  vm.runInContext(teviSource, sandbox);

  if (!sandbox.window.ChinaSlotTeviClient && !sandbox.ChinaSlotTeviClient) {
    throw new Error("Tevi client did not register the browser global");
  }

  return sandbox;
}

describe("browser Tevi client", () => {
  it("is loaded by the static shell after runtime config and before the game", () => {
    const html = readFileSync(resolve(repoRoot, "index.html"), "utf8");
    const runtimeIndex = html.indexOf('js/runtime-config.js');
    const teviIndex = html.indexOf('js/teviClient.js');
    const gameIndex = html.indexOf('js/slotGame.js');

    expect(runtimeIndex).toBeGreaterThan(-1);
    expect(teviIndex).toBeGreaterThan(runtimeIndex);
    expect(teviIndex).toBeLessThan(gameIndex);
  });

  it("keeps Tevi mode disabled by default while preserving the API base URL", () => {
    const sandbox = loadRuntimeAndTeviClient();
    const api = sandbox.window.ChinaSlotTeviClient as TeviClientApi;

    expect(sandbox.window.CHINA_SLOT_API_BASE_URL).toBe("https://china-slot-api.onrender.com");
    expect(api.resolveRuntimeConfig()).toMatchObject({
      enabled: false,
      environment: "local",
      appId: "AZX29173",
      channelId: "2300210851",
      appUrl: "https://chinareel.pleagamehub.com/",
      webhookUrl: "https://china-slot-api.onrender.com/api/webhooks/tevi",
      sdkUrl: "https://static.tevicdn.com/helper_tevi.js"
    });
  });

  it("renders a query-gated debug panel for mobile Tevi sandbox evidence", async () => {
    const appendedPanels: MockScriptElement[] = [];
    const sandbox = loadRuntimeAndTeviClient({
      window: {
        CHINA_SLOT_TEVI_MODE: true,
        TeviJS: { showBackButton: () => undefined, showCloseButton: () => undefined, loadConfig: () => undefined }
      },
      location: { search: "?tevi=1&debugTevi=1" },
      document: {
        createElement: () => ({ style: {} }),
        querySelector: () => null,
        head: { appendChild: () => undefined },
        body: { appendChild: (element) => appendedPanels.push(element) }
      }
    });
    const api = sandbox.window.ChinaSlotTeviClient as TeviClientApi;

    await api.createFromWindow().initialize();

    expect(appendedPanels).toHaveLength(1);
    expect(appendedPanels[0]?.textContent).toContain("China Slot Tevi Debug");
    expect(appendedPanels[0]?.textContent).toContain("mode: tevi");
    expect(appendedPanels[0]?.textContent).toContain("environment: sandbox");
    expect(appendedPanels[0]?.textContent).toContain("sdkAvailable: true");
    expect(appendedPanels[0]?.textContent).toContain("appId: AZX29173");
    expect(appendedPanels[0]?.textContent).toContain("channelId: 2300210851");
    expect(appendedPanels[0]?.textContent).toContain("webhookUrl: https://china-slot-api.onrender.com/api/webhooks/tevi");
  });

  it("requests the Tevi SDK script only when explicit Tevi mode is active", async () => {
    const appendedScripts: MockScriptElement[] = [];
    const sandbox = loadRuntimeAndTeviClient({
      window: {
        CHINA_SLOT_TEVI_MODE: true,
        CHINA_SLOT_TEVI_CONFIG: { environment: "sandbox", appId: "app_123", channelId: "channel_123" }
      },
      document: {
        createElement: () => ({}),
        querySelector: () => null,
        head: {
          appendChild: (element) => {
            appendedScripts.push(element);
            element.onload?.();
          }
        }
      }
    });
    const api = sandbox.window.ChinaSlotTeviClient as TeviClientApi;

    await expect(api.createFromWindow().initialize()).resolves.toMatchObject({ available: true });
    expect(appendedScripts).toHaveLength(1);
    expect(appendedScripts[0]?.src).toBe("https://static.tevicdn.com/helper_tevi.js");

    const localSandbox = loadRuntimeAndTeviClient({
      document: {
        createElement: () => ({}),
        querySelector: () => null,
        head: { appendChild: (element) => appendedScripts.push(element) }
      }
    });
    const localApi = localSandbox.window.ChinaSlotTeviClient as TeviClientApi;
    await expect(localApi.createFromWindow().initialize()).resolves.toMatchObject({ available: false, reason: "tevi-mode-disabled" });
    expect(appendedScripts).toHaveLength(1);
  });

  it("retries Tevi SDK script loading after a transient script error", async () => {
    const appendedScripts: MockScriptElement[] = [];
    const sandbox = loadRuntimeAndTeviClient({
      window: { CHINA_SLOT_TEVI_MODE: true },
      document: {
        createElement: () => ({}),
        querySelector: () => null,
        head: {
          appendChild: (element) => {
            appendedScripts.push(element);
            if (appendedScripts.length === 1) {
              element.onerror?.();
              return;
            }
            element.onload?.();
          }
        }
      }
    });
    const api = sandbox.window.ChinaSlotTeviClient as TeviClientApi;

    await expect(api.createFromWindow().initialize()).resolves.toMatchObject({ available: false, reason: "sdk-script-error" });
    await expect(api.createFromWindow().initialize()).resolves.toMatchObject({ available: true, reason: "sdk-script-loaded" });
    expect(appendedScripts).toHaveLength(2);
  });

  it("reports SDK unavailable safely outside Tevi sandbox", async () => {
    const sandbox = loadRuntimeAndTeviClient({ window: { CHINA_SLOT_TEVI_MODE: true } });
    const api = sandbox.window.ChinaSlotTeviClient as TeviClientApi;
    const client = api.createFromWindow();

    await expect(client.initialize()).resolves.toMatchObject({ available: false, reason: "document-unavailable" });
    expect(client.getState()).toMatchObject({ mode: "tevi", sdkAvailable: false });
    expect(client.showBackButton()).toEqual({ available: false, called: false, reason: "sdk-unavailable" });
  });

  it("wraps safe Tevi SDK helpers only when methods are available", () => {
    const calls: string[] = [];
    const sandbox = loadRuntimeAndTeviClient({
      window: {
        CHINA_SLOT_TEVI_MODE: true,
        TeviJS: {
          showBackButton: () => calls.push("back"),
          showCloseButton: () => calls.push("close-button"),
          loadConfig: () => calls.push("config"),
          quitGame: () => calls.push("quit")
        }
      }
    });
    const api = sandbox.window.ChinaSlotTeviClient as TeviClientApi;
    const client = api.createFromWindow();

    expect(client.showBackButton()).toMatchObject({ available: true, called: true });
    expect(client.showCloseButton()).toMatchObject({ available: true, called: true });
    expect(client.loadConfig()).toMatchObject({ available: true, called: true });
    expect(client.close()).toMatchObject({ available: true, called: true });
    expect(calls).toEqual(["back", "close-button", "config", "quit"]);
  });

  it("keeps Tevi metadata observable without granting a demo balance", () => {
    const sandbox = loadRuntimeAndTeviClient({
      window: {
        CHINA_SLOT_TEVI_MODE: true,
        CHINA_SLOT_TEVI_CONFIG: {
          environment: "sandbox",
          appId: "tevi-app-id",
          channelId: "tevi-channel-id",
          appUrl: "https://mini.example.test/app",
          webhookUrl: "https://api.example.test/webhooks/tevi"
        }
      }
    });
    const api = sandbox.window.ChinaSlotTeviClient as TeviClientApi;
    const client = api.createFromWindow();

    expect(client.getState()).toEqual({
      mode: "tevi",
      environment: "sandbox",
      sdkAvailable: false,
      appId: "tevi-app-id",
      channelId: "tevi-channel-id",
      appUrl: "https://mini.example.test/app",
      webhookUrl: "https://api.example.test/webhooks/tevi"
    });
  });

  it("gets a Tevi runtime user app token through the SDK without exposing it in debug state", async () => {
    const sandbox = loadRuntimeAndTeviClient({
      window: {
        CHINA_SLOT_TEVI_MODE: true,
        TeviJS: {
          getUserInfo: (_request: unknown, callback: (response: unknown) => void) => callback({
            data: { userInfo: { user_app_token: "runtime-token-secret" } }
          })
        }
      }
    });
    const api = sandbox.window.ChinaSlotTeviClient as TeviClientApi;
    const client = api.createFromWindow();

    await expect(client.getUserAppToken({ isPopup: true })).resolves.toEqual({
      ok: true,
      status: "authenticated",
      runtimeToken: "runtime-token-secret"
    });
    expect(JSON.stringify(client.getState())).not.toContain("runtime-token-secret");
  });

  it.each([
    ["sdk unavailable", {}, "sdk-unavailable"],
    ["missing method", { TeviJS: {} }, "method-unavailable"],
    ["canceled", { TeviJS: { getUserInfo: (_request: unknown, callback: (response: unknown) => void) => callback({ error: { code: "CANCELLED" } }) } }, "user-cancelled"],
    ["missing token", { TeviJS: { getUserInfo: (_request: unknown, callback: (response: unknown) => void) => callback({ data: { userInfo: {} } }) } }, "token-missing"]
  ])("normalizes Tevi getUserInfo %s as a recoverable state", async (_caseName, windowOverrides, reason) => {
    const sandbox = loadRuntimeAndTeviClient({
      window: {
        CHINA_SLOT_TEVI_MODE: true,
        ...windowOverrides
      }
    });
    const api = sandbox.window.ChinaSlotTeviClient as TeviClientApi;

    await expect(api.createFromWindow().getUserAppToken()).resolves.toMatchObject({
      ok: false,
      status: "re-authentication-required",
      reason
    });
  });

  it("times out when Tevi getUserInfo never calls back", async () => {
    vi.useFakeTimers();
    const sandbox = loadRuntimeAndTeviClient({
      window: {
        CHINA_SLOT_TEVI_MODE: true,
        TeviJS: {
          getUserInfo: () => undefined
        }
      }
    });
    const api = sandbox.window.ChinaSlotTeviClient as TeviClientApi;
    const tokenRequest = api.createFromWindow().getUserAppToken({ timeoutMs: 25 });

    await vi.advanceTimersByTimeAsync(25);

    await expect(tokenRequest).resolves.toMatchObject({
      ok: false,
      status: "re-authentication-required",
      reason: "sdk-timeout"
    });
    vi.useRealTimers();
  });
});

describe("browser Tevi client top-up SDK adapter", () => {
  function topupSandbox(topup: unknown): TeviSandbox {
    return loadRuntimeAndTeviClient({
      window: {
        CHINA_SLOT_TEVI_MODE: true,
        CHINA_SLOT_TEVI_CONFIG: { environment: "sandbox", appId: "app_123", channelId: "channel_777" },
        TeviJS: { topup }
      }
    });
  }

  it("calls the SDK with the backend deposit token and safe metadata, then reports webhook-pending", async () => {
    let captured: Record<string, unknown> | undefined;
    const sandbox = topupSandbox((options: Record<string, unknown>, callback: (response: unknown) => void) => {
      captured = options;
      callback({ error_code: 0, error_message: "", data: { id: "tevi-ref-1" } });
    });
    const client = (sandbox.window.ChinaSlotTeviClient as TeviClientApi).createFromWindow();

    const result = await client.topup({
      amount: 100,
      depositToken: "deposit-token-secret",
      requestId: "req_browser_abc",
      attemptId: "topup-attempt-1"
    });

    expect(result).toEqual({ ok: true, status: "webhook-pending", reason: "sdk-confirmed", reference: "tevi-ref-1" });
    expect(captured).toEqual({
      amount: 100,
      deposit_token: "deposit-token-secret",
      channel_id: "channel_777",
      metadata: { type: "deposit", requestId: "req_browser_abc", attemptId: "topup-attempt-1" }
    });
    // The deposit token must never appear in the normalized client state.
    expect(JSON.stringify(result)).not.toContain("deposit-token-secret");
  });

  it("normalizes a Tevi cancellation callback into a recoverable canceled state", async () => {
    const sandbox = topupSandbox((_options: unknown, callback: (response: unknown) => void) => {
      callback({ error: { code: "CANCELLED" } });
    });
    const client = (sandbox.window.ChinaSlotTeviClient as TeviClientApi).createFromWindow();

    await expect(client.topup({ amount: 100, depositToken: "deposit-token-secret" })).resolves.toEqual({
      ok: false,
      status: "canceled",
      reason: "user-cancelled"
    });
  });

  it("maps a legacy provider error callback to a terminal failed state without leaking provider payloads", async () => {
    const sandbox = topupSandbox((_options: unknown, callback: (response: unknown) => void) => {
      callback({ error: { code: "PROVIDER_DECLINED" } });
    });
    const client = (sandbox.window.ChinaSlotTeviClient as TeviClientApi).createFromWindow();

    await expect(client.topup({ amount: 100, depositToken: "deposit-token-secret" })).resolves.toEqual({
      ok: false,
      status: "failed",
      reason: "provider-error:PROVIDER_DECLINED"
    });
  });

  it("maps the SDK error_code contract: transient codes are retryable, others terminal, and error_message is never surfaced", async () => {
    const api = (sb: TeviSandbox) => (sb.window.ChinaSlotTeviClient as TeviClientApi).createFromWindow();

    const timeout = api(topupSandbox((_o: unknown, cb: (r: unknown) => void) => cb({ error_code: -14, error_message: "request Timeout!", data: {} })));
    await expect(timeout.topup({ amount: 100, depositToken: "deposit-token-secret" })).resolves.toEqual({
      ok: false,
      status: "retryable-failure",
      reason: "sdk-error:-14"
    });

    const notReady = api(topupSandbox((_o: unknown, cb: (r: unknown) => void) => cb({ error_code: -5, error_message: "Not ready!", data: {} })));
    await expect(notReady.topup({ amount: 100, depositToken: "deposit-token-secret" })).resolves.toMatchObject({
      status: "retryable-failure",
      reason: "sdk-error:-5"
    });

    const declined = api(topupSandbox((_o: unknown, cb: (r: unknown) => void) => cb({ error_code: 42, error_message: "declined: card 4242", data: {} })));
    const declinedResult = await declined.topup({ amount: 100, depositToken: "deposit-token-secret" });
    expect(declinedResult).toEqual({ ok: false, status: "failed", reason: "sdk-error:42" });
    expect(JSON.stringify(declinedResult)).not.toContain("declined");
  });

  it("treats an error_code:0 callback as a pending deposit and surfaces only a safe reference", async () => {
    const sandbox = topupSandbox((_o: unknown, cb: (r: unknown) => void) => cb({ error_code: 0, error_message: "", data: { reference: "safe-ref-9" } }));
    const client = (sandbox.window.ChinaSlotTeviClient as TeviClientApi).createFromWindow();

    await expect(client.topup({ amount: 100, depositToken: "deposit-token-secret" })).resolves.toEqual({
      ok: true,
      status: "webhook-pending",
      reason: "sdk-confirmed",
      reference: "safe-ref-9"
    });
  });

  it("rejects amounts above the client-side maximum before calling the SDK", async () => {
    let called = false;
    const sandbox = topupSandbox(() => { called = true; });
    const client = (sandbox.window.ChinaSlotTeviClient as TeviClientApi).createFromWindow();

    await expect(client.topup({ amount: 100001, depositToken: "deposit-token-secret" })).resolves.toEqual({
      ok: false,
      status: "failed",
      reason: "amount-too-large"
    });
    expect(called).toBe(false);
  });

  it("treats a missing SDK topup method as a retryable failure", async () => {
    const sandbox = loadRuntimeAndTeviClient({ window: { CHINA_SLOT_TEVI_MODE: true, TeviJS: {} } });
    const client = (sandbox.window.ChinaSlotTeviClient as TeviClientApi).createFromWindow();

    await expect(client.topup({ amount: 100, depositToken: "deposit-token-secret" })).resolves.toEqual({
      ok: false,
      status: "retryable-failure",
      reason: "method-unavailable"
    });
  });

  it("treats an unavailable SDK as a retryable failure", async () => {
    const sandbox = loadRuntimeAndTeviClient({ window: { CHINA_SLOT_TEVI_MODE: true } });
    const client = (sandbox.window.ChinaSlotTeviClient as TeviClientApi).createFromWindow();

    await expect(client.topup({ amount: 100, depositToken: "deposit-token-secret" })).resolves.toEqual({
      ok: false,
      status: "retryable-failure",
      reason: "sdk-unavailable"
    });
  });

  it("times out a missing SDK topup callback as a retryable failure", async () => {
    vi.useFakeTimers();
    const sandbox = topupSandbox(() => undefined);
    const client = (sandbox.window.ChinaSlotTeviClient as TeviClientApi).createFromWindow();
    const pending = client.topup({ amount: 100, depositToken: "deposit-token-secret", timeoutMs: 25 });

    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toEqual({ ok: false, status: "retryable-failure", reason: "sdk-timeout" });
    vi.useRealTimers();
  });

  it("treats a thrown SDK topup error as a terminal failure", async () => {
    const sandbox = topupSandbox(() => {
      throw new Error("sdk exploded");
    });
    const client = (sandbox.window.ChinaSlotTeviClient as TeviClientApi).createFromWindow();

    await expect(client.topup({ amount: 100, depositToken: "deposit-token-secret" })).resolves.toEqual({
      ok: false,
      status: "failed",
      reason: "sdk-call-failed"
    });
  });

  it("refuses to call the SDK without a deposit token by default", async () => {
    let called = false;
    const sandbox = topupSandbox(() => {
      called = true;
    });
    const client = (sandbox.window.ChinaSlotTeviClient as TeviClientApi).createFromWindow();

    await expect(client.topup({ amount: 100 })).resolves.toEqual({
      ok: false,
      status: "failed",
      reason: "deposit-token-missing"
    });
    expect(called).toBe(false);
  });

  it("can deliberately call the SDK without a deposit token for the manual 403 verification path", async () => {
    let captured: Record<string, unknown> | undefined;
    const sandbox = topupSandbox((options: Record<string, unknown>, callback: (response: unknown) => void) => {
      captured = options;
      callback({ error: { code: "DEPOSIT_TOKEN_REQUIRED" } });
    });
    const client = (sandbox.window.ChinaSlotTeviClient as TeviClientApi).createFromWindow();

    const result = await client.topup({ amount: 100, forceSdkCallWithoutToken: true });

    expect(result).toEqual({ ok: false, status: "failed", reason: "provider-error:DEPOSIT_TOKEN_REQUIRED" });
    expect(captured).not.toHaveProperty("deposit_token");
  });

  it("rejects invalid amounts before calling the SDK", async () => {
    let called = false;
    const sandbox = topupSandbox(() => {
      called = true;
    });
    const client = (sandbox.window.ChinaSlotTeviClient as TeviClientApi).createFromWindow();

    await expect(client.topup({ amount: 1.5, depositToken: "deposit-token-secret" })).resolves.toEqual({
      ok: false,
      status: "failed",
      reason: "invalid-amount"
    });
    expect(called).toBe(false);
  });

  it("does not attempt SDK top-up outside explicit Tevi mode", async () => {
    let called = false;
    const sandbox = loadRuntimeAndTeviClient({ window: { TeviJS: { topup: () => { called = true; } } } });
    const client = (sandbox.window.ChinaSlotTeviClient as TeviClientApi).createFromWindow();

    await expect(client.topup({ amount: 100, depositToken: "deposit-token-secret" })).resolves.toEqual({
      ok: false,
      status: "failed",
      reason: "tevi-mode-disabled"
    });
    expect(called).toBe(false);
  });
});