import {
  buildVisibleWindow,
  calculateWins,
  type GameConfiguration,
  type ReelStop,
  type VisibleWindow,
  type WagerInput,
  type WinBreakdown
} from "@china-slot-game/game-math";
import { ApiHttpError } from "../middleware/error-handler.js";
import type { Clock, SessionService } from "./session-service.js";
import type { WalletService, WalletTransactionRecord, WalletTransactionRequest } from "./wallet-service.js";

export interface SpinResponse {
  spinId: string;
  configVersionId: string;
  reelStops: ReelStop[];
  visibleWindow: VisibleWindow;
  wager: WagerInput;
  winBreakdown: WinBreakdown;
  payout: number;
  balanceAfter: number;
  freeSpinState: {
    awarded: number;
    remaining: number;
  };
  jackpotState: {
    awarded: number;
  };
}

export interface SpinLedgerEntry extends SpinResponse {
  sessionId: string;
  playerId: string;
  walletTransactions: WalletTransactionRecord[];
}

interface IdempotencyRecord {
  fingerprint: string;
  response: SpinResponse;
  acceptedAtMs: number;
}

const idempotencyRetryWindowMs = 24 * 60 * 60 * 1000;

export interface SpinServiceOptions {
  activeConfig?: GameConfiguration;
  nextRandom?: () => number;
  failLedgerCommit?: (response: SpinResponse) => boolean;
}

export class SpinService {
  private readonly ledger: SpinLedgerEntry[] = [];
  private readonly idempotencyRecords = new Map<string, IdempotencyRecord>();
  private nextSpinNumber = 1;

  public constructor(
    private readonly sessions: SessionService,
    private readonly wallets: WalletService,
    private readonly options: SpinServiceOptions = {},
    private readonly clock: Clock = { now: () => new Date() }
  ) {}

  public getLedger(): SpinLedgerEntry[] {
    return [...this.ledger];
  }

  public async spin(request: { clientSpinId: string; sessionId: string; wager: WagerInput }): Promise<SpinResponse> {
    const idempotencyKey = `${request.sessionId}:${request.clientSpinId}`;
    const fingerprint = this.fingerprint(request.wager);
    const existingRecord = this.idempotencyRecords.get(idempotencyKey);

    if (existingRecord) {
      if (this.clock.now().getTime() - existingRecord.acceptedAtMs > idempotencyRetryWindowMs) {
        this.idempotencyRecords.delete(idempotencyKey);
      } else {
      if (existingRecord.fingerprint !== fingerprint) {
        throw new ApiHttpError(409, {
          code: "IDEMPOTENCY_CONFLICT",
          message: "clientSpinId has already been used with different wager data.",
          details: { clientSpinId: request.clientSpinId, sessionId: request.sessionId }
        });
      }

        return existingRecord.response;
      }
    }

    const config = this.options.activeConfig;

    if (!config) {
      throw new ApiHttpError(503, {
        code: "ACTIVE_CONFIG_MISSING",
        message: "No active game configuration is available.",
        details: {}
      });
    }

    this.validateWager(config, request.wager);

    const session = this.sessions.getActiveSession(request.sessionId);
    const reelStops = this.sampleReelStops(config);
    const visibleWindow = buildVisibleWindow(config, reelStops);
    const winBreakdown = calculateWins(config, visibleWindow);
    const payout = config.payoutPolicy.useLineBetMultiplier
      ? winBreakdown.totalPay * request.wager.lineBet
      : winBreakdown.totalPay;

    const walletRequests: WalletTransactionRequest[] = [
      {
        playerId: session.playerId,
        type: "debit" as const,
        amount: request.wager.totalWager,
        actor: "spin-service",
        source: request.sessionId
      }
    ];

    if (payout > 0) {
      walletRequests.push({
        playerId: session.playerId,
        type: "credit" as const,
        amount: payout,
        actor: "spin-service",
        source: request.sessionId
      });
    }

    const spinResponse: SpinResponse = {
      spinId: `spin_${this.nextSpinNumber++}`,
      configVersionId: config.versionId,
      reelStops,
      visibleWindow,
      wager: request.wager,
      winBreakdown,
      payout,
      balanceAfter: 0,
      freeSpinState: {
        awarded: winBreakdown.totalFreeSpins,
        remaining: winBreakdown.totalFreeSpins
      },
      jackpotState: {
        awarded: winBreakdown.jackpotWins.reduce((total, win) => total + win.pay, 0)
      }
    };

    await this.wallets.applyTransactionBatch(walletRequests, {
      afterBalanceCommit: (result) => {
        spinResponse.balanceAfter = result.wallet.balance;

        if (this.options.failLedgerCommit?.(spinResponse) === true) {
          throw new Error("Injected spin ledger failure");
        }

        this.ledger.push({
          ...spinResponse,
          sessionId: request.sessionId,
          playerId: session.playerId,
          walletTransactions: result.transactions
        });
        this.idempotencyRecords.set(idempotencyKey, {
          fingerprint,
          response: spinResponse,
          acceptedAtMs: this.clock.now().getTime()
        });
      }
    });

    return spinResponse;
  }

  private validateWager(config: GameConfiguration, wager: WagerInput): void {
    if (wager.selectedWays !== config.waysPolicy.totalWays || wager.totalWager !== wager.lineBet * wager.selectedWays) {
      throw new ApiHttpError(400, {
        code: "INVALID_WAGER",
        message: "Spin wager is invalid.",
        details: { wager }
      });
    }

    if (wager.lineBet < config.limits.minBet || wager.lineBet > config.limits.maxBet) {
      throw new ApiHttpError(400, {
        code: "INVALID_WAGER",
        message: "Spin wager is outside configured limits.",
        details: { wager, limits: config.limits }
      });
    }
  }

  private sampleReelStops(config: GameConfiguration): ReelStop[] {
    const nextRandom = this.options.nextRandom ?? Math.random;
    return config.reels.map((reel) => ({
      reelIndex: reel.reelIndex,
      stopIndex: Math.floor(nextRandom() * reel.symbols.length)
    }));
  }

  private fingerprint(wager: WagerInput): string {
    return JSON.stringify({
      lineBet: wager.lineBet,
      selectedWays: wager.selectedWays,
      totalWager: wager.totalWager
    });
  }
}
