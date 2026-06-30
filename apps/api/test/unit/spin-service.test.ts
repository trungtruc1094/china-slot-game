import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryPlayerSessionRepository } from "../../src/domain/player-identity.js";
import { SessionService, type Clock } from "../../src/domain/session-service.js";
import { SpinService } from "../../src/domain/spin-service.js";
import { WalletService } from "../../src/domain/wallet-service.js";
import { simpleConfig } from "../fixtures/simple-config.js";

class FixedClock implements Clock {
  public current = new Date("2026-06-30T08:00:00.000Z");
  public now(): Date {
    return this.current;
  }
}

const wager = { lineBet: 1, selectedWays: 1, totalWager: 1 };
const identityExpiry = "2026-06-30T09:00:00.000Z";

let clock: FixedClock;
let repository: InMemoryPlayerSessionRepository;
let sessionService: SessionService;
let walletService: WalletService;
let spinService: SpinService;

beforeEach(() => {
  clock = new FixedClock();
  repository = new InMemoryPlayerSessionRepository();
  sessionService = new SessionService(repository, clock);
  walletService = new WalletService(clock);
  spinService = new SpinService(sessionService, walletService, { activeConfig: simpleConfig, nextRandom: () => 0 }, clock);
});

async function createSession(provider: string, subject: string): Promise<string> {
  const result = await sessionService.createOrResume({
    identity: { provider, subject, expiresAt: identityExpiry }
  });
  return result.response.sessionId;
}

describe("SpinService Stars wallet response (Story 8.7)", () => {
  it("surfaces withdrawableBalance equal to balanceAfter for a credited spin", async () => {
    const sessionId = await createSession("demo", "player-credits");

    const response = await spinService.spin({ clientSpinId: "spin-withdrawable", sessionId, wager });

    expect(response.payout).toBe(5);
    expect(response.balanceAfter).toBe(1004);
    expect(response.withdrawableBalance).toBe(response.balanceAfter);
  });

  it("marks currency as credits for a non-Tevi session", async () => {
    const sessionId = await createSession("demo", "player-local");

    const response = await spinService.spin({ clientSpinId: "spin-credits", sessionId, wager });

    expect(response.currency).toBe("credits");
  });

  it("marks currency as stars for a Tevi session", async () => {
    const sessionId = await createSession("tevi", "tevi-subject-1");

    const response = await spinService.spin({ clientSpinId: "spin-stars", sessionId, wager });

    expect(response.currency).toBe("stars");
    expect(response.withdrawableBalance).toBe(response.balanceAfter);
  });

  it("returns the identical committed response on a duplicate matching retry without a second debit", async () => {
    const sessionId = await createSession("tevi", "tevi-subject-retry");
    const request = { clientSpinId: "spin-duplicate", sessionId, wager };

    const first = await spinService.spin(request);
    const second = await spinService.spin(request);

    expect(second).toEqual(first);
    expect(walletService.getTransactions("player_1")).toHaveLength(2);
    expect(spinService.getLedger()).toHaveLength(1);
  });

  it("rejects a conflicting retry (same key, different wager) with a 409 and no extra ledger row", async () => {
    const sessionId = await createSession("tevi", "tevi-subject-conflict");
    await spinService.spin({ clientSpinId: "spin-conflict", sessionId, wager });

    await expect(
      spinService.spin({ clientSpinId: "spin-conflict", sessionId, wager: { lineBet: 2, selectedWays: 1, totalWager: 2 } })
    ).rejects.toMatchObject({ statusCode: 409, apiError: { code: "IDEMPOTENCY_CONFLICT" } });

    expect(spinService.getLedger()).toHaveLength(1);
    expect(walletService.getTransactions("player_1")).toHaveLength(2);
  });
});
