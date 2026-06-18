import { ApiHttpError } from "../middleware/error-handler.js";
import type { Clock } from "./session-service.js";

export type BudgetProtectionActionType = "disablePaidSpins" | "lowerMaxBet" | "pauseCampaign" | "requireHostApproval";
export type BudgetProtectionStatus = "active" | "reverted";
export type BudgetProtectionAuditAction = "budget_protection.apply" | "budget_protection.revert";

export interface BudgetProtectionActionRecord {
  id: string;
  scopeId: string;
  action: BudgetProtectionActionType;
  status: BudgetProtectionStatus;
  parameters: Record<string, unknown>;
  metricState: Record<string, unknown>;
  actor: string;
  reason: string;
  createdAt: Date;
  revertedBy?: string;
  revertedReason?: string;
  revertedAt?: Date;
}

export interface BudgetProtectionAuditEventRecord {
  id: string;
  action: BudgetProtectionAuditAction;
  targetId: string;
  actor: string;
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface BudgetProtectionProvider {
  listActiveActions(scopeId?: string): BudgetProtectionActionRecord[];
}

export class InMemoryBudgetProtectionRepository implements BudgetProtectionProvider {
  private readonly actions = new Map<string, BudgetProtectionActionRecord>();
  private readonly auditEvents: BudgetProtectionAuditEventRecord[] = [];

  public constructor(private readonly clock: Clock = { now: () => new Date() }) {}

  public apply(input: {
    scopeId: string;
    action: BudgetProtectionActionType;
    actor: string;
    reason: string;
    parameters?: Record<string, unknown>;
    metricState?: Record<string, unknown>;
  }): BudgetProtectionActionRecord {
    const now = this.clock.now();
    const record: BudgetProtectionActionRecord = {
      id: `budget_protection_${this.actions.size + 1}`,
      scopeId: input.scopeId,
      action: input.action,
      status: "active",
      parameters: structuredClone(input.parameters ?? {}) as Record<string, unknown>,
      metricState: structuredClone(input.metricState ?? {}) as Record<string, unknown>,
      actor: input.actor,
      reason: input.reason,
      createdAt: now
    };
    this.actions.set(record.id, cloneAction(record));
    this.auditEvents.push(cloneAudit({
      id: `budget_protection_audit_${this.auditEvents.length + 1}`,
      action: "budget_protection.apply",
      targetId: record.id,
      actor: input.actor,
      reason: input.reason,
      metadata: {
        scopeId: input.scopeId,
        action: input.action,
        parameters: record.parameters,
        metricState: record.metricState
      },
      createdAt: now
    }));
    return cloneAction(record);
  }

  public revert(id: string, actor: string, reason: string): BudgetProtectionActionRecord {
    const existing = this.actions.get(id);
    if (!existing) {
      throw new ApiHttpError(404, {
        code: "BUDGET_PROTECTION_NOT_FOUND",
        message: "Budget protection action was not found.",
        details: { id }
      });
    }
    if (existing.status === "reverted") {
      return cloneAction(existing);
    }
    const now = this.clock.now();
    const reverted: BudgetProtectionActionRecord = {
      ...existing,
      status: "reverted",
      revertedBy: actor,
      revertedReason: reason,
      revertedAt: now
    };
    this.actions.set(reverted.id, cloneAction(reverted));
    this.auditEvents.push(cloneAudit({
      id: `budget_protection_audit_${this.auditEvents.length + 1}`,
      action: "budget_protection.revert",
      targetId: reverted.id,
      actor,
      reason,
      metadata: {
        scopeId: reverted.scopeId,
        action: reverted.action
      },
      createdAt: now
    }));
    return cloneAction(reverted);
  }

  public list(scopeId?: string): BudgetProtectionActionRecord[] {
    return [...this.actions.values()]
      .filter((action) => scopeId === undefined || action.scopeId === scopeId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((action) => cloneAction(action));
  }

  public listActiveActions(scopeId = "default"): BudgetProtectionActionRecord[] {
    return this.list(scopeId).filter((action) => action.status === "active");
  }

  public listAuditEvents(): BudgetProtectionAuditEventRecord[] {
    return this.auditEvents.map((event) => cloneAudit(event));
  }
}

function cloneAction(record: BudgetProtectionActionRecord): BudgetProtectionActionRecord {
  return {
    ...record,
    parameters: structuredClone(record.parameters) as Record<string, unknown>,
    metricState: structuredClone(record.metricState) as Record<string, unknown>,
    createdAt: new Date(record.createdAt),
    ...(record.revertedAt ? { revertedAt: new Date(record.revertedAt) } : {})
  };
}

function cloneAudit(record: BudgetProtectionAuditEventRecord): BudgetProtectionAuditEventRecord {
  return {
    ...record,
    metadata: structuredClone(record.metadata) as Record<string, unknown>,
    createdAt: new Date(record.createdAt)
  };
}
