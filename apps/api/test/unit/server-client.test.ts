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
    fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<MockResponse>;
  }) => {
    startSession: () => Promise<{ sessionId: string; playerId: string; balance?: { points: number } } | null>;
    spin: (request: { clientSpinId: string; wager: { lineBet: number; selectedWays: number; totalWager: number } }) => Promise<NormalizedSpinResult | SpinRetryState>;
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

interface SlotGameCtor {
  prototype: {
    initializeBackendSessionBalance: () => void;
    requestBackendSpin: () => void;
    handleBackendSpinRetry: (retryState: SpinRetryState) => void;
    initializeTeviMiniAppShell: () => Promise<unknown> | null;
    resolveInitialPlayerCoins: (defaultCoins: number) => number;
    createClientSpinId: () => string;
    createBackendWager: () => { lineBet: number; selectedWays: number; totalWager: number };
    runSlot: () => void;
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
      isBackendProductionMode: () => true
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
      teviInitializationStatus: "idle"
    };

    await expect(SlotGame.prototype.initializeTeviMiniAppShell.call(game)).resolves.toBeNull();
    expect(calls).toEqual(["initialize"]);
    expect(game.teviInitializationStatus).toBe("unavailable");
  });
});

function isRetryState(result: NormalizedSpinResult | SpinRetryState): result is SpinRetryState {
  return "retryable" in result && result.retryable === true;
}
