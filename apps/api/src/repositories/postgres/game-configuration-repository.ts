import { randomUUID } from "node:crypto";
import type { GameConfiguration, RtpReport, SimulationInput, SimulationResult } from "@china-slot-game/game-math";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../../db/transactions.js";
import type { AdminAuditRepository } from "../../domain/admin-audit-repository.js";
import type {
  ActivationInput,
  AdminAuditEventRecord,
  AttachMathReportInput,
  DraftConfigurationInput,
  GameConfigurationProvider,
  GameConfigurationRecord,
  GameConfigurationRepository,
  GameConfigurationStatus,
  MathReportRecord,
  RollbackInput,
  SimulationRunRecord,
  StoreSimulationRunInput,
  UpdateDraftConfigurationInput
} from "../../domain/game-configuration-repository.js";
import { ApiHttpError } from "../../middleware/error-handler.js";
import type { Clock } from "../../domain/session-service.js";

interface ConfigRow {
  id: string;
  config_id: string;
  version_id: string;
  version_number: number | null;
  status: GameConfigurationStatus;
  config_json: GameConfiguration;
  math_report_id: string | null;
  metadata_json: Record<string, unknown>;
  created_by: string;
  updated_by: string;
  activated_by: string | null;
  created_at: Date;
  updated_at: Date;
  activated_at: Date | null;
}

interface MathReportRow {
  id: string;
  draft_id: string;
  config_id: string;
  config_version_id: string;
  report_json: RtpReport;
  created_by: string;
  created_at: Date;
}

interface SimulationRunRow {
  id: string;
  draft_id: string;
  config_id: string;
  config_version_id: string;
  input_json: SimulationInput;
  result_json: SimulationResult;
  created_by: string;
  created_at: Date;
}

interface ConfigAuditRow {
  id: string;
  action: "config.activate" | "config.rollback";
  target_id: string;
  actor: string;
  reason: string | null;
  metadata_json: Record<string, unknown>;
  created_at: Date;
}

export class PostgresGameConfigurationRepository implements GameConfigurationRepository, GameConfigurationProvider {
  private activeConfigCache: GameConfiguration | undefined;

  public constructor(
    private readonly pool: Pool,
    private readonly clock: Clock = { now: () => new Date() },
    private readonly adminAuditRepository?: AdminAuditRepository
  ) {}

  public async createDraft(input: DraftConfigurationInput): Promise<GameConfigurationRecord> {
    const now = this.clock.now();
    try {
      const result = await this.pool.query<ConfigRow>(
        `INSERT INTO game_config_versions (
           id, config_id, version_id, status, config_json, metadata_json,
           created_by, updated_by, created_at, updated_at
         ) VALUES ($1, $2, $3, 'draft', $4, $5, $6, $6, $7, $7)
         RETURNING ${configSelectColumns()}`,
        [
          input.id,
          input.config.id,
          input.config.versionId,
          cloneJson(input.config),
          cloneJson(input.metadata ?? {}),
          input.actor,
          now
        ]
      );

      return rowToConfigRecord(requireConfigRow(result.rows[0]));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiHttpError(409, {
          code: "CONFIG_VERSION_CONFLICT",
          message: isPrimaryKeyViolation(error) ? "Configuration record already exists." : "Configuration version ID must be unique.",
          details: isPrimaryKeyViolation(error) ? { id: input.id } : { versionId: input.config.versionId }
        });
      }
      throw error;
    }
  }

  public async updateDraft(input: UpdateDraftConfigurationInput): Promise<GameConfigurationRecord> {
    const now = this.clock.now();
    return withTransaction(this.pool, async (client) => {
      const existing = await this.requireRecord(client, input.id, true);
      if (existing.status !== "draft") {
        throw new ApiHttpError(409, {
          code: "CONFIG_STATUS_CONFLICT",
          message: "Only draft configurations can be updated.",
          details: { id: input.id, status: existing.status }
        });
      }

      try {
        const result = await client.query<ConfigRow>(
          `UPDATE game_config_versions
           SET config_id = $2,
               version_id = $3,
               config_json = $4,
               metadata_json = metadata_json || $5::jsonb,
               updated_by = $6,
               updated_at = $7
           WHERE id = $1
           RETURNING ${configSelectColumns()}`,
          [
            input.id,
            input.config.id,
            input.config.versionId,
            cloneJson(input.config),
            cloneJson(input.metadata ?? {}),
            input.actor,
            now
          ]
        );
        return rowToConfigRecord(requireConfigRow(result.rows[0]));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiHttpError(409, {
            code: "CONFIG_VERSION_CONFLICT",
            message: "Configuration version ID must be unique.",
            details: { versionId: input.config.versionId }
          });
        }
        throw error;
      }
    });
  }

  public async read(id: string): Promise<GameConfigurationRecord | undefined> {
    const result = await this.pool.query<ConfigRow>(
      `SELECT ${configSelectColumns()} FROM game_config_versions WHERE id = $1`,
      [id]
    );

    return result.rows[0] ? rowToConfigRecord(result.rows[0]) : undefined;
  }

  public async list(): Promise<GameConfigurationRecord[]> {
    const result = await this.pool.query<ConfigRow>(
      `SELECT ${configSelectColumns()} FROM game_config_versions ORDER BY created_at, id`
    );

    return result.rows.map(rowToConfigRecord);
  }

  public async activateDraft(input: ActivationInput): Promise<GameConfigurationRecord> {
    const now = this.clock.now();
    const activated = await withTransaction(this.pool, async (client) => {
      const draft = await this.requireRecord(client, input.id, true);
      if (draft.status !== "draft") {
        throw new ApiHttpError(409, {
          code: "CONFIG_STATUS_CONFLICT",
          message: "Only draft configurations can be activated.",
          details: { id: input.id, status: draft.status }
        });
      }

      const mathReport = await this.getMathReportForDraftInTransaction(client, draft.id);
      if (!mathReport) {
        throw new ApiHttpError(404, {
          code: "MATH_REPORT_NOT_FOUND",
          message: "A math report must be attached before activation.",
          details: { id: draft.id }
        });
      }
      if (mathReport.report.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        throw new ApiHttpError(409, {
          code: "CONFIG_MATH_REPORT_BLOCKED",
          message: "Draft configuration has blocking math diagnostics.",
          details: { id: input.id, mathReportId: mathReport.id }
        });
      }
      if (await this.countSimulationRuns(client, draft.id) === 0) {
        throw new ApiHttpError(404, {
          code: "SIMULATION_NOT_FOUND",
          message: "At least one simulation run must exist before activation.",
          details: { id: draft.id }
        });
      }

      const nextVersionNumber = await this.nextVersionNumber(client, draft.configId);
      await client.query(
        `UPDATE game_config_versions
         SET status = 'retired', updated_by = $1, updated_at = $2
         WHERE status = 'active'`,
        [input.actor, now]
      );

      const result = await client.query<ConfigRow>(
        `UPDATE game_config_versions
         SET status = 'active',
             version_number = $2,
             metadata_json = metadata_json || $3::jsonb,
             activated_by = $4,
             updated_by = $4,
             activated_at = $5,
             updated_at = $5
         WHERE id = $1
         RETURNING ${configSelectColumns()}`,
        [
          draft.id,
          nextVersionNumber,
          cloneJson(input.reason ? { activationReason: input.reason } : {}),
          input.actor,
          now
        ]
      );
      const activeRecord = rowToConfigRecord(requireConfigRow(result.rows[0]));
      await this.insertConfigAuditEvent(client, {
        action: "config.activate",
        targetId: activeRecord.id,
        actor: input.actor,
        ...(input.reason ? { reason: input.reason } : {}),
        metadata: {
          versionId: activeRecord.versionId,
          versionNumber: activeRecord.versionNumber,
          mathReportId: activeRecord.mathReportId ?? null
        },
        createdAt: now
      });
      return activeRecord;
    });

    this.activeConfigCache = cloneConfig(activated.config);
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
    return activated;
  }

  public async rollbackToVersion(input: RollbackInput): Promise<GameConfigurationRecord> {
    const now = this.clock.now();
    const { rolledBack, previousActive } = await withTransaction(this.pool, async (client) => {
      const targetResult = await client.query<ConfigRow>(
        `SELECT ${configSelectColumns()} FROM game_config_versions WHERE version_id = $1 FOR UPDATE`,
        [input.targetVersionId]
      );
      const target = targetResult.rows[0] ? rowToConfigRecord(targetResult.rows[0]) : undefined;
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

      const previousActive = await this.getActiveRecordInTransaction(client, true);
      await client.query(
        `UPDATE game_config_versions
         SET status = 'retired', updated_by = $1, updated_at = $2
         WHERE status = 'active' AND id <> $3`,
        [input.actor, now, target.id]
      );
      const result = await client.query<ConfigRow>(
        `UPDATE game_config_versions
         SET status = 'active', activated_by = $2, activated_at = $3, updated_by = $2, updated_at = $3
         WHERE id = $1
         RETURNING ${configSelectColumns()}`,
        [target.id, input.actor, now]
      );
      const rolledBack = rowToConfigRecord(requireConfigRow(result.rows[0]));
      await this.insertConfigAuditEvent(client, {
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
      });
      return { rolledBack, previousActive };
    });

    this.activeConfigCache = cloneConfig(rolledBack.config);
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
    return rolledBack;
  }

  public async listAuditEvents(): Promise<AdminAuditEventRecord[]> {
    const result = await this.pool.query<ConfigAuditRow>(
      `SELECT id, action, target_id, actor, reason, metadata_json, created_at
       FROM game_config_audit_events
       ORDER BY created_at, id`
    );

    return result.rows.map(rowToAuditEvent);
  }

  public async getActiveRecord(): Promise<GameConfigurationRecord | undefined> {
    const active = await this.getActiveRecordInTransaction(this.pool);
    this.activeConfigCache = active ? cloneConfig(active.config) : undefined;
    return active;
  }

  public async attachMathReport(input: AttachMathReportInput): Promise<MathReportRecord> {
    const now = this.clock.now();
    return withTransaction(this.pool, async (client) => {
      const draft = await this.requireRecord(client, input.draftId, true);
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

      const reportId = `math_report_${randomUUID()}`;
      try {
        const result = await client.query<MathReportRow>(
          `INSERT INTO game_config_math_reports (id, draft_id, config_id, config_version_id, report_json, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, draft_id, config_id, config_version_id, report_json, created_by, created_at`,
          [reportId, input.draftId, input.report.configId, input.report.configVersionId, cloneJson(input.report), input.actor, now]
        );
        await client.query(
          `UPDATE game_config_versions SET updated_by = $2, updated_at = $3 WHERE id = $1`,
          [input.draftId, input.actor, now]
        );
        return rowToMathReport(requireMathReportRow(result.rows[0]));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiHttpError(409, {
            code: "MATH_REPORT_IMMUTABLE",
            message: "A math report is already attached to this draft configuration.",
            details: { id: input.draftId }
          });
        }
        throw error;
      }
    });
  }

  public async getMathReportForDraft(draftId: string): Promise<MathReportRecord | undefined> {
    await this.requireRecord(this.pool, draftId, false);
    return this.getMathReportForDraftInTransaction(this.pool, draftId);
  }

  public async storeSimulationRun(input: StoreSimulationRunInput): Promise<SimulationRunRecord> {
    const now = this.clock.now();
    return withTransaction(this.pool, async (client) => {
      const draft = await this.requireRecord(client, input.draftId, true);
      if (draft.status !== "draft") {
        throw new ApiHttpError(409, {
          code: "CONFIG_STATUS_CONFLICT",
          message: "Simulation runs can only be stored for draft configurations.",
          details: { id: input.draftId, status: draft.status }
        });
      }
      const result = await client.query<SimulationRunRow>(
        `INSERT INTO game_config_simulation_runs (id, draft_id, config_id, config_version_id, input_json, result_json, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, draft_id, config_id, config_version_id, input_json, result_json, created_by, created_at`,
        [
          `simulation_run_${randomUUID()}`,
          input.draftId,
          input.result.configId,
          input.result.configVersionId,
          cloneJson(input.input),
          cloneJson(input.result),
          input.actor,
          now
        ]
      );
      return rowToSimulationRun(requireSimulationRow(result.rows[0]));
    });
  }

  public async getSimulationRun(draftId: string, runId: string): Promise<SimulationRunRecord | undefined> {
    await this.requireRecord(this.pool, draftId, false);
    const result = await this.pool.query<SimulationRunRow>(
      `SELECT id, draft_id, config_id, config_version_id, input_json, result_json, created_by, created_at
       FROM game_config_simulation_runs
       WHERE draft_id = $1 AND id = $2`,
      [draftId, runId]
    );

    return result.rows[0] ? rowToSimulationRun(result.rows[0]) : undefined;
  }

  public async listSimulationRuns(draftId: string): Promise<SimulationRunRecord[]> {
    await this.requireRecord(this.pool, draftId, false);
    const result = await this.pool.query<SimulationRunRow>(
      `SELECT id, draft_id, config_id, config_version_id, input_json, result_json, created_by, created_at
       FROM game_config_simulation_runs
       WHERE draft_id = $1
       ORDER BY created_at, id`,
      [draftId]
    );

    return result.rows.map(rowToSimulationRun);
  }

  public getActiveConfig(): GameConfiguration | undefined {
    return this.activeConfigCache ? cloneConfig(this.activeConfigCache) : undefined;
  }

  private async requireRecord(client: Pool | PoolClient, id: string, forUpdate: boolean): Promise<GameConfigurationRecord> {
    const lockClause = forUpdate ? "FOR UPDATE" : "";
    const result = await client.query<ConfigRow>(
      `SELECT ${configSelectColumns()} FROM game_config_versions WHERE id = $1 ${lockClause}`,
      [id]
    );
    if (!result.rows[0]) {
      throw new ApiHttpError(404, {
        code: "CONFIG_NOT_FOUND",
        message: "Configuration record was not found.",
        details: { id }
      });
    }
    return rowToConfigRecord(result.rows[0]);
  }

  private async getActiveRecordInTransaction(client: Pool | PoolClient, forUpdate = false): Promise<GameConfigurationRecord | undefined> {
    const lockClause = forUpdate ? "FOR UPDATE" : "";
    const result = await client.query<ConfigRow>(
      `SELECT ${configSelectColumns()} FROM game_config_versions WHERE status = 'active' ${lockClause}`
    );

    return result.rows[0] ? rowToConfigRecord(result.rows[0]) : undefined;
  }

  private async getMathReportForDraftInTransaction(client: Pool | PoolClient, draftId: string): Promise<MathReportRecord | undefined> {
    const result = await client.query<MathReportRow>(
      `SELECT id, draft_id, config_id, config_version_id, report_json, created_by, created_at
       FROM game_config_math_reports
       WHERE draft_id = $1`,
      [draftId]
    );

    return result.rows[0] ? rowToMathReport(result.rows[0]) : undefined;
  }

  private async nextVersionNumber(client: PoolClient, configId: string): Promise<number> {
    const result = await client.query<{ next_version_number: number }>(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version_number
       FROM game_config_versions
       WHERE config_id = $1 AND version_number IS NOT NULL`,
      [configId]
    );

    return result.rows[0]?.next_version_number ?? 1;
  }

  private async countSimulationRuns(client: PoolClient, draftId: string): Promise<number> {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM game_config_simulation_runs WHERE draft_id = $1`,
      [draftId]
    );

    return Number(result.rows[0]?.count ?? "0");
  }

  private async insertConfigAuditEvent(client: PoolClient, input: {
    action: "config.activate" | "config.rollback";
    targetId: string;
    actor: string;
    reason?: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
  }): Promise<void> {
    await client.query(
      `INSERT INTO game_config_audit_events (id, action, target_id, actor, reason, metadata_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        `audit_event_${randomUUID()}`,
        input.action,
        input.targetId,
        input.actor,
        input.reason ?? null,
        cloneJson(input.metadata),
        input.createdAt
      ]
    );
  }
}

function configSelectColumns(): string {
  return `
    id,
    config_id,
    version_id,
    version_number,
    status,
    config_json,
    (SELECT id FROM game_config_math_reports WHERE draft_id = game_config_versions.id) AS math_report_id,
    metadata_json,
    created_by,
    updated_by,
    activated_by,
    created_at,
    updated_at,
    activated_at
  `;
}

function rowToConfigRecord(row: ConfigRow): GameConfigurationRecord {
  return {
    id: row.id,
    configId: row.config_id,
    versionId: row.version_id,
    ...(row.version_number === null ? {} : { versionNumber: row.version_number }),
    status: row.status,
    config: cloneConfig(row.config_json),
    ...(row.math_report_id ? { mathReportId: row.math_report_id } : {}),
    metadata: cloneJson(row.metadata_json),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    ...(row.activated_by ? { activatedBy: row.activated_by } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.activated_at ? { activatedAt: row.activated_at } : {})
  };
}

function rowToMathReport(row: MathReportRow): MathReportRecord {
  return {
    id: row.id,
    draftId: row.draft_id,
    configId: row.config_id,
    configVersionId: row.config_version_id,
    report: cloneJson(row.report_json),
    createdBy: row.created_by,
    createdAt: row.created_at
  };
}

function rowToSimulationRun(row: SimulationRunRow): SimulationRunRecord {
  return {
    id: row.id,
    draftId: row.draft_id,
    configId: row.config_id,
    configVersionId: row.config_version_id,
    input: cloneJson(row.input_json),
    result: cloneJson(row.result_json),
    createdBy: row.created_by,
    createdAt: row.created_at
  };
}

function rowToAuditEvent(row: ConfigAuditRow): AdminAuditEventRecord {
  return {
    id: row.id,
    action: row.action,
    targetId: row.target_id,
    actor: row.actor,
    ...(row.reason ? { reason: row.reason } : {}),
    metadata: cloneJson(row.metadata_json),
    createdAt: row.created_at
  };
}

function requireConfigRow(row: ConfigRow | undefined): ConfigRow {
  if (!row) {
    throw new Error("Expected PostgreSQL configuration row.");
  }
  return row;
}

function requireMathReportRow(row: MathReportRow | undefined): MathReportRow {
  if (!row) {
    throw new Error("Expected PostgreSQL math report row.");
  }
  return row;
}

function requireSimulationRow(row: SimulationRunRow | undefined): SimulationRunRow {
  if (!row) {
    throw new Error("Expected PostgreSQL simulation row.");
  }
  return row;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function isPrimaryKeyViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "constraint" in error
    && error.constraint === "game_config_versions_pkey";
}

function cloneConfig(config: GameConfiguration): GameConfiguration {
  return structuredClone(config) as GameConfiguration;
}

function cloneJson<TValue>(value: TValue): TValue {
  return structuredClone(value) as TValue;
}