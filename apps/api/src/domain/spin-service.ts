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
import type { BudgetProtectionActionRecord, BudgetProtectionProvider } from "./budget-protection-repository.js";
import type { GameConfigurationProvider } from "./game-configuration-repository.js";
import type { OperatorLimitRecord, OperatorLimitsProvider } from "./operator-limits-repository.js";
import type { Clock, SessionService } from "./session-service.js";
import type { WalletService, WalletTransactionRecord, WalletTransactionRequest } from "./wallet-service.js";
import { getRewardModelMetadata, type RewardModelMetadata } from "./reward-boundary.js";

export interface SpinResponse {
  spinId: string;
  configVersionId: string;
  reelStops: ReelStop[];
  visibleWindow: VisibleWindow;
  wager: WagerInput;
  winBreakdown: WinBreakdown;
  payout: number;
  balanceAfter: number;
  rewardModel: RewardModelMetadata;
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
  acceptedAt: Date;
}

interface IdempotencyRecord {
  fingerprint: string;
  response: SpinResponse;
  acceptedAtMs: number;
}

const idempotencyRetryWindowMs = 24 * 60 * 60 * 1000;

export interface SpinServiceOptions {
  activeConfig?: GameConfiguration;
  configProvider?: GameConfigurationProvider;
  operatorLimitsProvider?: OperatorLimitsProvider;
  operatorLimitsScopeId?: string;
  budgetProtectionProvider?: BudgetProtectionProvider;
  budgetProtectionEnabled?: boolean;
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

  public async spin(request: { clientSpinId: string; sessionId: string; wager: WagerInput; correlationId?: string }): Promise<SpinResponse> {
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

    const config = this.options.configProvider?.getActiveConfig() ?? this.options.activeConfig;

    if (!config) {
      throw new ApiHttpError(503, {
        code: "ACTIVE_CONFIG_MISSING",
        message: "No active game configuration is available.",
        details: {}
      });
    }

    this.validateWager(config, request.wager);

    const session = this.sessions.getActiveSession(request.sessionId);
    this.validateBudgetProtection(request.wager);
    const activeLimits = this.options.operatorLimitsProvider?.getActiveLimits(this.options.operatorLimitsScopeId ?? "default");
    if (activeLimits) {
      this.validateOperatorLimits(activeLimits, session.playerId, request.sessionId, request.wager);
    }
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
        source: request.sessionId,
        metadata: { clientSpinId: request.clientSpinId, correlationId: request.correlationId ?? null }
      }
    ];

    if (payout > 0) {
      walletRequests.push({
        playerId: session.playerId,
        type: "credit" as const,
        amount: payout,
        actor: "spin-service",
        source: request.sessionId,
        metadata: { clientSpinId: request.clientSpinId, correlationId: request.correlationId ?? null }
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
      rewardModel: getRewardModelMetadata(),
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

        for (const transaction of result.transactions) {
          transaction.metadata = {
            ...transaction.metadata,
            spinId: spinResponse.spinId,
            correlationId: request.correlationId ?? null
          };
        }

        this.ledger.push({
          ...spinResponse,
          sessionId: request.sessionId,
          playerId: session.playerId,
          walletTransactions: result.transactions,
          acceptedAt: this.clock.now()
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

  private validateOperatorLimits(
    activeLimits: OperatorLimitRecord,
    playerId: string,
    sessionId: string,
    wager: WagerInput
  ): void {
    const limits = activeLimits.limits;
    if (wager.lineBet < limits.perSpin.minBet) {
      throw limitExceeded(activeLimits.scopeId, "perSpin.minBet", wager.lineBet, wager.lineBet, limits.perSpin.minBet);
    }
    if (wager.lineBet > limits.perSpin.maxBet) {
      throw limitExceeded(activeLimits.scopeId, "perSpin.maxBet", wager.lineBet, wager.lineBet, limits.perSpin.maxBet);
    }
    if (limits.perSpin.maxPayout > limits.campaign.budget) {
      throw limitExceeded(activeLimits.scopeId, "campaign.budget", this.totalPaid(), limits.perSpin.maxPayout, limits.campaign.budget);
    }

    const sessionLedger = this.ledger.filter((entry) => entry.sessionId === sessionId);
    if (sessionLedger.length + 1 > limits.perSession.maxSpins) {
      throw limitExceeded(activeLimits.scopeId, "perSession.maxSpins", sessionLedger.length, 1, limits.perSession.maxSpins);
    }
    const sessionWagered = sessionLedger.reduce((total, entry) => total + entry.wager.totalWager, 0);
    if (sessionWagered + wager.totalWager > limits.perSession.maxWager) {
      throw limitExceeded(activeLimits.scopeId, "perSession.maxWager", sessionWagered, wager.totalWager, limits.perSession.maxWager);
    }

    const playerLedger = this.ledger.filter((entry) => entry.playerId === playerId);
    const playerWagered = playerLedger.reduce((total, entry) => total + entry.wager.totalWager, 0);
    if (playerWagered + wager.totalWager > limits.perDay.playerMaxWager) {
      throw limitExceeded(activeLimits.scopeId, "perDay.playerMaxWager", playerWagered, wager.totalWager, limits.perDay.playerMaxWager);
    }
    const playerPaid = playerLedger.reduce((total, entry) => total + entry.payout, 0);
    if (playerPaid + limits.perSpin.maxPayout > limits.perDay.playerMaxReward) {
      throw limitExceeded(activeLimits.scopeId, "perDay.playerMaxReward", playerPaid, limits.perSpin.maxPayout, limits.perDay.playerMaxReward);
    }

    const campaignPaid = this.totalPaid();
    if (campaignPaid + limits.perSpin.maxPayout > limits.campaign.budget) {
      throw limitExceeded(activeLimits.scopeId, "campaign.budget", campaignPaid, limits.perSpin.maxPayout, limits.campaign.budget);
    }
    const jackpotAwarded = this.ledger.reduce((total, entry) => total + entry.jackpotState.awarded, 0);
    if (jackpotAwarded + limits.perSpin.maxPayout > limits.campaign.jackpotCap) {
      throw limitExceeded(activeLimits.scopeId, "campaign.jackpotCap", jackpotAwarded, limits.perSpin.maxPayout, limits.campaign.jackpotCap);
    }
  }

  private validateBudgetProtection(wager: WagerInput): void {
    if (this.options.budgetProtectionEnabled === false) {
      return;
    }
    const scopeId = this.options.operatorLimitsScopeId ?? "default";
    const activeActions = this.options.budgetProtectionProvider?.listActiveActions(scopeId) ?? [];
    for (const action of activeActions) {
      if (action.action === "pauseCampaign") {
        throw budgetProtectionActive(action, "Campaign is paused.");
      }
      if (action.action === "requireHostApproval") {
        throw budgetProtectionActive(action, "Host approval is required before play can continue.");
      }
      if (action.action === "disablePaidSpins" && wager.totalWager > 0) {
        throw budgetProtectionActive(action, "Paid spins are disabled.");
      }
      if (action.action === "lowerMaxBet") {
        const maxBet = action.parameters.maxBet;
        if (typeof maxBet === "number" && Number.isSafeInteger(maxBet) && wager.lineBet > maxBet) {
          throw budgetProtectionActive(action, `Maximum bet is temporarily limited to ${maxBet}.`);
        }
      }
    }
  }

  private totalPaid(): number {
    return this.ledger.reduce((total, entry) => total + entry.payout, 0);
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

function limitExceeded(
  scopeId: string,
  limit: string,
  current: number,
  attempted: number,
  maximum: number
): ApiHttpError {
  return new ApiHttpError(409, {
    code: "OPERATOR_LIMIT_EXCEEDED",
    message: "Spin violates active operator limits.",
    details: {
      scopeId,
      limit,
      current,
      attempted,
      maximum
    }
  });
}

function budgetProtectionActive(action: BudgetProtectionActionRecord, message: string): ApiHttpError {
  return new ApiHttpError(409, {
    code: "BUDGET_PROTECTION_ACTIVE",
    message,
    details: {
      scopeId: action.scopeId,
      action: action.action,
      message
    }
  });
}
