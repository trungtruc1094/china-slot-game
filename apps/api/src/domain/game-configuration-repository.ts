import type { GameConfiguration, RtpReport, SimulationInput, SimulationResult } from "@china-slot-game/game-math";
import { ApiHttpError } from "../middleware/error-handler.js";
import type { AdminAuditRepository } from "./admin-audit-repository.js";
import type { Clock } from "./session-service.js";

export type GameConfigurationStatus = "draft" | "active" | "retired";

export interface GameConfigurationRecord {
  id: string;
  configId: string;
  versionId: string;
  versionNumber?: number;
  status: GameConfigurationStatus;
  config: GameConfiguration;
  mathReportId?: string;
  metadata: Record<string, unknown>;
  createdBy: string;
  updatedBy: string;
  activatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  activatedAt?: Date;
}

export interface MathReportRecord {
  id: string;
  draftId: string;
  configId: string;
  configVersionId: string;
  report: RtpReport;
  createdBy: string;
  createdAt: Date;
}

export interface SimulationRunRecord {
  id: string;
  draftId: string;
  configId: string;
  configVersionId: string;
  input: SimulationInput;
  result: SimulationResult;
  createdBy: string;
  createdAt: Date;
}

export type AdminAuditAction = "config.activate" | "config.rollback";

export interface AdminAuditEventRecord {
  id: string;
  action: AdminAuditAction;
  targetId: string;
  actor: string;
  reason?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface DraftConfigurationInput {
  id: string;
  config: GameConfiguration;
  actor: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateDraftConfigurationInput {
  id: string;
  config: GameConfiguration;
  actor: string;
  metadata?: Record<string, unknown>;
}

export interface ActivationInput {
  id: string;
  actor: string;
  reason?: string;
}

export interface RollbackInput {
  targetVersionId: string;
  actor: string;
  reason?: string;
}

export interface AttachMathReportInput {
  draftId: string;
  report: RtpReport;
  actor: string;
}

export interface StoreSimulationRunInput {
  draftId: string;
  input: SimulationInput;
  result: SimulationResult;
  actor: string;
}

export interface GameConfigurationProvider {
  getActiveConfig(): GameConfiguration | undefined;
}

export class InMemoryGameConfigurationRepository implements GameConfigurationProvider {
  private readonly records = new Map<string, GameConfigurationRecord>();
  private readonly mathReports = new Map<string, MathReportRecord>();
  private readonly simulationRuns = new Map<string, SimulationRunRecord>();
  private readonly auditEvents: AdminAuditEventRecord[] = [];

  public constructor(
    private readonly clock: Clock = { now: () => new Date() },
    private readonly adminAuditRepository?: AdminAuditRepository
  ) {}

  public createDraft(input: DraftConfigurationInput): GameConfigurationRecord {
    if (this.records.has(input.id)) {
      throw new ApiHttpError(409, {
        code: "CONFIG_VERSION_CONFLICT",
        message: "Configuration record already exists.",
        details: { id: input.id }
      });
    }

    const now = this.clock.now();
    const record: GameConfigurationRecord = {
      id: input.id,
      configId: input.config.id,
      versionId: input.config.versionId,
      status: "draft",
      config: cloneConfig(input.config),
      metadata: { ...(input.metadata ?? {}) },
      createdBy: input.actor,
      updatedBy: input.actor,
      createdAt: now,
      updatedAt: now
    };
    this.assertUniqueVersionId(record.versionId);
    this.records.set(record.id, cloneRecord(record));
    return cloneRecord(record);
  }

  public updateDraft(input: UpdateDraftConfigurationInput): GameConfigurationRecord {
    const existing = this.requireRecord(input.id);
    if (existing.status !== "draft") {
      throw new ApiHttpError(409, {
        code: "CONFIG_STATUS_CONFLICT",
        message: "Only draft configurations can be updated.",
        details: { id: input.id, status: existing.status }
      });
    }

    if (input.config.versionId !== existing.versionId) {
      this.assertUniqueVersionId(input.config.versionId);
    }

    const updated: GameConfigurationRecord = {
      ...existing,
      configId: input.config.id,
      versionId: input.config.versionId,
      config: cloneConfig(input.config),
      metadata: { ...existing.metadata, ...(input.metadata ?? {}) },
      updatedBy: input.actor,
      updatedAt: this.clock.now()
    };
    this.records.set(updated.id, cloneRecord(updated));
    return cloneRecord(updated);
  }

  public read(id: string): GameConfigurationRecord | undefined {
    const record = this.records.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  public list(): GameConfigurationRecord[] {
    return [...this.records.values()]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((record) => cloneRecord(record));
  }

  public activateDraft(input: ActivationInput): GameConfigurationRecord {
    const draft = this.requireRecord(input.id);
    if (draft.status !== "draft") {
      throw new ApiHttpError(409, {
        code: "CONFIG_STATUS_CONFLICT",
        message: "Only draft configurations can be activated.",
        details: { id: input.id, status: draft.status }
      });
    }
    const existingReport = draft.mathReportId ? this.mathReports.get(draft.mathReportId) : undefined;
    if (existingReport?.report.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      throw new ApiHttpError(409, {
        code: "CONFIG_MATH_REPORT_BLOCKED",
        message: "Draft configuration has blocking math diagnostics.",
        details: { id: input.id, mathReportId: draft.mathReportId }
      });
    }

    const now = this.clock.now();
    const nextVersionNumber = this.nextVersionNumber(draft.configId);
    for (const record of this.records.values()) {
      if (record.status === "active") {
        const retired: GameConfigurationRecord = {
          ...record,
          status: "retired",
          updatedBy: input.actor,
          updatedAt: now
        };
        this.records.set(retired.id, cloneRecord(retired));
      }
    }

    const activated: GameConfigurationRecord = {
      ...draft,
      status: "active",
      versionNumber: nextVersionNumber,
      metadata: input.reason ? { ...draft.metadata, activationReason: input.reason } : { ...draft.metadata },
      activatedBy: input.actor,
      updatedBy: input.actor,
      activatedAt: now,
      updatedAt: now,
      config: cloneConfig(draft.config)
    };
    this.assertNoOtherActive(activated.id);
    this.records.set(activated.id, cloneRecord(activated));
    this.auditEvents.push(cloneAuditEvent({
      id: `audit_event_${this.auditEvents.length + 1}`,
      action: "config.activate",
      targetId: activated.id,
      actor: input.actor,
      ...(input.reason ? { reason: input.reason } : {}),
      metadata: {
        versionId: activated.versionId,
        versionNumber: activated.versionNumber,
        mathReportId: activated.mathReportId ?? null
      },
      createdAt: now
    }));
    this.adminAuditRepository?.record({
      actor: input.actor,
      role: "operator",
      action: "config.activate",
      resource: { type: "config_version", id: activated.id },
      reason: input.reason ?? null,
      source: "config",
      outcome: "succeeded",
      before: null,
      after: {
        status: activated.status,
        versionId: activated.versionId,
        versionNumber: activated.versionNumber ?? null
      },
      metadata: {
        configId: activated.configId,
        mathReportId: activated.mathReportId ?? null
      }
    });
    return cloneRecord(activated);
  }

  public rollbackToVersion(input: RollbackInput): GameConfigurationRecord {
    const target = [...this.records.values()].find((record) => record.versionId === input.targetVersionId);
    if (!target) {
      throw new ApiHttpError(404, {
        code: "CONFIG_NOT_FOUND",
        message: "Rollback target configuration version was not found.",
        details: { versionId: input.targetVersionId }
      });
    }
    if (target.status === "draft") {
      throw new ApiHttpError(409, {
        code: "CONFIG_STATUS_CONFLICT",
        message: "Rollback target must be an activated configuration version.",
        details: { versionId: input.targetVersionId, status: target.status }
      });
    }

    const now = this.clock.now();
    const previousActive = this.getActiveRecord();
    for (const record of this.records.values()) {
      if (record.status === "active" && record.id !== target.id) {
        this.records.set(record.id, cloneRecord({
          ...record,
          status: "retired",
          updatedBy: input.actor,
          updatedAt: now
        }));
      }
    }

    const rolledBack: GameConfigurationRecord = {
      ...target,
      status: "active",
      activatedBy: input.actor,
      activatedAt: now,
      updatedBy: input.actor,
      updatedAt: now,
      config: cloneConfig(target.config)
    };
    this.records.set(rolledBack.id, cloneRecord(rolledBack));
    this.auditEvents.push(cloneAuditEvent({
      id: `audit_event_${this.auditEvents.length + 1}`,
      action: "config.rollback",
      targetId: rolledBack.id,
      actor: input.actor,
      ...(input.reason ? { reason: input.reason } : {}),
      metadata: {
        targetVersionId: input.targetVersionId,
        previousActiveVersionId: previousActive?.versionId ?? null,
        restoredConfig: cloneConfig(rolledBack.config)
      },
      createdAt: now
    }));
    this.adminAuditRepository?.record({
      actor: input.actor,
      role: "operator",
      action: "config.rollback",
      resource: { type: "config_version", id: rolledBack.id },
      reason: input.reason ?? null,
      source: "config",
      outcome: "succeeded",
      before: previousActive ? {
        id: previousActive.id,
        versionId: previousActive.versionId,
        status: previousActive.status
      } : null,
      after: {
        id: rolledBack.id,
        versionId: rolledBack.versionId,
        status: rolledBack.status
      },
      metadata: {
        targetVersionId: input.targetVersionId
      }
    });
    return cloneRecord(rolledBack);
  }

  public listAuditEvents(): AdminAuditEventRecord[] {
    return this.auditEvents.map((event) => cloneAuditEvent(event));
  }

  public getActiveRecord(): GameConfigurationRecord | undefined {
    const active = [...this.records.values()].find((record) => record.status === "active");
    return active ? cloneRecord(active) : undefined;
  }

  public attachMathReport(input: AttachMathReportInput): MathReportRecord {
    const draft = this.requireRecord(input.draftId);
    if (draft.status !== "draft") {
      throw new ApiHttpError(409, {
        code: "CONFIG_STATUS_CONFLICT",
        message: "Math reports can only be attached to draft configurations.",
        details: { id: input.draftId, status: draft.status }
      });
    }
    if (draft.mathReportId) {
      throw new ApiHttpError(409, {
        code: "MATH_REPORT_IMMUTABLE",
        message: "A math report is already attached to this draft configuration.",
        details: { id: input.draftId, mathReportId: draft.mathReportId }
      });
    }

    const reportId = `math_report_${this.mathReports.size + 1}`;
    const mathReport: MathReportRecord = {
      id: reportId,
      draftId: input.draftId,
      configId: input.report.configId,
      configVersionId: input.report.configVersionId,
      report: cloneReport(input.report),
      createdBy: input.actor,
      createdAt: this.clock.now()
    };
    this.mathReports.set(reportId, cloneMathReportRecord(mathReport));
    this.records.set(draft.id, {
      ...draft,
      mathReportId: reportId,
      updatedBy: input.actor,
      updatedAt: this.clock.now()
    });
    return cloneMathReportRecord(mathReport);
  }

  public getMathReportForDraft(draftId: string): MathReportRecord | undefined {
    const draft = this.requireRecord(draftId);
    if (!draft.mathReportId) {
      return undefined;
    }
    const report = this.mathReports.get(draft.mathReportId);
    return report ? cloneMathReportRecord(report) : undefined;
  }

  public storeSimulationRun(input: StoreSimulationRunInput): SimulationRunRecord {
    const draft = this.requireRecord(input.draftId);
    if (draft.status !== "draft") {
      throw new ApiHttpError(409, {
        code: "CONFIG_STATUS_CONFLICT",
        message: "Simulation runs can only be stored for draft configurations.",
        details: { id: input.draftId, status: draft.status }
      });
    }
    const runId = `simulation_run_${this.simulationRuns.size + 1}`;
    const run: SimulationRunRecord = {
      id: runId,
      draftId: input.draftId,
      configId: input.result.configId,
      configVersionId: input.result.configVersionId,
      input: cloneSimulationInput(input.input),
      result: cloneSimulationResult(input.result),
      createdBy: input.actor,
      createdAt: this.clock.now()
    };
    this.simulationRuns.set(runId, cloneSimulationRunRecord(run));
    return cloneSimulationRunRecord(run);
  }

  public getSimulationRun(draftId: string, runId: string): SimulationRunRecord | undefined {
    this.requireRecord(draftId);
    const run = this.simulationRuns.get(runId);
    return run && run.draftId === draftId ? cloneSimulationRunRecord(run) : undefined;
  }

  public listSimulationRuns(draftId: string): SimulationRunRecord[] {
    this.requireRecord(draftId);
    return [...this.simulationRuns.values()]
      .filter((run) => run.draftId === draftId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((run) => cloneSimulationRunRecord(run));
  }

  public getActiveConfig(): GameConfiguration | undefined {
    const active = this.getActiveRecord();
    return active ? cloneConfig(active.config) : undefined;
  }

  private requireRecord(id: string): GameConfigurationRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new ApiHttpError(404, {
        code: "CONFIG_NOT_FOUND",
        message: "Configuration record was not found.",
        details: { id }
      });
    }
    return cloneRecord(record);
  }

  private nextVersionNumber(configId: string): number {
    return this.list()
      .filter((record) => record.configId === configId && record.versionNumber !== undefined)
      .reduce((next, record) => Math.max(next, (record.versionNumber ?? 0) + 1), 1);
  }

  private assertUniqueVersionId(versionId: string): void {
    if ([...this.records.values()].some((record) => record.versionId === versionId)) {
      throw new ApiHttpError(409, {
        code: "CONFIG_VERSION_CONFLICT",
        message: "Configuration version ID must be unique.",
        details: { versionId }
      });
    }
  }

  private assertNoOtherActive(id: string): void {
    if ([...this.records.values()].some((record) => record.status === "active" && record.id !== id)) {
      throw new ApiHttpError(409, {
        code: "CONFIG_STATUS_CONFLICT",
        message: "Only one game configuration can be active.",
        details: { id }
      });
    }
  }
}

function cloneRecord(record: GameConfigurationRecord): GameConfigurationRecord {
  return {
    ...record,
    config: cloneConfig(record.config),
    metadata: { ...record.metadata },
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    ...(record.activatedAt ? { activatedAt: new Date(record.activatedAt) } : {})
  };
}

function cloneConfig(config: GameConfiguration): GameConfiguration {
  return structuredClone(config) as GameConfiguration;
}

function cloneReport(report: RtpReport): RtpReport {
  return structuredClone(report) as RtpReport;
}

function cloneMathReportRecord(record: MathReportRecord): MathReportRecord {
  return {
    ...record,
    report: cloneReport(record.report),
    createdAt: new Date(record.createdAt)
  };
}

function cloneSimulationInput(input: SimulationInput): SimulationInput {
  return structuredClone(input) as SimulationInput;
}

function cloneSimulationResult(result: SimulationResult): SimulationResult {
  return structuredClone(result) as SimulationResult;
}

function cloneSimulationRunRecord(record: SimulationRunRecord): SimulationRunRecord {
  return {
    ...record,
    input: cloneSimulationInput(record.input),
    result: cloneSimulationResult(record.result),
    createdAt: new Date(record.createdAt)
  };
}

function cloneAuditEvent(record: AdminAuditEventRecord): AdminAuditEventRecord {
  return {
    ...record,
    metadata: structuredClone(record.metadata) as Record<string, unknown>,
    createdAt: new Date(record.createdAt)
  };
}
