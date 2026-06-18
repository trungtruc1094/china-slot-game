import type { GameConfiguration, RtpReport } from "@china-slot-game/game-math";
import { ApiHttpError } from "../middleware/error-handler.js";
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

export interface AttachMathReportInput {
  draftId: string;
  report: RtpReport;
  actor: string;
}

export interface GameConfigurationProvider {
  getActiveConfig(): GameConfiguration | undefined;
}

export class InMemoryGameConfigurationRepository implements GameConfigurationProvider {
  private readonly records = new Map<string, GameConfigurationRecord>();
  private readonly mathReports = new Map<string, MathReportRecord>();

  public constructor(private readonly clock: Clock = { now: () => new Date() }) {}

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
    return cloneRecord(activated);
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
