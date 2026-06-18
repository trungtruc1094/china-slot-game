import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

interface ServerClientApi {
  createBackendClient: (options: {
    mode: "production" | "demo";
    apiBaseUrl: string;
    identity: { provider: string; subject: string };
    fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<MockResponse>;
  }) => {
    spin: (request: { clientSpinId: string; wager: { lineBet: number; selectedWays: number; totalWager: number } }) => Promise<NormalizedSpinResult>;
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
  status: "retry";
  retryable: true;
  message: string;
}

interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function loadServerClient(): ServerClientApi {
  const source = readFileSync(resolve(process.cwd(), "../../js/serverClient.js"), "utf8");
  const sandbox: { ChinaSlotServerClient?: ServerClientApi } = {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  if (!sandbox.ChinaSlotServerClient) {
    throw new Error("server client did not register the browser global");
  }

  return sandbox.ChinaSlotServerClient;
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

  it("surfaces production network failures as retry state", () => {
    const client = loadServerClient();

    expect(client.buildRetryState(new Error("network offline"))).toEqual({
      mode: "production",
      source: "backend",
      status: "retry",
      retryable: true,
      message: "network offline"
    });
  });
});
