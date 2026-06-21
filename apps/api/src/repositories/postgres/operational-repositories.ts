import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { withTransaction } from "../../db/transactions.js";
import type {
  AdminAuditEventInput,
  AdminAuditEventRecord,
  AdminAuditRepository,
  AdminAuditRole,
  AdminAuditSource,
  AdminAuditOutcome
} from "../../domain/admin-audit-repository.js";
import type {
  AlertHistoryEventRecord,
  AlertMetric,
  AlertRepository,
  AlertRuleRecord,
  AlertSeverity,
  AlertStatus
} from "../../domain/alert-repository.js";
import type {
  BudgetProtectionActionRecord,
  BudgetProtectionActionType,
  BudgetProtectionAuditAction,
  BudgetProtectionAuditEventRecord,
  BudgetProtectionRepository,
  BudgetProtectionStatus
} from "../../domain/budget-protection-repository.js";
import type {
  OperatorLimitAuditAction,
  OperatorLimitAuditEventRecord,
  OperatorLimitRecord,
  OperatorLimits,
  OperatorLimitsRepository,
  OperatorLimitStatus,
  OperatorLimitInput
} from "../../domain/operator-limits-repository.js";
import type { RequestTraceRecord, RequestTraceRepository, RequestTraceOutcome } from "../../domain/request-trace-repository.js";
import type { Clock } from "../../domain/session-service.js";
import { ApiHttpError } from "../../middleware/error-handler.js";

interface OperatorLimitRow {
  id: string;
  scope_id: string;
  version: number;
  status: OperatorLimitStatus;
  currency: string;
  per_spin_min_bet_minor: number;
  per_spin_max_bet_minor: number;
  per_spin_max_payout_minor: number;
  per_session_max_spins: number;
  per_session_max_wager_minor: number;
  per_day_player_max_wager_minor: number;
  per_day_player_max_reward_minor: number;
  campaign_budget_minor: number;
  campaign_jackpot_cap_minor: number;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

interface AdminAuditRow {
  id: string;
  action: string;
  target_id: string;
  actor: string;
  reason: string | null;
  metadata_json: Record<string, unknown>;
  created_at: Date;
  role: AdminAuditRole;
  resource_type: string;
  resource_id: string;
  request_id: string | null;
  source: AdminAuditSource;
  outcome: AdminAuditOutcome;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
}

interface BudgetProtectionActionRow {
  id: string;
  scope_id: string;
  action_type: BudgetProtectionActionType;
  status: BudgetProtectionStatus;
  parameters_json: Record<string, unknown>;
  metric_state_json: Record<string, unknown>;
  actor: string;
  reason: string;
  created_at: Date;
  reverted_by: string | null;
  reverted_reason: string | null;
  reverted_at: Date | null;
}

interface BudgetProtectionAuditRow {
  id: string;
  action: BudgetProtectionAuditAction;
  target_id: string;
  actor: string;
  reason: string;
  metadata_json: Record<string, unknown>;
  created_at: Date;
}

interface AlertRuleRow {
  id: string;
  scope_id: string;
  metric: AlertMetric;
  threshold: string;
  severity: AlertSeverity;
  suggested_action: string;
  enabled: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

interface AlertHistoryRow {
  id: string;
  rule_id: string;
  scope_id: string;
  evaluation_key: string;
  status: AlertStatus;
  metric: AlertMetric;
  metric_value: string;
  threshold: string;
  window_start_at: Date | null;
  window_end_at: Date | null;
  severity: AlertSeverity;
  suggested_action: string;
  actor: string;
  reason: string | null;
  created_at: Date;
}

interface RequestTraceRow {
  request_id: string;
  correlation_id: string | null;
  method: string;
  path: string;
  status_code: number;
  latency_ms: number;
  outcome: RequestTraceOutcome;
  error_code: string | null;
  player_id: string | null;
  session_id: string | null;
  spin_id: string | null;
  admin_actor: string | null;
  occurred_at: Date;
}

export class PostgresAdminAuditRepository implements AdminAuditRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly clock: Clock = { now: () => new Date() }
  ) {}

  public async record(input: AdminAuditEventInput): Promise<AdminAuditEventRecord> {
    const event: AdminAuditEventRecord = {
      id: `admin_audit_${randomUUID()}`,
      occurredAt: this.clock.now(),
      actor: input.actor,
      role: input.role,
      action: input.action,
      resource: { ...input.resource },
      requestId: input.requestId ?? null,
      reason: input.reason ?? null,
      source: input.source,
      outcome: input.outcome,
      before: cloneOrNull(input.before ?? null),
      after: cloneOrNull(input.after ?? null),
      metadata: cloneJson(input.metadata ?? {})
    };
    await this.pool.query(
      `INSERT INTO admin_audit_events (
         id, action, target_id, actor, reason, metadata_json, created_at, role, resource_type, resource_id,
         request_id, source, outcome, before_json, after_json
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        event.id,
        event.action,
        event.resource.id,
        event.actor,
        event.reason,
        jsonParam(event.metadata),
        event.occurredAt,
        event.role,
        event.resource.type,
        event.resource.id,
        event.requestId,
        event.source,
        event.outcome,
        jsonParam(event.before),
        jsonParam(event.after)
      ]
    );
    return cloneAuditEvent(event);
  }

  public async list(): Promise<AdminAuditEventRecord[]> {
    const result = await this.pool.query<AdminAuditRow>(
      `SELECT id, action, target_id, actor, reason, metadata_json, created_at, role, resource_type, resource_id,
              request_id, source, outcome, before_json, after_json
       FROM admin_audit_events
       ORDER BY created_at ASC, id ASC`
    );
    return result.rows.map(rowToAdminAuditEvent);
  }
}

export class PostgresOperatorLimitsRepository implements OperatorLimitsRepository {
  private readonly activeCache = new Map<string, OperatorLimitRecord>();

  public constructor(
    private readonly pool: Pool,
    private readonly clock: Clock = { now: () => new Date() },
    private readonly adminAuditRepository?: AdminAuditRepository
  ) {}

  public async load(): Promise<void> {
    const records = await this.list();
    this.activeCache.clear();
    for (const record of records) {
      if (record.status === "active") {
        this.activeCache.set(record.scopeId, cloneOperatorLimit(record));
      }
    }
  }

  public async create(input: OperatorLimitInput): Promise<OperatorLimitRecord> {
    this.validateLimits(input.limits);
    return withTransaction(this.pool, async (client) => {
      const existing = await client.query<OperatorLimitRow>(
        `SELECT ${operatorLimitColumns()} FROM operator_limits WHERE scope_id = $1 AND status = 'active'`,
        [input.scopeId]
      );
      if (existing.rows.length > 0) {
        throw new ApiHttpError(409, {
          code: "OPERATOR_LIMITS_CONFLICT",
          message: "Active operator limits already exist for this scope.",
          details: { scopeId: input.scopeId }
        });
      }
      const now = this.clock.now();
      const result = await client.query<OperatorLimitRow>(
        `INSERT INTO operator_limits (
           id, scope_id, version, status, currency, per_spin_min_bet_minor, per_spin_max_bet_minor,
           per_spin_max_payout_minor, per_session_max_spins, per_session_max_wager_minor,
           per_day_player_max_wager_minor, per_day_player_max_reward_minor, campaign_budget_minor,
           campaign_jackpot_cap_minor, created_by, updated_by, created_at, updated_at
         ) VALUES ($1, $2, 1, 'active', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $14, $14)
         RETURNING ${operatorLimitColumns()}`,
        operatorLimitInsertValues(`${input.scopeId}-limits-v1`, input.scopeId, input.limits, input.actor, now)
      );
      const record = rowToOperatorLimit(requireRow(result.rows[0], "operator limit"));
      await this.recordOperatorAudit("operator_limits.create", record, input.actor, input.reason, {
        version: record.version,
        previousActiveVersion: null
      }, null);
      this.activeCache.set(record.scopeId, cloneOperatorLimit(record));
      return record;
    });
  }

  public async update(input: OperatorLimitInput): Promise<OperatorLimitRecord> {
    this.validateLimits(input.limits);
    return withTransaction(this.pool, async (client) => {
      const activeResult = await client.query<OperatorLimitRow>(
        `SELECT ${operatorLimitColumns()} FROM operator_limits WHERE scope_id = $1 AND status = 'active' FOR UPDATE`,
        [input.scopeId]
      );
      const active = activeResult.rows[0];
      if (!active) {
        throw new ApiHttpError(404, {
          code: "OPERATOR_LIMITS_NOT_FOUND",
          message: "Active operator limits were not found for this scope.",
          details: { scopeId: input.scopeId }
        });
      }
      const previous = rowToOperatorLimit(active);
      const now = this.clock.now();
      await client.query(
        `UPDATE operator_limits SET status = 'retired', updated_by = $2, updated_at = $3 WHERE id = $1`,
        [previous.id, input.actor, now]
      );
      const nextVersion = previous.version + 1;
      const result = await client.query<OperatorLimitRow>(
        `INSERT INTO operator_limits (
           id, scope_id, version, status, currency, per_spin_min_bet_minor, per_spin_max_bet_minor,
           per_spin_max_payout_minor, per_session_max_spins, per_session_max_wager_minor,
           per_day_player_max_wager_minor, per_day_player_max_reward_minor, campaign_budget_minor,
           campaign_jackpot_cap_minor, created_by, updated_by, created_at, updated_at
         ) VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $15, $15)
         RETURNING ${operatorLimitColumns()}`,
        [`${input.scopeId}-limits-v${nextVersion}`, input.scopeId, nextVersion, input.limits.currency,
          input.limits.perSpin.minBet, input.limits.perSpin.maxBet, input.limits.perSpin.maxPayout,
          input.limits.perSession.maxSpins, input.limits.perSession.maxWager,
          input.limits.perDay.playerMaxWager, input.limits.perDay.playerMaxReward,
          input.limits.campaign.budget, input.limits.campaign.jackpotCap, input.actor, now]
      );
      const record = rowToOperatorLimit(requireRow(result.rows[0], "operator limit"));
      await this.recordOperatorAudit("operator_limits.update", record, input.actor, input.reason, {
        version: record.version,
        previousActiveVersion: previous.version,
        previousActiveId: previous.id
      }, { id: previous.id, version: previous.version, limits: previous.limits });
      this.activeCache.set(record.scopeId, cloneOperatorLimit(record));
      return record;
    });
  }

  public getActiveLimits(scopeId = "default"): OperatorLimitRecord | undefined {
    const record = this.activeCache.get(scopeId);
    return record ? cloneOperatorLimit(record) : undefined;
  }

  public async list(scopeId?: string): Promise<OperatorLimitRecord[]> {
    const values: unknown[] = [];
    const whereClause = scopeId ? "WHERE scope_id = $1" : "";
    if (scopeId) {
      values.push(scopeId);
    }
    const result = await this.pool.query<OperatorLimitRow>(
      `SELECT ${operatorLimitColumns()} FROM operator_limits ${whereClause} ORDER BY created_at, version`,
      values
    );
    return result.rows.map(rowToOperatorLimit);
  }

  public async listAuditEvents(): Promise<OperatorLimitAuditEventRecord[]> {
    const result = await this.pool.query<AdminAuditRow>(
      `SELECT id, action, target_id, actor, reason, metadata_json, created_at, role, resource_type, resource_id,
              request_id, source, outcome, before_json, after_json
       FROM admin_audit_events
       WHERE source = 'operator-limits'
       ORDER BY created_at, id`
    );
    return result.rows.map((row): OperatorLimitAuditEventRecord => ({
      id: row.id,
      action: row.action as OperatorLimitAuditAction,
      targetId: row.target_id,
      actor: row.actor,
      metadata: cloneJson(row.metadata_json),
      createdAt: new Date(row.created_at),
      ...(row.reason ? { reason: row.reason } : {})
    }));
  }

  private validateLimits(limits: OperatorLimits): void {
    if (limits.perSpin.minBet > limits.perSpin.maxBet) {
      throw invalidOperatorLimits("perSpin.minBet must be less than or equal to perSpin.maxBet.");
    }
    if (limits.perSpin.maxPayout > limits.campaign.jackpotCap) {
      throw invalidOperatorLimits("perSpin.maxPayout cannot exceed campaign.jackpotCap.");
    }
    if (limits.perSpin.maxBet > limits.perSession.maxWager) {
      throw invalidOperatorLimits("perSpin.maxBet cannot exceed perSession.maxWager.");
    }
    if (limits.perSpin.maxBet > limits.perDay.playerMaxWager) {
      throw invalidOperatorLimits("perSpin.maxBet cannot exceed perDay.playerMaxWager.");
    }
    if (limits.perSpin.maxBet > limits.campaign.budget) {
      throw invalidOperatorLimits("perSpin.maxBet cannot exceed campaign.budget.");
    }
    if (limits.perDay.playerMaxReward > limits.campaign.budget) {
      throw invalidOperatorLimits("perDay.playerMaxReward cannot exceed campaign.budget.");
    }
    if (limits.campaign.jackpotCap > limits.campaign.budget) {
      throw invalidOperatorLimits("campaign.jackpotCap cannot exceed campaign.budget.");
    }
  }

  private async recordOperatorAudit(
    action: OperatorLimitAuditAction,
    record: OperatorLimitRecord,
    actor: string,
    reason: string | undefined,
    metadata: Record<string, unknown>,
    before: Record<string, unknown> | null
  ): Promise<void> {
    await this.adminAuditRepository?.record({
      actor,
      role: "operator",
      action,
      resource: { type: "operator_limits", id: record.id },
      reason: reason ?? null,
      source: "operator-limits",
      outcome: "succeeded",
      before,
      after: { id: record.id, scopeId: record.scopeId, version: record.version, status: record.status, limits: record.limits },
      metadata
    });
  }
}

export class PostgresBudgetProtectionRepository implements BudgetProtectionRepository {
  private readonly activeCache = new Map<string, BudgetProtectionActionRecord[]>();

  public constructor(
    private readonly pool: Pool,
    private readonly clock: Clock = { now: () => new Date() },
    private readonly adminAuditRepository?: AdminAuditRepository
  ) {}

  public async load(): Promise<void> {
    const actions = await this.list();
    this.activeCache.clear();
    for (const action of actions.filter((candidate) => candidate.status === "active")) {
      const existing = this.activeCache.get(action.scopeId) ?? [];
      existing.push(cloneBudgetAction(action));
      this.activeCache.set(action.scopeId, existing);
    }
  }

  public async apply(input: Parameters<BudgetProtectionRepository["apply"]>[0]): Promise<BudgetProtectionActionRecord> {
    const now = this.clock.now();
    const action: BudgetProtectionActionRecord = {
      id: `budget_protection_${randomUUID()}`,
      scopeId: input.scopeId,
      action: input.action,
      status: "active",
      parameters: cloneJson(input.parameters ?? {}),
      metricState: cloneJson(input.metricState ?? {}),
      actor: input.actor,
      reason: input.reason,
      createdAt: now
    };
    await this.pool.query(
      `INSERT INTO budget_protection_actions (
         id, scope_id, action_type, status, parameters_json, metric_state_json, actor, reason, created_at
       ) VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8)`,
      [action.id, action.scopeId, action.action, jsonParam(action.parameters), jsonParam(action.metricState), action.actor, action.reason, now]
    );
    await this.recordBudgetAudit("budget_protection.apply", action, input.actor, input.reason, {
      scopeId: action.scopeId,
      action: action.action,
      parameters: action.parameters,
      metricState: action.metricState
    });
    await this.adminAuditRepository?.record({
      actor: input.actor,
      role: "operator",
      action: "budget_protection.apply",
      resource: { type: "budget_protection_action", id: action.id },
      reason: input.reason,
      source: "budget-protection",
      outcome: "succeeded",
      before: null,
      after: { scopeId: action.scopeId, action: action.action, status: action.status, parameters: action.parameters, metricState: action.metricState },
      metadata: { scopeId: action.scopeId, action: action.action }
    });
    this.addActiveAction(action);
    return cloneBudgetAction(action);
  }

  public async revert(id: string, actor: string, reason: string): Promise<BudgetProtectionActionRecord> {
    const result = await this.pool.query<BudgetProtectionActionRow>(
      `SELECT ${budgetActionColumns()} FROM budget_protection_actions WHERE id = $1`,
      [id]
    );
    const existing = result.rows[0];
    if (!existing) {
      throw new ApiHttpError(404, { code: "BUDGET_PROTECTION_NOT_FOUND", message: "Budget protection action was not found.", details: { id } });
    }
    if (existing.status === "reverted") {
      return rowToBudgetAction(existing);
    }
    const now = this.clock.now();
    const updateResult = await this.pool.query<BudgetProtectionActionRow>(
      `UPDATE budget_protection_actions
       SET status = 'reverted', reverted_by = $2, reverted_reason = $3, reverted_at = $4
       WHERE id = $1
       RETURNING ${budgetActionColumns()}`,
      [id, actor, reason, now]
    );
    const action = rowToBudgetAction(requireRow(updateResult.rows[0], "budget action"));
    await this.recordBudgetAudit("budget_protection.revert", action, actor, reason, { scopeId: action.scopeId, action: action.action });
    await this.adminAuditRepository?.record({
      actor,
      role: "operator",
      action: "budget_protection.revert",
      resource: { type: "budget_protection_action", id: action.id },
      reason,
      source: "budget-protection",
      outcome: "succeeded",
      before: { status: "active", action: action.action, scopeId: action.scopeId },
      after: { status: action.status, action: action.action, scopeId: action.scopeId, revertedBy: action.revertedBy ?? null },
      metadata: { scopeId: action.scopeId, action: action.action }
    });
    this.removeActiveAction(action);
    return action;
  }

  public async list(scopeId?: string): Promise<BudgetProtectionActionRecord[]> {
    const values: unknown[] = [];
    const whereClause = scopeId ? "WHERE scope_id = $1" : "";
    if (scopeId) {
      values.push(scopeId);
    }
    const result = await this.pool.query<BudgetProtectionActionRow>(
      `SELECT ${budgetActionColumns()} FROM budget_protection_actions ${whereClause} ORDER BY created_at`,
      values
    );
    return result.rows.map(rowToBudgetAction);
  }

  public listActiveActions(scopeId = "default"): BudgetProtectionActionRecord[] {
    return (this.activeCache.get(scopeId) ?? []).map(cloneBudgetAction);
  }

  private addActiveAction(action: BudgetProtectionActionRecord): void {
    const existing = this.activeCache.get(action.scopeId) ?? [];
    this.activeCache.set(action.scopeId, [...existing.filter((candidate) => candidate.id !== action.id), cloneBudgetAction(action)]);
  }

  private removeActiveAction(action: BudgetProtectionActionRecord): void {
    const remaining = (this.activeCache.get(action.scopeId) ?? []).filter((candidate) => candidate.id !== action.id);
    if (remaining.length > 0) {
      this.activeCache.set(action.scopeId, remaining);
      return;
    }
    this.activeCache.delete(action.scopeId);
  }

  public async listAuditEvents(): Promise<BudgetProtectionAuditEventRecord[]> {
    const result = await this.pool.query<BudgetProtectionAuditRow>(
      `SELECT id, action, target_id, actor, reason, metadata_json, created_at
       FROM budget_protection_audit_events
       ORDER BY created_at, id`
    );
    return result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      targetId: row.target_id,
      actor: row.actor,
      reason: row.reason,
      metadata: cloneJson(row.metadata_json),
      createdAt: new Date(row.created_at)
    }));
  }

  private async recordBudgetAudit(
    action: BudgetProtectionAuditAction,
    target: BudgetProtectionActionRecord,
    actor: string,
    reason: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO budget_protection_audit_events (id, action, target_id, actor, reason, metadata_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [`budget_protection_audit_${randomUUID()}`, action, target.id, actor, reason, jsonParam(metadata), this.clock.now()]
    );
  }
}

export class PostgresAlertRepository implements AlertRepository {
  private readonly stateCache = new Map<string, "none" | "active">();

  public constructor(
    private readonly pool: Pool,
    private readonly clock: Clock = { now: () => new Date() },
    private readonly adminAuditRepository?: AdminAuditRepository
  ) {}

  public async load(): Promise<void> {
    const histories = await this.listHistory();
    this.stateCache.clear();
    for (const scopeId of new Set(histories.map((history) => history.scopeId))) {
      this.stateCache.set(scopeId, stateFromHistory(histories.filter((history) => history.scopeId === scopeId)));
    }
  }

  public async upsertRule(input: Omit<AlertRuleRecord, "createdBy" | "updatedBy" | "createdAt" | "updatedAt"> & { actor: string }): Promise<AlertRuleRecord> {
    const existing = await this.pool.query<AlertRuleRow>(`SELECT ${alertRuleColumns()} FROM alert_rules WHERE id = $1`, [input.id]);
    const now = this.clock.now();
    const result = await this.pool.query<AlertRuleRow>(
      `INSERT INTO alert_rules (id, scope_id, metric, threshold, severity, suggested_action, enabled, created_by, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $9)
       ON CONFLICT (id) DO UPDATE SET
         scope_id = EXCLUDED.scope_id,
         metric = EXCLUDED.metric,
         threshold = EXCLUDED.threshold,
         severity = EXCLUDED.severity,
         suggested_action = EXCLUDED.suggested_action,
         enabled = EXCLUDED.enabled,
         updated_by = EXCLUDED.updated_by,
         updated_at = EXCLUDED.updated_at
       RETURNING ${alertRuleColumns()}`,
      [input.id, input.scopeId, input.metric, input.threshold, input.severity, input.suggestedAction, input.enabled, input.actor, now]
    );
    const rule = rowToAlertRule(requireRow(result.rows[0], "alert rule"));
    if (!existing.rows[0]) {
      await this.adminAuditRepository?.record({
        actor: input.actor,
        role: "operator",
        action: "alert.rule.upsert",
        resource: { type: "alert_rule", id: rule.id },
        source: "alerts",
        outcome: "succeeded",
        before: null,
        after: { rule },
        metadata: { scopeId: rule.scopeId, metric: rule.metric }
      });
    }
    return rule;
  }

  public async listRules(scopeId?: string): Promise<AlertRuleRecord[]> {
    const values: unknown[] = [];
    const whereClause = scopeId ? "WHERE scope_id = $1" : "";
    if (scopeId) {
      values.push(scopeId);
    }
    const result = await this.pool.query<AlertRuleRow>(
      `SELECT ${alertRuleColumns()} FROM alert_rules ${whereClause} ORDER BY created_at`,
      values
    );
    return result.rows.map(rowToAlertRule);
  }

  public async appendEvent(input: Omit<AlertHistoryEventRecord, "id" | "createdAt">): Promise<AlertHistoryEventRecord> {
    const now = this.clock.now();
    const result = await this.pool.query<AlertHistoryRow>(
      `INSERT INTO alert_history (
         id, rule_id, scope_id, evaluation_key, status, metric, metric_value, threshold, window_start_at,
         window_end_at, severity, suggested_action, actor, reason, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (rule_id, evaluation_key, status) DO UPDATE SET id = alert_history.id
       RETURNING ${alertHistoryColumns()}`,
      [`alert_${randomUUID()}`, input.ruleId, input.scopeId, input.evaluationKey, input.status, input.metric,
        input.metricValue, input.threshold, input.windowStartAt, input.windowEndAt, input.severity,
        input.suggestedAction, input.actor, input.reason ?? null, now]
    );
    const event = rowToAlertHistory(requireRow(result.rows[0], "alert history"));
    await this.adminAuditRepository?.record({
      actor: event.actor,
      role: event.actor === "alert-service" ? "system" : "operator",
      action: `alert.${event.status}`,
      resource: { type: "alert", id: event.id },
      reason: event.reason ?? null,
      source: "alerts",
      outcome: "succeeded",
      before: null,
      after: { ruleId: event.ruleId, scopeId: event.scopeId, status: event.status, metric: event.metric, metricValue: event.metricValue, threshold: event.threshold, severity: event.severity },
      metadata: { evaluationKey: event.evaluationKey, suggestedAction: event.suggestedAction, windowStartAt: event.windowStartAt?.toISOString() ?? null, windowEndAt: event.windowEndAt?.toISOString() ?? null }
    });
    this.stateCache.set(event.scopeId, event.status === "firing" || event.status === "acknowledged" ? "active" : this.getAlertState(event.scopeId));
    return event;
  }

  public async acknowledge(alertId: string, actor: string, reason?: string): Promise<AlertHistoryEventRecord> {
    const result = await this.pool.query<AlertHistoryRow>(
      `SELECT ${alertHistoryColumns()} FROM alert_history WHERE id = $1 AND status = 'firing'`,
      [alertId]
    );
    const alert = result.rows[0];
    if (!alert) {
      throw new ApiHttpError(404, { code: "ALERT_NOT_FOUND", message: "Firing alert was not found.", details: { alertId } });
    }
    const record = rowToAlertHistory(alert);
    return this.appendEvent({
      ...record,
      evaluationKey: `${record.evaluationKey}:ack:${actor}`,
      status: "acknowledged",
      actor,
      ...(reason ? { reason } : {})
    });
  }

  public async listHistory(scopeId?: string): Promise<AlertHistoryEventRecord[]> {
    const values: unknown[] = [];
    const whereClause = scopeId ? "WHERE scope_id = $1" : "";
    if (scopeId) {
      values.push(scopeId);
    }
    const result = await this.pool.query<AlertHistoryRow>(
      `SELECT ${alertHistoryColumns()} FROM alert_history ${whereClause} ORDER BY created_at, id`,
      values
    );
    return result.rows.map(rowToAlertHistory);
  }

  public async hasPriorFiring(ruleId: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM alert_history WHERE rule_id = $1 AND status = 'firing') AS exists`,
      [ruleId]
    );
    return result.rows[0]?.exists ?? false;
  }

  public getAlertState(scopeId = "default"): "none" | "active" {
    return this.stateCache.get(scopeId) ?? "none";
  }
}

export class PostgresRequestTraceRepository implements RequestTraceRepository {
  public constructor(private readonly pool: Pool) {}

  public async record(trace: RequestTraceRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO request_traces (
         id, request_id, correlation_id, method, path, status_code, latency_ms, outcome, error_code,
         player_id, session_id, spin_id, admin_actor, metadata_json, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, '{}', $14)`,
      [`request_trace_${randomUUID()}`, trace.requestId, trace.correlationId, trace.method, trace.path,
        trace.statusCode, trace.latencyMs, trace.outcome, trace.errorCode ?? null, trace.playerId ?? null,
        trace.sessionId ?? null, trace.spinId ?? null, trace.adminActor ?? null, new Date(trace.occurredAt)]
    );
  }

  public async list(): Promise<RequestTraceRecord[]> {
    const result = await this.pool.query<RequestTraceRow>(
      `SELECT request_id, correlation_id, method, path, status_code, latency_ms, outcome, error_code,
              player_id, session_id, spin_id, admin_actor, occurred_at
       FROM request_traces
       ORDER BY occurred_at, request_id`
    );
    return result.rows.map(rowToRequestTrace);
  }
}

function operatorLimitColumns(): string {
  return `id, scope_id, version, status, currency, per_spin_min_bet_minor, per_spin_max_bet_minor,
          per_spin_max_payout_minor, per_session_max_spins, per_session_max_wager_minor,
          per_day_player_max_wager_minor, per_day_player_max_reward_minor, campaign_budget_minor,
          campaign_jackpot_cap_minor, created_by, updated_by, created_at, updated_at`;
}

function operatorLimitInsertValues(id: string, scopeId: string, limits: OperatorLimits, actor: string, now: Date): unknown[] {
  return [id, scopeId, limits.currency, limits.perSpin.minBet, limits.perSpin.maxBet, limits.perSpin.maxPayout,
    limits.perSession.maxSpins, limits.perSession.maxWager, limits.perDay.playerMaxWager,
    limits.perDay.playerMaxReward, limits.campaign.budget, limits.campaign.jackpotCap, actor, now];
}

function budgetActionColumns(): string {
  return `id, scope_id, action_type, status, parameters_json, metric_state_json, actor, reason, created_at,
          reverted_by, reverted_reason, reverted_at`;
}

function alertRuleColumns(): string {
  return `id, scope_id, metric, threshold, severity, suggested_action, enabled, created_by, updated_by, created_at, updated_at`;
}

function alertHistoryColumns(): string {
  return `id, rule_id, scope_id, evaluation_key, status, metric, metric_value, threshold, window_start_at,
          window_end_at, severity, suggested_action, actor, reason, created_at`;
}

function rowToOperatorLimit(row: OperatorLimitRow): OperatorLimitRecord {
  return {
    id: row.id,
    scopeId: row.scope_id,
    version: row.version,
    status: row.status,
    limits: {
      currency: row.currency,
      perSpin: { minBet: row.per_spin_min_bet_minor, maxBet: row.per_spin_max_bet_minor, maxPayout: row.per_spin_max_payout_minor },
      perSession: { maxSpins: row.per_session_max_spins, maxWager: row.per_session_max_wager_minor },
      perDay: { playerMaxWager: row.per_day_player_max_wager_minor, playerMaxReward: row.per_day_player_max_reward_minor },
      campaign: { budget: row.campaign_budget_minor, jackpotCap: row.campaign_jackpot_cap_minor }
    },
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function rowToAdminAuditEvent(row: AdminAuditRow): AdminAuditEventRecord {
  return {
    id: row.id,
    occurredAt: new Date(row.created_at),
    actor: row.actor,
    role: row.role,
    action: row.action,
    resource: { type: row.resource_type, id: row.resource_id },
    requestId: row.request_id,
    reason: row.reason,
    source: row.source,
    outcome: row.outcome,
    before: cloneOrNull(row.before_json),
    after: cloneOrNull(row.after_json),
    metadata: cloneJson(row.metadata_json)
  };
}

function rowToBudgetAction(row: BudgetProtectionActionRow): BudgetProtectionActionRecord {
  return {
    id: row.id,
    scopeId: row.scope_id,
    action: row.action_type,
    status: row.status,
    parameters: cloneJson(row.parameters_json),
    metricState: cloneJson(row.metric_state_json),
    actor: row.actor,
    reason: row.reason,
    createdAt: new Date(row.created_at),
    ...(row.reverted_by ? { revertedBy: row.reverted_by } : {}),
    ...(row.reverted_reason ? { revertedReason: row.reverted_reason } : {}),
    ...(row.reverted_at ? { revertedAt: new Date(row.reverted_at) } : {})
  };
}

function rowToAlertRule(row: AlertRuleRow): AlertRuleRecord {
  return {
    id: row.id,
    scopeId: row.scope_id,
    metric: row.metric,
    threshold: Number(row.threshold),
    severity: row.severity,
    suggestedAction: row.suggested_action,
    enabled: row.enabled,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function rowToAlertHistory(row: AlertHistoryRow): AlertHistoryEventRecord {
  return {
    id: row.id,
    ruleId: row.rule_id,
    scopeId: row.scope_id,
    evaluationKey: row.evaluation_key,
    status: row.status,
    metric: row.metric,
    metricValue: Number(row.metric_value),
    threshold: Number(row.threshold),
    windowStartAt: row.window_start_at ? new Date(row.window_start_at) : null,
    windowEndAt: row.window_end_at ? new Date(row.window_end_at) : null,
    severity: row.severity,
    suggestedAction: row.suggested_action,
    actor: row.actor,
    ...(row.reason ? { reason: row.reason } : {}),
    createdAt: new Date(row.created_at)
  };
}

function rowToRequestTrace(row: RequestTraceRow): RequestTraceRecord {
  return {
    requestId: row.request_id,
    correlationId: row.correlation_id ?? row.request_id,
    method: row.method,
    path: row.path,
    statusCode: row.status_code,
    latencyMs: row.latency_ms,
    outcome: row.outcome,
    errorCode: row.error_code,
    playerId: row.player_id,
    sessionId: row.session_id,
    spinId: row.spin_id,
    adminActor: row.admin_actor,
    occurredAt: row.occurred_at.toISOString()
  };
}

function stateFromHistory(history: AlertHistoryEventRecord[]): "none" | "active" {
  const latestByRule = new Map<string, AlertHistoryEventRecord>();
  for (const event of history) {
    latestByRule.set(event.ruleId, event);
  }
  return [...latestByRule.values()].some((event) => event.status === "firing" || event.status === "acknowledged") ? "active" : "none";
}

function invalidOperatorLimits(message: string): ApiHttpError {
  return new ApiHttpError(400, { code: "INVALID_OPERATOR_LIMITS", message, details: {} });
}

function requireRow<TRow>(row: TRow | undefined, label: string): TRow {
  if (!row) {
    throw new Error(`Expected PostgreSQL ${label} row.`);
  }
  return row;
}

function cloneOperatorLimit(record: OperatorLimitRecord): OperatorLimitRecord {
  return { ...record, limits: cloneJson(record.limits), createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt) };
}

function cloneBudgetAction(record: BudgetProtectionActionRecord): BudgetProtectionActionRecord {
  return {
    ...record,
    parameters: cloneJson(record.parameters),
    metricState: cloneJson(record.metricState),
    createdAt: new Date(record.createdAt),
    ...(record.revertedAt ? { revertedAt: new Date(record.revertedAt) } : {})
  };
}

function cloneAuditEvent(event: AdminAuditEventRecord): AdminAuditEventRecord {
  return {
    ...event,
    occurredAt: new Date(event.occurredAt),
    resource: { ...event.resource },
    before: cloneOrNull(event.before),
    after: cloneOrNull(event.after),
    metadata: cloneJson(event.metadata)
  };
}

function cloneOrNull(value: Record<string, unknown> | null): Record<string, unknown> | null {
  return value ? cloneJson(value) : null;
}

function cloneJson<T>(value: T): T {
  return structuredClone(value) as T;
}

function jsonParam(value: unknown): string {
  return JSON.stringify(value);
}
