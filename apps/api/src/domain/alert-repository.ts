import { ApiHttpError } from "../middleware/error-handler.js";
import type { AdminAuditRepository } from "./admin-audit-repository.js";
import type { Clock } from "./session-service.js";

export type AlertMetric = "observedRtpAbove" | "observedRtpBelow" | "remainingBudgetBelow" | "jackpotLiabilityAbove";
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "firing" | "resolved" | "acknowledged";

export interface AlertRuleRecord {
  id: string;
  scopeId: string;
  metric: AlertMetric;
  threshold: number;
  severity: AlertSeverity;
  suggestedAction: string;
  enabled: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertHistoryEventRecord {
  id: string;
  ruleId: string;
  scopeId: string;
  evaluationKey: string;
  status: AlertStatus;
  metric: AlertMetric;
  metricValue: number;
  threshold: number;
  windowStartAt: Date | null;
  windowEndAt: Date | null;
  severity: AlertSeverity;
  suggestedAction: string;
  actor: string;
  reason?: string;
  createdAt: Date;
}

export interface AlertStateProvider {
  getAlertState(scopeId?: string): "none" | "active";
}

export class InMemoryAlertRepository implements AlertStateProvider {
  private readonly rules = new Map<string, AlertRuleRecord>();
  private readonly history: AlertHistoryEventRecord[] = [];

  public constructor(
    private readonly clock: Clock = { now: () => new Date() },
    private readonly adminAuditRepository?: AdminAuditRepository
  ) {}

  public upsertRule(input: Omit<AlertRuleRecord, "createdBy" | "updatedBy" | "createdAt" | "updatedAt"> & { actor: string }): AlertRuleRecord {
    const now = this.clock.now();
    const existing = this.rules.get(input.id);
    const rule: AlertRuleRecord = {
      id: input.id,
      scopeId: input.scopeId,
      metric: input.metric,
      threshold: input.threshold,
      severity: input.severity,
      suggestedAction: input.suggestedAction,
      enabled: input.enabled,
      createdBy: existing?.createdBy ?? input.actor,
      updatedBy: input.actor,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
    this.rules.set(rule.id, cloneRule(rule));
    return cloneRule(rule);
  }

  public listRules(scopeId?: string): AlertRuleRecord[] {
    return [...this.rules.values()]
      .filter((rule) => scopeId === undefined || rule.scopeId === scopeId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((rule) => cloneRule(rule));
  }

  public appendEvent(input: Omit<AlertHistoryEventRecord, "id" | "createdAt">): AlertHistoryEventRecord {
    const existing = this.history.find((event) => (
      event.ruleId === input.ruleId
      && event.evaluationKey === input.evaluationKey
      && event.status === input.status
    ));
    if (existing) {
      return cloneEvent(existing);
    }
    const event: AlertHistoryEventRecord = {
      ...input,
      id: `alert_${this.history.length + 1}`,
      createdAt: this.clock.now()
    };
    this.history.push(cloneEvent(event));
    this.adminAuditRepository?.record({
      actor: event.actor,
      role: event.actor === "alert-service" ? "system" : "operator",
      action: `alert.${event.status}`,
      resource: { type: "alert", id: event.id },
      reason: event.reason ?? null,
      source: "alerts",
      outcome: "succeeded",
      before: null,
      after: {
        ruleId: event.ruleId,
        scopeId: event.scopeId,
        status: event.status,
        metric: event.metric,
        metricValue: event.metricValue,
        threshold: event.threshold,
        severity: event.severity
      },
      metadata: {
        evaluationKey: event.evaluationKey,
        suggestedAction: event.suggestedAction,
        windowStartAt: event.windowStartAt?.toISOString() ?? null,
        windowEndAt: event.windowEndAt?.toISOString() ?? null
      }
    });
    return cloneEvent(event);
  }

  public acknowledge(alertId: string, actor: string, reason?: string): AlertHistoryEventRecord {
    const alert = this.history.find((event) => event.id === alertId && event.status === "firing");
    if (!alert) {
      throw new ApiHttpError(404, {
        code: "ALERT_NOT_FOUND",
        message: "Firing alert was not found.",
        details: { alertId }
      });
    }
    return this.appendEvent({
      ...alert,
      evaluationKey: `${alert.evaluationKey}:ack:${actor}`,
      status: "acknowledged",
      actor,
      ...(reason ? { reason } : {})
    });
  }

  public listHistory(scopeId?: string): AlertHistoryEventRecord[] {
    return this.history
      .filter((event) => scopeId === undefined || event.scopeId === scopeId)
      .map((event) => cloneEvent(event));
  }

  public hasPriorFiring(ruleId: string): boolean {
    return this.history.some((event) => event.ruleId === ruleId && event.status === "firing");
  }

  public getAlertState(scopeId = "default"): "none" | "active" {
    const latestByRule = new Map<string, AlertHistoryEventRecord>();
    for (const event of this.history.filter((candidate) => candidate.scopeId === scopeId)) {
      latestByRule.set(event.ruleId, event);
    }
    return [...latestByRule.values()].some((event) => event.status === "firing" || event.status === "acknowledged")
      ? "active"
      : "none";
  }
}

function cloneRule(rule: AlertRuleRecord): AlertRuleRecord {
  return {
    ...rule,
    createdAt: new Date(rule.createdAt),
    updatedAt: new Date(rule.updatedAt)
  };
}

function cloneEvent(event: AlertHistoryEventRecord): AlertHistoryEventRecord {
  return {
    ...event,
    windowStartAt: event.windowStartAt ? new Date(event.windowStartAt) : null,
    windowEndAt: event.windowEndAt ? new Date(event.windowEndAt) : null,
    createdAt: new Date(event.createdAt)
  };
}
