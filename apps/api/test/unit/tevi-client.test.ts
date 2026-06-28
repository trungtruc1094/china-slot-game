import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

interface TeviClientApi {
  createFromWindow: () => TeviClient;
  resolveRuntimeConfig: () => TeviRuntimeConfig;
}

interface TeviClient {
  initialize: () => Promise<TeviCallResult>;
  getState: () => TeviState;
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
    expect(appendedPanels[0]?.textContent).toContain("sdkAvailable: true");
    expect(appendedPanels[0]?.textContent).toContain("appId: AZX29173");
    expect(appendedPanels[0]?.textContent).toContain("channelId: 2300210851");
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
});