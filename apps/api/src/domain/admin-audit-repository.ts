import type { AdminRole } from "../middleware/admin-auth.js";
import type { Clock } from "./session-service.js";

export type AdminAuditRole = AdminRole | "system" | "unknown";
export type AdminAuditSource =
  | "admin-api"
  | "config"
  | "operator-limits"
  | "alerts"
  | "budget-protection"
  | "support-search"
  | "reward-boundary"
  | "spins"
  | "auth";
export type AdminAuditOutcome = "succeeded" | "failed";

export interface AdminAuditResource {
  type: string;
  id: string;
}

export interface AdminAuditEventInput {
  actor: string;
  role: AdminAuditRole;
  action: string;
  resource: AdminAuditResource;
  requestId?: string | null;
  reason?: string | null;
  source: AdminAuditSource;
  outcome: AdminAuditOutcome;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export interface AdminAuditEventRecord extends Required<Omit<AdminAuditEventInput, "requestId" | "reason" | "before" | "after" | "metadata">> {
  id: string;
  occurredAt: Date;
  requestId: string | null;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export interface AdminAuditRepository {
  record(input: AdminAuditEventInput): AdminAuditEventRecord;
  list(): AdminAuditEventRecord[];
}

export class InMemoryAdminAuditRepository implements AdminAuditRepository {
  private readonly events: AdminAuditEventRecord[] = [];

  public constructor(private readonly clock: Clock = { now: () => new Date() }) {}

  public record(input: AdminAuditEventInput): AdminAuditEventRecord {
    const event: AdminAuditEventRecord = {
      id: `admin_audit_${this.events.length + 1}`,
      occurredAt: this.clock.now(),
      actor: input.actor,
      role: input.role,
      action: input.action,
      resource: { ...input.resource },
      requestId: input.requestId ?? null,
      reason: input.reason ?? null,
      source: input.source,
      outcome: input.outcome,
      before: input.before ? cloneRecord(input.before) : null,
      after: input.after ? cloneRecord(input.after) : null,
      metadata: cloneRecord(input.metadata ?? {})
    };
    this.events.push(cloneEvent(event));
    return cloneEvent(event);
  }

  public list(): AdminAuditEventRecord[] {
    return this.events.map((event) => cloneEvent(event));
  }
}

function cloneEvent(event: AdminAuditEventRecord): AdminAuditEventRecord {
  return {
    ...event,
    occurredAt: new Date(event.occurredAt),
    resource: { ...event.resource },
    before: event.before ? cloneRecord(event.before) : null,
    after: event.after ? cloneRecord(event.after) : null,
    metadata: cloneRecord(event.metadata)
  };
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(record) as Record<string, unknown>;
}
