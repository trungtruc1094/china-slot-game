import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

interface ServerClientApi {
  createBackendClient: (options: {
    mode?: "production" | "demo";
    apiBaseUrl: string;
    identity: { provider: string; subject: string };
    teviClient?: {
      isTeviMode: () => boolean;
      getUserAppToken: () => Promise<{ ok: boolean; runtimeToken?: string; status: string; reason?: string }>;
    };
    fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<MockResponse>;
  }) => {
    startSession: () => Promise<{ sessionId: string; playerId: string; balance?: { points: number } } | null>;
    spin: (request: { clientSpinId: string; wager: { lineBet: number; selectedWays: number; totalWager: number } }) => Promise<NormalizedSpinResult | SpinRetryState>;
    requestTopupSignature: (amount: number) => Promise<TopupSignatureResult>;
    requestCashout: (amount: number) => Promise<CashoutResult>;
    mode: "production" | "demo";
    status: string;
  };
  normalizeBackendSpinResult: (result: unknown) => NormalizedSpinResult;
  toReelStopPositions: (result: unknown, reelCount: number) => number[];
  resolveSpinRenderPlan: (options: {
    mode: "production" | "demo";
    backendResult?: unknown;
    localOutcome?: unknown;
    reelCount?: number;
  }) => SpinRenderPlan;
  buildRetryState: (error: Error) => SpinRetryState;
}

type TopupSignatureResult =
  | { ok: true; depositToken: string; requestId: string }
  | { ok: false; status: string; reason: string; retryable: boolean; requestId: string | null };

type CashoutResult =
  | { ok: true; cashoutRequestId?: string; cashoutStatus?: string; amount?: number; balanceAfter?: number; requestId: string }
  | { ok: false; status: string; reason: string; retryable: boolean; requestId: string | null };

interface TopupGame {
  topupState: string;
  topupPending: boolean;
  topupReference: string | null;
  topupModal: unknown;
  topupAmount: number;
  teviClient: unknown;
  serverClient: unknown;
  guiController?: unknown;
  slotPlayer: unknown;
  submitTopup: (amount: number) => Promise<unknown> | null;
  topupStatusMessage: (status: string) => string;
  scheduleSceneDelay?: (ms: number, callback: () => void) => void;
  closeDepositModal?: () => void;
  scheduleDepositModalClose?: (delayMs?: number) => void;
}

interface SlotGameCtor {
  prototype: {
    initializeBackendSessionBalance: () => void;
    isTeviSessionMode: () => boolean;
    loadBackendSessionBalance: (attempt: number) => void;
    isTerminalSessionReauth: (error: unknown) => boolean;
    scheduleSceneDelay: (ms: number, callback: () => void) => void;
    surfaceSessionBalanceFailure: (error: unknown) => void;
    startPostDepositBalanceRefresh: () => void;
    pollPostDepositBalance: (attempt: number, baseline: number, token: number) => void;
    requestBackendSpin: () => void;
    handleBackendSpinRetry: (retryState: SpinRetryState) => void;
    initializeTeviMiniAppShell: () => Promise<unknown> | null;
    resolveInitialPlayerCoins: (defaultCoins: number) => number;
    createClientSpinId: () => string;
    createBackendWager: () => { lineBet: number; selectedWays: number; totalWager: number };
    runSlot: () => void;
    submitTopup: (amount: number) => Promise<unknown> | null;
    isTopupAvailable: () => boolean;
    isValidTopupAmount: (amount: number) => boolean;
    resolveTopupMaxStars: () => number;
    createTopupAttemptId: () => string;
    setTopupState: (state: string) => void;
    finishTopup: (status: string) => void;
    handleTopupResult: (result: unknown) => void;
    topupStatusMessage: (status: string) => string;
    renderTopupStatus: () => void;
    updateTopupConfirmEnabled: () => void;
    closeDepositModal: () => void;
    scheduleDepositModalClose: (delayMs?: number) => void;
  };
}

interface NormalizedSpinResult {
  reelStops: Array<{ reelIndex: number; stopIndex: number }>;
  payout: number;
  balanceAfter: number;
  winBreakdown: unknown;
  freeSpinState: { awarded: number; remaining: number };
  jackpotState: { awarded: number };
}

interface SpinRenderPlan {
  mode: "production" | "demo";
  source: "backend" | "local-demo";
  reelStopPositions?: number[];
  payout?: number;
  balanceAfter?: number;
  freeSpinState?: { awarded: number; remaining: number };
  jackpotState?: { awarded: number };
  localOutcome?: unknown;
}

interface SpinRetryState {
  mode: "production";
  source: "backend";
  status: "retry";
  retryable: true;
  message: string;
}

interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

function loadServerClient(): ServerClientApi {
  const source = readFileSync(resolve(repoRoot, "js/serverClient.js"), "utf8");
  const sandbox: { ChinaSlotServerClient?: ServerClientApi } = {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  if (!sandbox.ChinaSlotServerClient) {
    throw new Error("server client did not register the browser global");
  }

  return sandbox.ChinaSlotServerClient;
}

function loadSlotGame(): SlotGameCtor {
  const source = readFileSync(resolve(repoRoot, "js/slotGame.js"), "utf8");
  const sandbox: {
    SlotGame?: SlotGameCtor;
    Phaser: { Scene: new () => unknown };
    window: Record<string, unknown>;
    slotConfig3x5: Record<string, unknown>;
  } = {
    Phaser: { Scene: class {} },
    window: {},
    slotConfig3x5: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  if (!sandbox.SlotGame) {
    throw new Error("slot game did not register the browser global");
  }

  return sandbox.SlotGame;
}

const backendResult = {
  spinId: "spin_42",
  reelStops: [
    { reelIndex: 0, stopIndex: 4 },
    { reelIndex: 1, stopIndex: 2 },
    { reelIndex: 2, stopIndex: 8 }
  ],
  visibleWindow: { rows: 3, reels: [] },
  payout: 75,
  winBreakdown: { totalPay: 75, totalFreeSpins: 2 },
  balanceAfter: 1250,
  freeSpinState: { awarded: 2, remaining: 5 },
  jackpotState: { awarded: 25 }
};

describe("browser server client render contract", () => {
  it("maps backend reel stops directly to reel spin positions", () => {
    const client = loadServerClient();

    expect(client.toReelStopPositions(backendResult, 3)).toEqual([4, 2, 8]);
  });

  it("uses only backend result fields for production render plans", () => {
    const client = loadServerClient();
    const manipulatedLocalOutcome = {
      reelStopPositions: [0, 0, 0],
      payout: 9999,
      balanceAfter: 999999,
      freeSpinState: { awarded: 100, remaining: 100 },
      jackpotState: { awarded: 9999 }
    };

    const plan = client.resolveSpinRenderPlan({
      mode: "production",
      backendResult,
      localOutcome: manipulatedLocalOutcome,
      reelCount: 3
    });

    expect(plan).toMatchObject({
      mode: "production",
      source: "backend",
      reelStopPositions: [4, 2, 8],
      payout: 75,
      balanceAfter: 1250,
      freeSpinState: { awarded: 2, remaining: 5 },
      jackpotState: { awarded: 25 }
    });
    expect(plan).not.toMatchObject(manipulatedLocalOutcome);
  });

  it("starts a backend session before posting the authoritative spin", async () => {
    const client = loadServerClient();
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetchMock = async (url: string, init: { body: string }): Promise<MockResponse> => {
      requests.push({ url, body: JSON.parse(init.body) as unknown });

      if (url.endsWith("/api/sessions")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { sessionId: "sess_123", playerId: "player_123" }, error: null })
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ data: backendResult, error: null })
      };
    };

    const backendClient = client.createBackendClient({
      mode: "production",
      apiBaseUrl: "https://api.example.test",
      identity: { provider: "guest", subject: "browser-player" },
      fetch: fetchMock
    });

    await expect(backendClient.spin({
      clientSpinId: "client-spin-1",
      wager: { lineBet: 1, selectedWays: 243, totalWager: 243 }
    })).resolves.toMatchObject({
      reelStops: backendResult.reelStops,
      payout: backendResult.payout,
      balanceAfter: backendResult.balanceAfter
    });

    expect(requests).toEqual([
      {
        url: "https://api.example.test/api/sessions",
        body: { identity: { provider: "guest", subject: "browser-player" } }
      },
      {
        url: "https://api.example.test/api/spins",
        body: {
          clientSpinId: "client-spin-1",
          sessionId: "sess_123",
          wager: { lineBet: 1, selectedWays: 243, totalWager: 243 }
        }
      }
    ]);
  });

  it("reuses an in-flight backend session request", async () => {
    const client = loadServerClient();
    let sessionRequests = 0;
    let resolveSession: (response: MockResponse) => void = () => undefined;
    const fetchMock = async (url: string): Promise<MockResponse> => {
      if (url.endsWith("/api/sessions")) {
        sessionRequests += 1;
        return new Promise((resolve) => {
          resolveSession = resolve;
        });
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ data: backendResult, error: null })
      };
    };

    const backendClient = client.createBackendClient({
      mode: "production",
      apiBaseUrl: "https://api.example.test",
      identity: { provider: "guest", subject: "browser-player" },
      fetch: fetchMock
    });

    const firstSession = backendClient.startSession();
    const secondSession = backendClient.startSession();
    expect(sessionRequests).toBe(1);
    resolveSession({
      ok: true,
      status: 200,
      json: async () => ({ data: { sessionId: "sess_123", playerId: "player_123", balance: { points: 875 } }, error: null })
    });

    await expect(Promise.all([firstSession, secondSession])).resolves.toEqual([
      { sessionId: "sess_123", playerId: "player_123", balance: { points: 875 } },
      { sessionId: "sess_123", playerId: "player_123", balance: { points: 875 } }
    ]);
  });

  it("exchanges Tevi runtime auth for an internal session while preserving request coalescing", async () => {
    const client = loadServerClient();
    const requests: Array<{ url: string; body: unknown }> = [];
    let tokenRequests = 0;
    let sdkTokenRequests = 0;
    let resolveSdkToken: (value: { ok: boolean; runtimeToken?: string; status: string }) => void = () => undefined;
    let resolveTokenExchange: (response: MockResponse) => void = () => undefined;
    let resolveTokenRequestStarted: () => void = () => undefined;
    const tokenRequestStarted = new Promise<void>((resolve) => {
      resolveTokenRequestStarted = resolve;
    });
    const fetchMock = async (url: string, init: { body: string }): Promise<MockResponse> => {
      requests.push({ url, body: JSON.parse(init.body) as unknown });
      if (url.endsWith("/api/tevi/token")) {
        tokenRequests += 1;
        resolveTokenRequestStarted();
        return new Promise((resolve) => {
          resolveTokenExchange = resolve;
        });
      }

      throw new Error("unexpected request");
    };

    const backendClient = client.createBackendClient({
      mode: "production",
      apiBaseUrl: "https://api.example.test",
      identity: { provider: "guest", subject: "browser-player" },
      teviClient: {
        isTeviMode: () => true,
        getUserAppToken: async () => {
          sdkTokenRequests += 1;
          return new Promise((resolve) => {
            resolveSdkToken = resolve;
          });
        }
      },
      fetch: fetchMock
    });

    const firstSession = backendClient.startSession();
    const secondSession = backendClient.startSession();
    expect(sdkTokenRequests).toBe(1);
    resolveSdkToken({ ok: true, status: "authenticated", runtimeToken: "runtime-token-secret" });
    await tokenRequestStarted;
    expect(tokenRequests).toBe(1);
    resolveTokenExchange({
      ok: true,
      status: 201,
      json: async () => ({
        data: {
          status: "authenticated",
          reauthRequired: false,
          session: { sessionId: "sess_tevi", playerId: "player_tevi", balance: { points: 875 } }
        },
        error: null,
        requestId: "req_tevi_token_test"
      })
    });

    await expect(Promise.all([firstSession, secondSession])).resolves.toEqual([
      { sessionId: "sess_tevi", playerId: "player_tevi", balance: { points: 875 } },
      { sessionId: "sess_tevi", playerId: "player_tevi", balance: { points: 875 } }
    ]);
    expect(requests).toEqual([{ url: "https://api.example.test/api/tevi/token", body: { runtimeToken: "runtime-token-secret" } }]);
  });

  it("surfaces Tevi re-authentication as retry state instead of creating a guest session", async () => {
    const client = loadServerClient();
    const requests: string[] = [];
    const backendClient = client.createBackendClient({
      mode: "production",
      apiBaseUrl: "https://api.example.test",
      identity: { provider: "guest", subject: "browser-player" },
      teviClient: {
        isTeviMode: () => true,
        getUserAppToken: async () => ({ ok: false, status: "re-authentication-required", reason: "user-cancelled" })
      },
      fetch: async (url: string): Promise<MockResponse> => {
        requests.push(url);
        return { ok: true, status: 200, json: async () => ({ data: {}, error: null }) };
      }
    });

    await expect(backendClient.spin({
      clientSpinId: "client-spin-reauth",
      wager: { lineBet: 1, selectedWays: 243, totalWager: 243 }
    })).resolves.toMatchObject({
      status: "retry",
      retryable: true,
      message: "Reward-bearing play is paused while the backend is unavailable."
    });
    expect(requests).toEqual([]);
    expect(backendClient.status).toBe("retry");
  });

  it("propagates browser correlation IDs to session and spin backend requests", async () => {
    const client = loadServerClient();
    const headers: Array<Record<string, string>> = [];
    const fetchMock = async (url: string, init: { headers: Record<string, string> }): Promise<MockResponse> => {
      headers.push(init.headers);

      if (url.endsWith("/api/sessions")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { sessionId: "sess_123", playerId: "player_123" }, error: null })
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ data: backendResult, error: null })
      };
    };

    const backendClient = client.createBackendClient({
      mode: "production",
      apiBaseUrl: "https://api.example.test",
      identity: { provider: "guest", subject: "browser-player" },
      fetch: fetchMock
    });

    await backendClient.spin({
      clientSpinId: "client-spin-correlation",
      wager: { lineBet: 1, selectedWays: 243, totalWager: 243 }
    });

    expect(headers).toHaveLength(2);
    expect(headers[0]?.["x-request-id"]).toMatch(/^req_browser_/);
    expect(headers[1]?.["x-request-id"]).toMatch(/^req_browser_/);
    expect(headers[0]?.["x-request-id"]).not.toBe(headers[1]?.["x-request-id"]);
  });

  it("keeps demo mode distinguishable and eligible to use local outcomes", () => {
    const client = loadServerClient();
    const localOutcome = { reelStopPositions: [1, 1, 1], payout: 10 };

    expect(client.resolveSpinRenderPlan({ mode: "demo", localOutcome })).toEqual({
      mode: "demo",
      source: "local-demo",
      localOutcome,
      retryable: false
    });
  });

  it("defaults to production mode unless demo is explicitly enabled", () => {
    const client = loadServerClient();

    expect(client.createBackendClient({
      apiBaseUrl: "https://api.example.test",
      identity: { provider: "guest", subject: "browser-player" },
      fetch: async (): Promise<MockResponse> => ({ ok: true, status: 200, json: async () => ({ data: {}, error: null }) })
    }).mode).toBe("production");
    expect(client.createBackendClient({
      mode: "demo",
      apiBaseUrl: "https://api.example.test",
      identity: { provider: "guest", subject: "browser-player" },
      fetch: async (): Promise<MockResponse> => ({ ok: true, status: 200, json: async () => ({ data: {}, error: null }) })
    }).mode).toBe("demo");
    expect(client.createBackendClient({
      mode: "banana" as "demo",
      apiBaseUrl: "https://api.example.test",
      identity: { provider: "guest", subject: "browser-player" },
      fetch: async (): Promise<MockResponse> => ({ ok: true, status: 200, json: async () => ({ data: {}, error: null }) })
    }).mode).toBe("production");
  });

  it("surfaces production network failures as a non-leaky retry state", () => {
    const client = loadServerClient();

    expect(client.buildRetryState(new Error("network offline"))).toEqual({
      mode: "production",
      source: "backend",
      status: "retry",
      retryable: true,
      message: "Reward-bearing play is paused while the backend is unavailable."
    });
  });

  it("returns a blocked production render plan instead of falling back to local outcomes when backend result is missing", () => {
    const client = loadServerClient();
    const localOutcome = { reelStopPositions: [1, 1, 1], payout: 500, balanceAfter: 999999 };

    expect(client.resolveSpinRenderPlan({
      mode: "production",
      localOutcome,
      reelCount: 3
    })).toEqual({
      mode: "production",
      source: "backend",
      status: "retry",
      retryable: true,
      message: "Reward-bearing play is paused while the backend is unavailable."
    });
  });

  it("converts production network failures to non-leaky retry state", async () => {
    const client = loadServerClient();
    const backendClient = client.createBackendClient({
      mode: "production",
      apiBaseUrl: "https://api.example.test",
      identity: { provider: "guest", subject: "browser-player" },
      fetch: async () => {
        throw new Error("network offline at internal host db-01 request req_secret_123");
      }
    });

    await expect(backendClient.spin({
      clientSpinId: "client-spin-network-fail",
      wager: { lineBet: 1, selectedWays: 243, totalWager: 243 }
    })).resolves.toEqual({
      mode: "production",
      source: "backend",
      status: "retry",
      retryable: true,
      message: "Reward-bearing play is paused while the backend is unavailable."
    });
    expect(backendClient.status).toBe("retry");
  });

  it("converts backend timeouts to non-leaky retry state", async () => {
    const client = loadServerClient();
    const timeoutError = new Error("AbortError: timeout after 3000ms for session sess_secret");
    timeoutError.name = "AbortError";
    const backendClient = client.createBackendClient({
      mode: "production",
      apiBaseUrl: "https://api.example.test",
      identity: { provider: "guest", subject: "browser-player" },
      fetch: async () => {
        throw timeoutError;
      }
    });

    await expect(backendClient.spin({
      clientSpinId: "client-spin-timeout",
      wager: { lineBet: 1, selectedWays: 243, totalWager: 243 }
    })).resolves.toMatchObject({
      status: "retry",
      retryable: true,
      message: "Reward-bearing play is paused while the backend is unavailable."
    });
  });

  it("converts backend 5xx responses to non-leaky retry state", async () => {
    const client = loadServerClient();
    const backendClient = client.createBackendClient({
      mode: "production",
      apiBaseUrl: "https://api.example.test",
      identity: { provider: "guest", subject: "browser-player" },
      fetch: async (): Promise<MockResponse> => ({
        ok: false,
        status: 503,
        json: async () => ({
          data: null,
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "stack trace: database host db-01 request req_secret_456 session sess_secret",
            details: { requestId: "req_secret_456" }
          }
        })
      })
    });

    await expect(backendClient.spin({
      clientSpinId: "client-spin-5xx",
      wager: { lineBet: 1, selectedWays: 243, totalWager: 243 }
    })).resolves.toEqual({
      mode: "production",
      source: "backend",
      status: "retry",
      retryable: true,
      message: "Reward-bearing play is paused while the backend is unavailable."
    });
  });

  it("does not post a spin when session validation fails", async () => {
    const client = loadServerClient();
    const requests: Array<string> = [];
    const backendClient = client.createBackendClient({
      mode: "production",
      apiBaseUrl: "https://api.example.test",
      identity: { provider: "guest", subject: "browser-player" },
      fetch: async (url: string): Promise<MockResponse> => {
        requests.push(url);
        return {
          ok: false,
          status: 401,
          json: async () => ({
            data: null,
            error: { code: "SESSION_EXPIRED", message: "Session sess_secret expired.", details: {} }
          })
        };
      }
    });

    await expect(backendClient.spin({
      clientSpinId: "client-spin-session-fail",
      wager: { lineBet: 1, selectedWays: 243, totalWager: 243 }
    })).resolves.toMatchObject({
      status: "retry",
      retryable: true,
      message: "Reward-bearing play is paused while the backend is unavailable."
    });
    expect(requests).toEqual(["https://api.example.test/api/sessions"]);
  });

  it("preserves caller wallet and render state after backend failure mid-spin", async () => {
    const client = loadServerClient();
    var walletState = { balance: 1000, payout: 0 };
    var renderPlan: unknown = { reelStopPositions: [0, 0, 0], payout: 0, balanceAfter: 1000 };
    const backendClient = client.createBackendClient({
      mode: "production",
      apiBaseUrl: "https://api.example.test",
      identity: { provider: "guest", subject: "browser-player" },
      fetch: async (url: string): Promise<MockResponse> => {
        if (url.endsWith("/api/sessions")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { sessionId: "sess_123", playerId: "player_123" }, error: null })
          };
        }
        return {
          ok: false,
          status: 503,
          json: async () => ({ data: null, error: { code: "BACKEND_DOWN", message: "internal failure", details: {} } })
        };
      }
    });

    const result = await backendClient.spin({
      clientSpinId: "client-spin-mid-fail",
      wager: { lineBet: 1, selectedWays: 243, totalWager: 243 }
    });

    if (!isRetryState(result)) {
      walletState = { balance: result.balanceAfter, payout: result.payout };
      renderPlan = client.resolveSpinRenderPlan({ mode: "production", backendResult: result, reelCount: 3 });
    }

    expect(result).toMatchObject({ status: "retry", retryable: true });
    expect(walletState).toEqual({ balance: 1000, payout: 0 });
    expect(renderPlan).toEqual({ reelStopPositions: [0, 0, 0], payout: 0, balanceAfter: 1000 });
  });

  it("keeps slot game in retry state when backend client resolves a retry result", async () => {
    const SlotGame = loadSlotGame();
    const calls: Array<Record<string, unknown>> = [];
    const retryState: SpinRetryState = {
      mode: "production",
      source: "backend",
      status: "retry",
      retryable: true,
      message: "Reward-bearing play is paused while the backend is unavailable."
    };
    const game = {
      backendSpinPending: false,
      backendSpinStatus: "idle",
      backendSpinResult: null,
      backendSpinPlan: null,
      serverClient: {
        spin: async () => retryState
      },
      slotControls: {
        lineBet: 1,
        auto: true,
        setSpinButtonText: (text: string) => calls.push({ type: "button", text }),
        setControlActivity: (spin: boolean, bet: boolean, auto: boolean) => calls.push({ type: "controls", spin, bet, auto }),
        resetAutoSpinsMode: () => calls.push({ type: "resetAuto" })
      },
      guiController: {
        showMessage: (title: string, message: string) => {
          calls.push({ type: "message", title, message });
          return "message-id";
        },
        closePopUp: (id: string) => calls.push({ type: "close", id })
      },
      stateMachine: {
        changeState: (state: string) => calls.push({ type: "state", state })
      },
      iddleState: "idle",
      reels: [{}, {}, {}],
      runSlot: () => calls.push({ type: "runSlot" }),
      handleBackendSpinRetry: SlotGame.prototype.handleBackendSpinRetry,
      createClientSpinId: () => "client-spin-safe-fail",
      createBackendWager: () => ({ lineBet: 1, selectedWays: 243, totalWager: 243 })
    };

    SlotGame.prototype.requestBackendSpin.call(game);
    await Promise.resolve();
    await Promise.resolve();

    expect(game.backendSpinStatus).toBe("retry");
    expect(game.backendSpinResult).toBeNull();
    expect(game.backendSpinPlan).toEqual(retryState);
    expect(calls).toContainEqual({ type: "button", text: "RETRY" });
    expect(calls).toContainEqual({ type: "controls", spin: true, bet: true, auto: true });
    expect(calls).toContainEqual({
      type: "message",
      title: "Backend unavailable",
      message: "Reward-bearing play is paused while the backend is unavailable."
    });
    expect(calls).not.toContainEqual({ type: "runSlot" });
  });

  it("loads the backend session balance before the first production spin", async () => {
    const SlotGame = loadSlotGame();
    const calls: Array<Record<string, unknown>> = [];
    const game = {
      backendSpinStatus: "idle",
      backendSpinPlan: null,
      serverClient: {
        mode: "production",
        startSession: async () => ({ balance: { points: 875 } })
      },
      slotControls: {
        creditSumText: { text: "100000" }
      },
      slotPlayer: {
        setCoinsCount: (points: number) => calls.push({ type: "balance", points })
      },
      isBackendProductionMode: () => true,
      isTeviSessionMode: SlotGame.prototype.isTeviSessionMode,
      loadBackendSessionBalance: SlotGame.prototype.loadBackendSessionBalance,
      isTerminalSessionReauth: SlotGame.prototype.isTerminalSessionReauth,
      scheduleSceneDelay: SlotGame.prototype.scheduleSceneDelay,
      surfaceSessionBalanceFailure: SlotGame.prototype.surfaceSessionBalanceFailure
    };

    SlotGame.prototype.initializeBackendSessionBalance.call(game);
    expect(game.slotControls.creditSumText.text).toBe(" ...");
    await Promise.resolve();
    await Promise.resolve();

    expect(game.backendSpinStatus).toBe("ready");
    expect(calls).toEqual([{ type: "balance", points: 875 }]);
  });

  it("does not replace the demo balance from backend session startup", async () => {
    const SlotGame = loadSlotGame();
    const calls: Array<Record<string, unknown>> = [];
    const game = {
      backendSpinStatus: "demo",
      serverClient: {
        mode: "demo",
        startSession: async () => {
          calls.push({ type: "session" });
          return { balance: { points: 875 } };
        }
      },
      slotControls: {
        creditSumText: { text: "100000" }
      },
      slotPlayer: {
        setCoinsCount: (points: number) => calls.push({ type: "balance", points })
      },
      isBackendProductionMode: () => false
    };

    SlotGame.prototype.initializeBackendSessionBalance.call(game);
    await Promise.resolve();

    expect(game.backendSpinStatus).toBe("demo");
    expect(game.slotControls.creditSumText.text).toBe("100000");
    expect(calls).toEqual([]);
  });

  it("starts Tevi and production reward-bearing modes with zero until backend balance arrives", () => {
    const SlotGame = loadSlotGame();

    expect(SlotGame.prototype.resolveInitialPlayerCoins.call({
      isBackendProductionMode: () => true,
      teviClient: null
    }, 100000)).toBe(0);

    expect(SlotGame.prototype.resolveInitialPlayerCoins.call({
      isBackendProductionMode: () => false,
      teviClient: { isTeviMode: () => true }
    }, 100000)).toBe(0);

    expect(SlotGame.prototype.resolveInitialPlayerCoins.call({
      isBackendProductionMode: () => false,
      teviClient: { isTeviMode: () => false }
    }, 100000)).toBe(100000);
  });

  it("initializes Tevi Mini App shell affordances without throwing when SDK setup fails", async () => {
    const SlotGame = loadSlotGame();
    const calls: string[] = [];
    const game = {
      teviClient: {
        isTeviMode: () => true,
        initialize: async () => {
          calls.push("initialize");
          throw new Error("sdk unavailable");
        }
      },
      teviInitializationStatus: "idle",
      isTeviSessionMode: SlotGame.prototype.isTeviSessionMode
    };

    await expect(SlotGame.prototype.initializeTeviMiniAppShell.call(game)).resolves.toBeNull();
    expect(calls).toEqual(["initialize"]);
    expect(game.teviInitializationStatus).toBe("unavailable");
  });

  it("waits for the Tevi SDK to initialize before loading the session balance (AC1)", async () => {
    const SlotGame = loadSlotGame();
    const order: string[] = [];
    let resolveReady: () => void = () => {};
    const ready = new Promise<void>((r) => { resolveReady = () => { order.push("sdk-ready"); r(); }; });

    const game = {
      backendSpinStatus: "idle",
      backendSpinPlan: null,
      teviReady: ready,
      teviClient: { isTeviMode: () => true },
      serverClient: {
        mode: "production",
        startSession: async () => { order.push("start-session"); return { balance: { points: 1000 } }; }
      },
      slotControls: { creditSumText: { text: "100000" } },
      slotPlayer: { setCoinsCount: () => {} },
      isBackendProductionMode: () => true,
      isTeviSessionMode: SlotGame.prototype.isTeviSessionMode,
      loadBackendSessionBalance: SlotGame.prototype.loadBackendSessionBalance,
      isTerminalSessionReauth: SlotGame.prototype.isTerminalSessionReauth,
      scheduleSceneDelay: SlotGame.prototype.scheduleSceneDelay,
      surfaceSessionBalanceFailure: SlotGame.prototype.surfaceSessionBalanceFailure
    };

    SlotGame.prototype.initializeBackendSessionBalance.call(game);
    await Promise.resolve();
    // Session load must not have started before the SDK signalled ready.
    expect(order).toEqual([]);

    resolveReady();
    await ready;
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(["sdk-ready", "start-session"]);
    expect(game.backendSpinStatus).toBe("ready");
  });

  it("retries a transient SDK-not-ready session failure before succeeding (AC2)", async () => {
    const SlotGame = loadSlotGame();
    let attempts = 0;
    const balances: number[] = [];
    const game = {
      backendSpinStatus: "pending",
      backendSpinPlan: null,
      serverClient: {
        mode: "production",
        startSession: async () => {
          attempts += 1;
          if (attempts === 1) {
            const error = new Error("Tevi re-authentication is required.") as Error & { code: string; reason: string };
            error.code = "TEVI_REAUTH_REQUIRED";
            error.reason = "sdk-unavailable";
            throw error;
          }
          return { balance: { points: 1500 } };
        }
      },
      slotControls: { creditSumText: { text: " ..." } },
      slotPlayer: { setCoinsCount: (points: number) => balances.push(points) },
      isBackendProductionMode: () => true,
      isTerminalSessionReauth: SlotGame.prototype.isTerminalSessionReauth,
      loadBackendSessionBalance: SlotGame.prototype.loadBackendSessionBalance,
      // Run the backoff immediately so the test stays deterministic.
      scheduleSceneDelay: (_ms: number, callback: () => void) => { callback(); },
      surfaceSessionBalanceFailure: SlotGame.prototype.surfaceSessionBalanceFailure
    };

    SlotGame.prototype.loadBackendSessionBalance.call(game, 0);
    // Let the rejected attempt + the retry's resolution flush.
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    expect(attempts).toBe(2);
    expect(balances).toEqual([1500]);
    expect(game.backendSpinStatus).toBe("ready");
  });

  it("surfaces a clear re-auth state instead of stalling on a terminal session failure (AC2)", async () => {
    const SlotGame = loadSlotGame();
    const messages: Array<{ title: string; body: string }> = [];
    const game = {
      backendSpinStatus: "pending",
      backendSpinPlan: null,
      serverClient: {
        mode: "production",
        startSession: async () => {
          const error = new Error("Tevi re-authentication is required.") as Error & { code: string; reason: string };
          error.code = "TEVI_REAUTH_REQUIRED";
          error.reason = "token-missing";
          throw error;
        }
      },
      slotControls: { creditSumText: { text: " ..." } },
      slotPlayer: { setCoinsCount: () => {} },
      guiController: {
        showMessage: (title: string, body: string) => { messages.push({ title, body }); return {}; },
        closePopUp: () => {}
      },
      isBackendProductionMode: () => true,
      isTerminalSessionReauth: SlotGame.prototype.isTerminalSessionReauth,
      scheduleSceneDelay: (_ms: number, callback: () => void) => { callback(); },
      surfaceSessionBalanceFailure: SlotGame.prototype.surfaceSessionBalanceFailure
    };

    SlotGame.prototype.loadBackendSessionBalance.call(game, 0);
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    expect(game.backendSpinStatus).toBe("reauth-required");
    expect(game.slotControls.creditSumText.text).not.toBe(" ...");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.title ?? "").toContain("Tevi");
  });

  it("treats a 401 token-exchange rejection as terminal re-auth without pointless retries (AC2)", async () => {
    const SlotGame = loadSlotGame();
    const messages: Array<{ title: string; body: string }> = [];
    let startSessionCalls = 0;
    const game = {
      backendSpinStatus: "pending",
      backendSpinPlan: null,
      serverClient: {
        mode: "production",
        // Mirrors postJson's HTTP-error shape when /api/tevi/token returns 401 PROVIDER_REJECTED:
        // status 401 + the backend's TEVI_TOKEN_EXCHANGE_FAILED code, no `reason`.
        startSession: async () => {
          startSessionCalls += 1;
          const error = new Error("Tevi authentication requires a new sign-in.") as Error & { status: number; code: string };
          error.status = 401;
          error.code = "TEVI_TOKEN_EXCHANGE_FAILED";
          throw error;
        }
      },
      slotControls: { creditSumText: { text: " ..." } },
      slotPlayer: { setCoinsCount: () => {} },
      guiController: {
        showMessage: (title: string, body: string) => { messages.push({ title, body }); return {}; },
        closePopUp: () => {}
      },
      isBackendProductionMode: () => true,
      isTerminalSessionReauth: SlotGame.prototype.isTerminalSessionReauth,
      scheduleSceneDelay: (_ms: number, callback: () => void) => { callback(); },
      surfaceSessionBalanceFailure: SlotGame.prototype.surfaceSessionBalanceFailure
    };

    SlotGame.prototype.loadBackendSessionBalance.call(game, 0);
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    expect(startSessionCalls).toBe(1); // terminal => no retry re-sending the rejected token
    expect(game.backendSpinStatus).toBe("reauth-required");
    expect(game.slotControls.creditSumText.text).not.toBe(" ...");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.title ?? "").toContain("Tevi");
  });

  it("still retries a transient 5xx token-exchange failure rather than forcing re-auth (AC2)", async () => {
    const SlotGame = loadSlotGame();
    let startSessionCalls = 0;
    const game = {
      backendSpinStatus: "pending",
      backendSpinPlan: null,
      serverClient: {
        mode: "production",
        // PROVIDER_UNAVAILABLE surfaces as 503 with the same TEVI_TOKEN_EXCHANGE_FAILED code —
        // must stay retryable, proving we key on the 401 status and not the code.
        startSession: async () => {
          startSessionCalls += 1;
          const error = new Error("Tevi auth temporarily unavailable.") as Error & { status: number; code: string };
          error.status = 503;
          error.code = "TEVI_TOKEN_EXCHANGE_FAILED";
          throw error;
        }
      },
      slotControls: { creditSumText: { text: " ..." } },
      slotPlayer: { setCoinsCount: () => {} },
      guiController: { showMessage: () => ({}), closePopUp: () => {} },
      isBackendProductionMode: () => true,
      isTerminalSessionReauth: SlotGame.prototype.isTerminalSessionReauth,
      scheduleSceneDelay: (_ms: number, callback: () => void) => { callback(); },
      loadBackendSessionBalance: SlotGame.prototype.loadBackendSessionBalance,
      surfaceSessionBalanceFailure: SlotGame.prototype.surfaceSessionBalanceFailure
    };

    SlotGame.prototype.loadBackendSessionBalance.call(game, 0);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    expect(startSessionCalls).toBe(3); // initial + 2 retries (transient), then surfaced as retry
    expect(game.backendSpinStatus).toBe("retry");
  });
});

function isRetryState(result: NormalizedSpinResult | SpinRetryState): result is SpinRetryState {
  return "retryable" in result && result.retryable === true;
}

interface TopupClientHooks {
  teviMode?: boolean;
  tokenResult?: { ok: boolean; runtimeToken?: string; status: string; reason?: string };
}

function createTopupBackendClient(
  client: ServerClientApi,
  fetchMock: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<MockResponse>,
  hooks: TopupClientHooks = {}
): ReturnType<ServerClientApi["createBackendClient"]> {
  return client.createBackendClient({
    mode: "production",
    apiBaseUrl: "https://api.example.test",
    identity: { provider: "guest", subject: "browser-player" },
    teviClient: {
      isTeviMode: () => hooks.teviMode ?? true,
      getUserAppToken: async () => hooks.tokenResult ?? { ok: true, status: "authenticated", runtimeToken: "runtime-token-secret" }
    },
    fetch: fetchMock
  });
}

describe("browser server client Tevi top-up signature requests", () => {
  it("requests an authenticated deposit token and returns it with the correlation id", async () => {
    const client = loadServerClient();
    const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body: string } }> = [];
    const backendClient = createTopupBackendClient(client, async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 201,
        json: async () => ({ data: { deposit_token: "provider.deposit.token" }, error: null, requestId: init.headers["x-request-id"] })
      };
    });

    const result = await backendClient.requestTopupSignature(100);

    expect(result).toMatchObject({ ok: true, depositToken: "provider.deposit.token" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/payments/top-up-signature");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers.authorization).toBe("Bearer runtime-token-secret");
    expect(calls[0]?.init.headers["x-request-id"]).toMatch(/^req_browser_/);
    expect(JSON.parse(calls[0]?.init.body ?? "{}")).toEqual({ amount: 100 });
    if (result.ok) {
      expect(result.requestId).toBe(calls[0]?.init.headers["x-request-id"]);
    }
  });

  it("refuses to request a signature outside Tevi mode and never falls back to guest identity", async () => {
    const client = loadServerClient();
    const calls: string[] = [];
    const backendClient = createTopupBackendClient(client, async (url) => {
      calls.push(url);
      return { ok: true, status: 201, json: async () => ({ data: { deposit_token: "provider.deposit.token" }, error: null }) };
    }, { teviMode: false });

    await expect(backendClient.requestTopupSignature(100)).resolves.toEqual({
      ok: false,
      status: "blocked",
      reason: "tevi-mode-required",
      retryable: false,
      requestId: null
    });
    expect(calls).toEqual([]);
  });

  it("surfaces Tevi re-authentication without calling the backend", async () => {
    const client = loadServerClient();
    const calls: string[] = [];
    const backendClient = createTopupBackendClient(client, async (url) => {
      calls.push(url);
      return { ok: true, status: 201, json: async () => ({ data: { deposit_token: "provider.deposit.token" }, error: null }) };
    }, { tokenResult: { ok: false, status: "re-authentication-required", reason: "user-cancelled" } });

    await expect(backendClient.requestTopupSignature(100)).resolves.toMatchObject({
      ok: false,
      status: "re-authentication-required",
      reason: "user-cancelled",
      retryable: true
    });
    expect(calls).toEqual([]);
  });

  it("rejects invalid amounts before any network call", async () => {
    const client = loadServerClient();
    const calls: string[] = [];
    const backendClient = createTopupBackendClient(client, async (url) => {
      calls.push(url);
      return { ok: true, status: 201, json: async () => ({ data: { deposit_token: "x" }, error: null }) };
    });

    await expect(backendClient.requestTopupSignature(1.5)).resolves.toMatchObject({ ok: false, status: "failed", reason: "invalid-amount" });
    expect(calls).toEqual([]);
  });

  it("treats a missing deposit token in a success envelope as a safe failed state", async () => {
    const client = loadServerClient();
    const backendClient = createTopupBackendClient(client, async () => ({
      ok: true,
      status: 201,
      json: async () => ({ data: {}, error: null, requestId: "req_no_token" })
    }));

    await expect(backendClient.requestTopupSignature(100)).resolves.toMatchObject({
      ok: false,
      status: "failed",
      reason: "deposit-token-missing"
    });
  });

  it.each([
    [401, "TEVI_AUTH_REQUIRED", { status: "re-authentication-required", reason: "tevi-auth-required", retryable: true }],
    [403, "TEVI_WRONG_APP", { status: "blocked", reason: "tevi-forbidden", retryable: false }],
    [409, "TEVI_TOP_UP_DUPLICATE_REQUEST", { status: "failed", reason: "signature-rejected", retryable: false }],
    [503, "TEVI_PAYMENT_CONFIG_MISSING", { status: "retryable-failure", reason: "backend-unavailable", retryable: true }]
  ])("maps a %s backend error into a safe top-up state", async (httpStatus, code, expected) => {
    const client = loadServerClient();
    const backendClient = createTopupBackendClient(client, async () => ({
      ok: false,
      status: httpStatus as number,
      json: async () => ({ data: null, error: { code, message: "internal db-01 sess_secret", details: {} } })
    }));

    await expect(backendClient.requestTopupSignature(100)).resolves.toMatchObject(expected as Record<string, unknown>);
  });

  it("converts a network failure into a retryable top-up failure", async () => {
    const client = loadServerClient();
    const backendClient = createTopupBackendClient(client, async () => {
      throw new Error("network offline at db-01 req_secret_123");
    });

    await expect(backendClient.requestTopupSignature(100)).resolves.toMatchObject({
      ok: false,
      status: "retryable-failure",
      reason: "backend-unavailable",
      retryable: true
    });
  });
});

describe("slot game Tevi deposit flow", () => {
  function bindTopupGame(SlotGame: SlotGameCtor, overrides: Partial<TopupGame>): TopupGame {
    return {
      topupState: "idle",
      topupPending: false,
      topupReference: null,
      topupModal: null,
      topupAmount: 0,
      teviClient: null,
      serverClient: null,
      guiController: null,
      slotPlayer: null,
      submitTopup: SlotGame.prototype.submitTopup,
      isTopupAvailable: SlotGame.prototype.isTopupAvailable,
      isValidTopupAmount: SlotGame.prototype.isValidTopupAmount,
      resolveTopupMaxStars: SlotGame.prototype.resolveTopupMaxStars,
      createTopupAttemptId: SlotGame.prototype.createTopupAttemptId,
      setTopupState: SlotGame.prototype.setTopupState,
      finishTopup: SlotGame.prototype.finishTopup,
      handleTopupResult: SlotGame.prototype.handleTopupResult,
      startPostDepositBalanceRefresh: SlotGame.prototype.startPostDepositBalanceRefresh,
      pollPostDepositBalance: SlotGame.prototype.pollPostDepositBalance,
      scheduleSceneDelay: SlotGame.prototype.scheduleSceneDelay,
      closeDepositModal: SlotGame.prototype.closeDepositModal,
      scheduleDepositModalClose: SlotGame.prototype.scheduleDepositModalClose,
      topupStatusMessage: SlotGame.prototype.topupStatusMessage,
      renderTopupStatus: SlotGame.prototype.renderTopupStatus,
      updateTopupConfirmEnabled: SlotGame.prototype.updateTopupConfirmEnabled,
      ...overrides
    } as unknown as TopupGame;
  }

  it("moves to pending without mutating the wallet on SDK success", async () => {
    const SlotGame = loadSlotGame();
    const balanceCalls: number[] = [];
    const topupCalls: Array<Record<string, unknown>> = [];
    const game = bindTopupGame(SlotGame, {
      teviClient: {
        isTeviMode: () => true,
        topup: async (options: Record<string, unknown>) => {
          topupCalls.push(options);
          return { ok: true, status: "webhook-pending", reason: "sdk-confirmed", reference: "tevi-ref-9" };
        }
      },
      serverClient: {
        requestTopupSignature: async () => ({ ok: true, depositToken: "provider.deposit.token", requestId: "req_browser_1" })
      },
      slotPlayer: { setCoinsCount: (points: number) => balanceCalls.push(points), addCoins: (points: number) => balanceCalls.push(points) }
    });

    await game.submitTopup(100);

    expect(game.topupState).toBe("webhook-pending");
    expect(game.topupPending).toBe(false);
    expect(game.topupReference).toBe("tevi-ref-9");
    expect(balanceCalls).toEqual([]);
    expect(topupCalls).toHaveLength(1);
    expect(topupCalls[0]).toMatchObject({ amount: 100, depositToken: "provider.deposit.token", requestId: "req_browser_1" });
    expect(game.topupStatusMessage("webhook-pending")).toContain("Waiting for Tevi confirmation");
  });

  it("debounces duplicate deposit submissions while a request is in flight", async () => {
    const SlotGame = loadSlotGame();
    let signatureCalls = 0;
    let releaseSignature: (value: { ok: false; status: string; reason: string; retryable: boolean; requestId: null }) => void = () => undefined;
    const game = bindTopupGame(SlotGame, {
      teviClient: { isTeviMode: () => true, topup: async () => ({ ok: true, status: "webhook-pending" }) },
      serverClient: {
        requestTopupSignature: async () => {
          signatureCalls += 1;
          return new Promise((resolve) => {
            releaseSignature = resolve;
          });
        }
      },
      slotPlayer: { setCoinsCount: () => undefined }
    });

    const first = game.submitTopup(100);
    const second = game.submitTopup(100);

    expect(second).toBeNull();
    expect(signatureCalls).toBe(1);
    releaseSignature({ ok: false, status: "retryable-failure", reason: "backend-unavailable", retryable: true, requestId: null });
    await first;
    expect(game.topupPending).toBe(false);
  });

  it("rejects an invalid amount without requesting a signature", async () => {
    const SlotGame = loadSlotGame();
    let signatureCalls = 0;
    const game = bindTopupGame(SlotGame, {
      teviClient: { isTeviMode: () => true, topup: async () => ({ ok: true, status: "webhook-pending" }) },
      serverClient: {
        requestTopupSignature: async () => {
          signatureCalls += 1;
          return { ok: true, depositToken: "x", requestId: "r" };
        }
      },
      slotPlayer: { setCoinsCount: () => undefined }
    });

    expect(game.submitTopup(1.5)).toBeNull();
    expect(game.topupState).toBe("invalid-amount");
    expect(signatureCalls).toBe(0);
  });

  it("surfaces a signature re-auth failure without calling the SDK or wallet", async () => {
    const SlotGame = loadSlotGame();
    const balanceCalls: number[] = [];
    let sdkCalls = 0;
    const game = bindTopupGame(SlotGame, {
      teviClient: {
        isTeviMode: () => true,
        topup: async () => {
          sdkCalls += 1;
          return { ok: true, status: "webhook-pending" };
        }
      },
      serverClient: {
        requestTopupSignature: async () => ({ ok: false, status: "re-authentication-required", reason: "tevi-auth-required", retryable: true, requestId: null })
      },
      slotPlayer: { setCoinsCount: (points: number) => balanceCalls.push(points) }
    });

    await game.submitTopup(100);

    expect(game.topupState).toBe("re-authentication-required");
    expect(sdkCalls).toBe(0);
    expect(balanceCalls).toEqual([]);
    expect(game.topupPending).toBe(false);
  });

  it("maps an SDK cancellation into a recoverable canceled state", async () => {
    const SlotGame = loadSlotGame();
    const game = bindTopupGame(SlotGame, {
      teviClient: { isTeviMode: () => true, topup: async () => ({ ok: false, status: "canceled", reason: "user-cancelled" }) },
      serverClient: { requestTopupSignature: async () => ({ ok: true, depositToken: "provider.deposit.token", requestId: "req_browser_2" }) },
      slotPlayer: { setCoinsCount: () => undefined }
    });

    await game.submitTopup(100);

    expect(game.topupState).toBe("canceled");
    expect(game.topupPending).toBe(false);
  });

  it("does nothing in local/demo mode where Tevi top-up is unavailable", async () => {
    const SlotGame = loadSlotGame();
    let signatureCalls = 0;
    const game = bindTopupGame(SlotGame, {
      teviClient: { isTeviMode: () => false, topup: async () => ({ ok: true, status: "webhook-pending" }) },
      serverClient: {
        requestTopupSignature: async () => {
          signatureCalls += 1;
          return { ok: true, depositToken: "x", requestId: "r" };
        }
      },
      slotPlayer: { setCoinsCount: () => undefined }
    });

    expect(game.submitTopup(100)).toBeNull();
    expect(signatureCalls).toBe(0);
    expect(game.topupState).toBe("idle");
  });

  it("refreshes the balance from the server after a webhook-pending deposit (AC4)", async () => {
    const SlotGame = loadSlotGame();
    const balanceCalls: number[] = [];
    let refreshCalls = 0;
    let closeCalls = 0;
    const modal = { messageText: { text: "" }, okButton: { setInteractable: () => undefined, button: { alpha: 1 } } };
    const game = bindTopupGame(SlotGame, {
      teviClient: {
        isTeviMode: () => true,
        topup: async () => ({ ok: true, status: "webhook-pending", reason: "sdk-confirmed", reference: "ref-1" })
      },
      serverClient: {
        requestTopupSignature: async () => ({ ok: true, depositToken: "tok", requestId: "req-1" }),
        // First read still shows the pre-credit balance; the second read reflects the
        // webhook-applied credit (server-authoritative — the client only reads it).
        refreshSession: async () => {
          refreshCalls += 1;
          return { balance: { points: refreshCalls >= 2 ? 1050 : 1000 } };
        }
      },
      topupModal: modal,
      guiController: {
        closePopUp: () => { closeCalls += 1; }
      },
      slotPlayer: { coins: 1000, setCoinsCount: (points: number) => balanceCalls.push(points), addCoins: () => {} },
      // Run each poll tick immediately so the test is deterministic.
      scheduleSceneDelay: (_ms: number, callback: () => void) => { callback(); }
    });

    await game.submitTopup(100);

    // Flush the bounded poll cycle.
    for (let i = 0; i < 12; i += 1) await Promise.resolve();

    expect(refreshCalls).toBeGreaterThanOrEqual(2);
    expect(balanceCalls).toEqual([1050]);
    expect(game.topupState).toBe("idle");
    expect(game.topupModal).toBeNull();
    expect(closeCalls).toBe(1);
    expect(game.topupStatusMessage("credited")).toContain("Stars balance is updated");
  });

  it("requests cashout with Tevi bearer and parses dispatched envelope", async () => {
    const fetchCalls: Array<{ url: string; init: { headers: Record<string, string>; body: string } }> = [];
    const backendClient = loadServerClient().createBackendClient({
      mode: "production",
      apiBaseUrl: "http://127.0.0.1:3000",
      identity: { provider: "guest", subject: "browser-test" },
      teviClient: {
        isTeviMode: () => true,
        getUserAppToken: async () => ({ ok: true, runtimeToken: "runtime-token", status: "ready" })
      },
      fetch: async (url, init) => {
        fetchCalls.push({ url, init });
        return new Response(JSON.stringify({
          data: {
            cashout_request_id: "cashout_req_1",
            status: "dispatched",
            amount: 100,
            balance_after: 900
          },
          error: null,
          requestId: "req_cashout_browser"
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
    });

    const result = await backendClient.requestCashout(100);
    expect(result).toMatchObject({
      ok: true,
      cashoutStatus: "dispatched",
      balanceAfter: 900
    });
    expect(fetchCalls[0]?.url).toContain("/api/v1/payments/cashout-requests");
    expect(fetchCalls[0]?.init.headers.authorization).toBe("Bearer runtime-token");
  });

  it("maps insufficient cashout balance to a client status", async () => {
    const backendClient = loadServerClient().createBackendClient({
      mode: "production",
      apiBaseUrl: "http://127.0.0.1:3000",
      identity: { provider: "guest", subject: "browser-test" },
      teviClient: {
        isTeviMode: () => true,
        getUserAppToken: async () => ({ ok: true, runtimeToken: "runtime-token", status: "ready" })
      },
      fetch: async () => new Response(JSON.stringify({
        error: { code: "INSUFFICIENT_BALANCE", message: "too much" },
        data: null,
        requestId: "req_cashout_fail"
      }), { status: 409, headers: { "content-type": "application/json" } })
    });

    await expect(backendClient.requestCashout(500)).resolves.toMatchObject({
      ok: false,
      status: "insufficient-balance"
    });
  });
});
