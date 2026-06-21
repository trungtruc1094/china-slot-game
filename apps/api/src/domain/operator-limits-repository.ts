import { ApiHttpError } from "../middleware/error-handler.js";
import type { AdminAuditRepository } from "./admin-audit-repository.js";
import type { Clock } from "./session-service.js";

export type OperatorLimitStatus = "active" | "retired";
export type OperatorLimitAuditAction = "operator_limits.create" | "operator_limits.update";

export interface OperatorLimits {
  currency: string;
  perSpin: {
    minBet: number;
    maxBet: number;
    maxPayout: number;
  };
  perSession: {
    maxSpins: number;
    maxWager: number;
  };
  perDay: {
    playerMaxWager: number;
    playerMaxReward: number;
  };
  campaign: {
    budget: number;
    jackpotCap: number;
  };
}

export interface OperatorLimitRecord {
  id: string;
  scopeId: string;
  version: number;
  status: OperatorLimitStatus;
  limits: OperatorLimits;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OperatorLimitAuditEventRecord {
  id: string;
  action: OperatorLimitAuditAction;
  targetId: string;
  actor: string;
  reason?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface OperatorLimitInput {
  scopeId: string;
  limits: OperatorLimits;
  actor: string;
  reason?: string;
}

export interface OperatorLimitsProvider {
  getActiveLimits(scopeId?: string): OperatorLimitRecord | undefined;
}

export interface OperatorLimitsRepository extends OperatorLimitsProvider {
  create(input: OperatorLimitInput): OperatorLimitRecord | Promise<OperatorLimitRecord>;
  update(input: OperatorLimitInput): OperatorLimitRecord | Promise<OperatorLimitRecord>;
  list(scopeId?: string): OperatorLimitRecord[] | Promise<OperatorLimitRecord[]>;
  listAuditEvents(): OperatorLimitAuditEventRecord[] | Promise<OperatorLimitAuditEventRecord[]>;
}

export class InMemoryOperatorLimitsRepository implements OperatorLimitsRepository {
  private readonly records = new Map<string, OperatorLimitRecord>();
  private readonly auditEvents: OperatorLimitAuditEventRecord[] = [];

  public constructor(
    private readonly clock: Clock = { now: () => new Date() },
    private readonly adminAuditRepository?: AdminAuditRepository
  ) {}

  public create(input: OperatorLimitInput): OperatorLimitRecord {
    this.assertNoActive(input.scopeId);
    this.validateLimits(input.limits);
    const now = this.clock.now();
    const record: OperatorLimitRecord = {
      id: `${input.scopeId}-limits-v1`,
      scopeId: input.scopeId,
      version: 1,
      status: "active",
      limits: cloneLimits(input.limits),
      createdBy: input.actor,
      updatedBy: input.actor,
      createdAt: now,
      updatedAt: now
    };
    this.records.set(record.id, cloneRecord(record));
    this.audit("operator_limits.create", record, input.actor, input.reason, {
      version: record.version,
      previousActiveVersion: null
    }, null);
    return cloneRecord(record);
  }

  public update(input: OperatorLimitInput): OperatorLimitRecord {
    const previousActive = this.getActiveRecord(input.scopeId);
    if (!previousActive) {
      throw new ApiHttpError(404, {
        code: "OPERATOR_LIMITS_NOT_FOUND",
        message: "Active operator limits were not found for this scope.",
        details: { scopeId: input.scopeId }
      });
    }
    this.validateLimits(input.limits);
    const now = this.clock.now();
    const retired: OperatorLimitRecord = {
      ...previousActive,
      status: "retired",
      updatedBy: input.actor,
      updatedAt: now
    };
    this.records.set(retired.id, cloneRecord(retired));
    const nextVersion = previousActive.version + 1;
    const record: OperatorLimitRecord = {
      id: `${input.scopeId}-limits-v${nextVersion}`,
      scopeId: input.scopeId,
      version: nextVersion,
      status: "active",
      limits: cloneLimits(input.limits),
      createdBy: input.actor,
      updatedBy: input.actor,
      createdAt: now,
      updatedAt: now
    };
    this.records.set(record.id, cloneRecord(record));
    this.audit("operator_limits.update", record, input.actor, input.reason, {
      version: record.version,
      previousActiveVersion: previousActive.version,
      previousActiveId: previousActive.id
    }, {
      id: previousActive.id,
      version: previousActive.version,
      limits: previousActive.limits
    });
    return cloneRecord(record);
  }

  public getActiveLimits(scopeId = "default"): OperatorLimitRecord | undefined {
    return this.getActiveRecord(scopeId);
  }

  public list(scopeId?: string): OperatorLimitRecord[] {
    return [...this.records.values()]
      .filter((record) => scopeId === undefined || record.scopeId === scopeId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.version - right.version)
      .map((record) => cloneRecord(record));
  }

  public listAuditEvents(): OperatorLimitAuditEventRecord[] {
    return this.auditEvents.map((event) => cloneAuditEvent(event));
  }

  private getActiveRecord(scopeId: string): OperatorLimitRecord | undefined {
    const record = [...this.records.values()].find((candidate) => (
      candidate.scopeId === scopeId && candidate.status === "active"
    ));
    return record ? cloneRecord(record) : undefined;
  }

  private assertNoActive(scopeId: string): void {
    if (this.getActiveRecord(scopeId)) {
      throw new ApiHttpError(409, {
        code: "OPERATOR_LIMITS_CONFLICT",
        message: "Active operator limits already exist for this scope.",
        details: { scopeId }
      });
    }
  }

  private validateLimits(limits: OperatorLimits): void {
    if (limits.perSpin.minBet > limits.perSpin.maxBet) {
      throw invalidCombination("perSpin.minBet must be less than or equal to perSpin.maxBet.");
    }
    if (limits.perSpin.maxPayout > limits.campaign.jackpotCap) {
      throw invalidCombination("perSpin.maxPayout cannot exceed campaign.jackpotCap.");
    }
    if (limits.perSpin.maxBet > limits.perSession.maxWager) {
      throw invalidCombination("perSpin.maxBet cannot exceed perSession.maxWager.");
    }
    if (limits.perSpin.maxBet > limits.perDay.playerMaxWager) {
      throw invalidCombination("perSpin.maxBet cannot exceed perDay.playerMaxWager.");
    }
    if (limits.perSpin.maxBet > limits.campaign.budget) {
      throw invalidCombination("perSpin.maxBet cannot exceed campaign.budget.");
    }
    if (limits.perDay.playerMaxReward > limits.campaign.budget) {
      throw invalidCombination("perDay.playerMaxReward cannot exceed campaign.budget.");
    }
    if (limits.campaign.jackpotCap > limits.campaign.budget) {
      throw invalidCombination("campaign.jackpotCap cannot exceed campaign.budget.");
    }
  }

  private audit(
    action: OperatorLimitAuditAction,
    target: OperatorLimitRecord,
    actor: string,
    reason: string | undefined,
    metadata: Record<string, unknown>,
    before: Record<string, unknown> | null
  ): void {
    this.auditEvents.push(cloneAuditEvent({
      id: `operator_limit_audit_${this.auditEvents.length + 1}`,
      action,
      targetId: target.id,
      actor,
      ...(reason ? { reason } : {}),
      metadata,
      createdAt: this.clock.now()
    }));
    this.adminAuditRepository?.record({
      actor,
      role: "operator",
      action,
      resource: { type: "operator_limits", id: target.id },
      reason: reason ?? null,
      source: "operator-limits",
      outcome: "succeeded",
      before,
      after: {
        id: target.id,
        scopeId: target.scopeId,
        version: target.version,
        status: target.status,
        limits: target.limits
      },
      metadata
    });
  }
}

function invalidCombination(message: string): ApiHttpError {
  return new ApiHttpError(400, {
    code: "INVALID_OPERATOR_LIMITS",
    message,
    details: {}
  });
}

function cloneLimits(limits: OperatorLimits): OperatorLimits {
  return structuredClone(limits) as OperatorLimits;
}

function cloneRecord(record: OperatorLimitRecord): OperatorLimitRecord {
  return {
    ...record,
    limits: cloneLimits(record.limits),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt)
  };
}

function cloneAuditEvent(record: OperatorLimitAuditEventRecord): OperatorLimitAuditEventRecord {
  return {
    ...record,
    metadata: structuredClone(record.metadata) as Record<string, unknown>,
    createdAt: new Date(record.createdAt)
  };
}
