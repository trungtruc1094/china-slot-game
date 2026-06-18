import { calculateRtpReport } from "@china-slot-game/game-math";
import { ApiHttpError } from "../middleware/error-handler.js";
import type { GameConfigurationProvider } from "./game-configuration-repository.js";
import type { AlertStateProvider } from "./alert-repository.js";
import type { OperatorLimitsProvider } from "./operator-limits-repository.js";
import type { SpinLedgerEntry, SpinService } from "./spin-service.js";

export interface MetricsQuery {
  from?: Date;
  to?: Date;
  configVersionId?: string;
  scopeId?: string;
}

export interface OperatingMetrics {
  totalWagered: number;
  totalPaid: number;
  observedRtp: number | null;
  theoreticalRtp: number | null;
  hitRate: number | null;
  playerCount: number;
  activeSessions: number;
  jackpotLiability: number;
  remainingBudget: number | null;
  alertState: "none" | "active";
  filters: {
    from: string | null;
    to: string | null;
    configVersionId: string | null;
    scopeId: string;
  };
  bucket: {
    timezone: "UTC";
    sizeSeconds: 60;
  };
}

export class MetricsService {
  public constructor(
    private readonly spinService: SpinService,
    private readonly configProvider: GameConfigurationProvider,
    private readonly operatorLimitsProvider?: OperatorLimitsProvider,
    private readonly alertStateProvider?: AlertStateProvider
  ) {}

  public getMetrics(query: MetricsQuery = {}): OperatingMetrics {
    if (query.from && query.to && query.from.getTime() > query.to.getTime()) {
      throw new ApiHttpError(400, {
        code: "INVALID_METRICS_QUERY",
        message: "Metrics 'from' must be before or equal to 'to'.",
        details: {}
      });
    }

    const scopeId = query.scopeId ?? "default";
    const ledger = this.filterLedger(this.spinService.getLedger(), query);
    const totalWagered = ledger.reduce((total, entry) => total + entry.wager.totalWager, 0);
    const totalPaid = ledger.reduce((total, entry) => total + entry.payout, 0);
    const hitCount = ledger.filter((entry) => entry.payout > 0).length;
    const playerCount = new Set(ledger.map((entry) => entry.playerId)).size;
    const activeSessions = new Set(ledger.map((entry) => entry.sessionId)).size;
    const jackpotLiability = ledger.reduce((total, entry) => total + entry.jackpotState.awarded, 0);
    const activeLimits = this.operatorLimitsProvider?.getActiveLimits(scopeId);
    const remainingBudget = activeLimits ? activeLimits.limits.campaign.budget - totalPaid : null;
    const activeConfig = this.configProvider.getActiveConfig();
    const theoreticalRtp = activeConfig ? calculateRtpReport(activeConfig).theoreticalRtp : null;

    return {
      totalWagered,
      totalPaid,
      observedRtp: totalWagered > 0 ? totalPaid / totalWagered : null,
      theoreticalRtp,
      hitRate: ledger.length > 0 ? hitCount / ledger.length : null,
      playerCount,
      activeSessions,
      jackpotLiability,
      remainingBudget,
      alertState: this.alertStateProvider?.getAlertState(scopeId) ?? "none",
      filters: {
        from: query.from?.toISOString() ?? null,
        to: query.to?.toISOString() ?? null,
        configVersionId: query.configVersionId ?? null,
        scopeId
      },
      bucket: {
        timezone: "UTC",
        sizeSeconds: 60
      }
    };
  }

  private filterLedger(ledger: SpinLedgerEntry[], query: MetricsQuery): SpinLedgerEntry[] {
    return ledger.filter((entry) => {
      if (query.from && entry.acceptedAt.getTime() < query.from.getTime()) {
        return false;
      }
      if (query.to && entry.acceptedAt.getTime() > query.to.getTime()) {
        return false;
      }
      if (query.configVersionId && entry.configVersionId !== query.configVersionId) {
        return false;
      }
      return true;
    });
  }
}
