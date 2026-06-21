import { type AlertHistoryEventRecord, type AlertMetric, type AlertRepository, type AlertRuleRecord } from "./alert-repository.js";
import { MetricsService, type MetricsQuery, type OperatingMetrics } from "./metrics-service.js";

export class AlertService {
  public constructor(
    private readonly repository: AlertRepository,
    private readonly metricsService: MetricsService
  ) {}

  public async evaluate(query: MetricsQuery = {}): Promise<AlertHistoryEventRecord[]> {
    const metrics = this.metricsService.getMetrics(query);
    const scopeId = query.scopeId ?? "default";
    const events: AlertHistoryEventRecord[] = [];
    for (const rule of (await this.repository.listRules(scopeId)).filter((candidate) => candidate.enabled)) {
      const metricValue = valueForMetric(rule.metric, metrics);
      if (metricValue === null) {
        continue;
      }
      const evaluationKey = [
        rule.id,
        query.from?.toISOString() ?? "unbounded-start",
        query.to?.toISOString() ?? "unbounded-end",
        query.configVersionId ?? "all-configs",
        scopeId
      ].join("|");
      if (isFiring(rule, metricValue)) {
        events.push(await this.repository.appendEvent({
          ruleId: rule.id,
          scopeId,
          evaluationKey,
          status: "firing",
          metric: rule.metric,
          metricValue,
          threshold: rule.threshold,
          windowStartAt: query.from ?? null,
          windowEndAt: query.to ?? null,
          severity: rule.severity,
          suggestedAction: rule.suggestedAction,
          actor: "alert-service"
        }));
      } else if (await this.repository.hasPriorFiring(rule.id)) {
        events.push(await this.repository.appendEvent({
          ruleId: rule.id,
          scopeId,
          evaluationKey,
          status: "resolved",
          metric: rule.metric,
          metricValue,
          threshold: rule.threshold,
          windowStartAt: query.from ?? null,
          windowEndAt: query.to ?? null,
          severity: rule.severity,
          suggestedAction: rule.suggestedAction,
          actor: "alert-service"
        }));
      }
    }
    return events;
  }
}

function valueForMetric(metric: AlertMetric, metrics: OperatingMetrics): number | null {
  switch (metric) {
    case "observedRtpAbove":
    case "observedRtpBelow":
      return metrics.observedRtp;
    case "remainingBudgetBelow":
      return metrics.remainingBudget;
    case "jackpotLiabilityAbove":
      return metrics.jackpotLiability;
  }
}

function isFiring(rule: AlertRuleRecord, metricValue: number): boolean {
  switch (rule.metric) {
    case "observedRtpAbove":
    case "jackpotLiabilityAbove":
      return metricValue >= rule.threshold;
    case "observedRtpBelow":
    case "remainingBudgetBelow":
      return metricValue <= rule.threshold;
  }
}
