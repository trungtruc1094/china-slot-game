import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  ProviderTopUpCompletionInput,
  ProviderTopUpDuplicateInput,
  ProviderTopUpFailureInput,
  ProviderTopUpIdempotencyInput,
  ProviderTopUpIdempotencyRecord,
  ProviderTopUpIdempotencyRepository,
  ProviderTopUpIdempotencyStatus,
  ProviderTopUpReservationResult
} from "../../domain/provider-top-up-idempotency-repository.js";
import type { Clock } from "../../domain/session-service.js";
import { ApiHttpError } from "../../middleware/error-handler.js";

interface ProviderTopUpIdempotencyRow {
  id: string;
  provider_name: string;
  provider_event_id: string;
  normalized_idempotency_key: string;
  player_id: string | null;
  status: ProviderTopUpIdempotencyStatus;
  point_amount: string | null;
  points_metadata_json: Record<string, unknown>;
  provider_metadata_json: Record<string, unknown>;
  first_seen_at: Date;
  last_seen_at: Date;
  completed_at: Date | null;
  failure_reason: string | null;
}

export class PostgresProviderTopUpIdempotencyRepository implements ProviderTopUpIdempotencyRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly clock: Clock = { now: () => new Date() }
  ) {}

  public async createOrGet(input: ProviderTopUpIdempotencyInput): Promise<ProviderTopUpReservationResult> {
    validateReservationInput(input);
    const now = this.clock.now();
    const recordId = `provider_top_up_${randomUUID()}`;

    const inserted = await this.pool.query<ProviderTopUpIdempotencyRow>(
      `INSERT INTO provider_top_up_idempotency_records (
         id, provider_name, provider_event_id, normalized_idempotency_key, player_id, status, point_amount,
         points_metadata_json, provider_metadata_json, first_seen_at, last_seen_at
       ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $9)
       ON CONFLICT DO NOTHING
       RETURNING id, provider_name, provider_event_id, normalized_idempotency_key, player_id, status, point_amount,
                 points_metadata_json, provider_metadata_json, first_seen_at, last_seen_at, completed_at, failure_reason`,
      [
        recordId,
        input.providerName,
        input.providerEventId,
        input.normalizedIdempotencyKey,
        input.playerId ?? null,
        input.pointAmount ?? null,
        jsonParam(input.pointsMetadata ?? {}),
        jsonParam(input.providerMetadata ?? {}),
        now
      ]
    );

    const created = inserted.rows[0];
    if (created) {
      return { record: rowToRecord(created), created: true, duplicateReason: "none" };
    }

    const byEvent = await this.getByProviderEvent(input.providerName, input.providerEventId);
    if (byEvent) {
      return { record: byEvent, created: false, duplicateReason: "provider_event" };
    }

    const byKey = await this.getByIdempotencyKey(input.providerName, input.normalizedIdempotencyKey);
    if (byKey) {
      return { record: byKey, created: false, duplicateReason: "idempotency_key" };
    }

    throw new Error("Provider top-up idempotency conflict could not be resolved.");
  }

  public async getByProviderEvent(providerName: string, providerEventId: string): Promise<ProviderTopUpIdempotencyRecord | null> {
    const result = await this.pool.query<ProviderTopUpIdempotencyRow>(
      `${selectRecordSql()} WHERE provider_name = $1 AND provider_event_id = $2`,
      [providerName, providerEventId]
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  public async getByIdempotencyKey(providerName: string, normalizedIdempotencyKey: string): Promise<ProviderTopUpIdempotencyRecord | null> {
    const result = await this.pool.query<ProviderTopUpIdempotencyRow>(
      `${selectRecordSql()} WHERE provider_name = $1 AND normalized_idempotency_key = $2`,
      [providerName, normalizedIdempotencyKey]
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  public async markCompleted(input: ProviderTopUpCompletionInput): Promise<ProviderTopUpIdempotencyRecord> {
    const now = this.clock.now();
    const result = await this.pool.query<ProviderTopUpIdempotencyRow>(
      `UPDATE provider_top_up_idempotency_records
       SET status = 'completed', completed_at = $3, last_seen_at = $3,
           points_metadata_json = points_metadata_json || $4::jsonb,
           provider_metadata_json = provider_metadata_json || $5::jsonb,
           failure_reason = NULL
       WHERE provider_name = $1 AND provider_event_id = $2
       RETURNING id, provider_name, provider_event_id, normalized_idempotency_key, player_id, status, point_amount,
                 points_metadata_json, provider_metadata_json, first_seen_at, last_seen_at, completed_at, failure_reason`,
      [input.providerName, input.providerEventId, now, jsonParam(input.pointsMetadata ?? {}), jsonParam(input.providerMetadata ?? {})]
    );
    return requireUpdatedRecord(result.rows[0], input.providerName, input.providerEventId);
  }

  public async markFailed(input: ProviderTopUpFailureInput): Promise<ProviderTopUpIdempotencyRecord> {
    return this.markTerminalFailure(input, "failed");
  }

  public async markIgnored(input: ProviderTopUpFailureInput): Promise<ProviderTopUpIdempotencyRecord> {
    return this.markTerminalFailure(input, "ignored");
  }

  public async markDuplicate(input: ProviderTopUpDuplicateInput): Promise<ProviderTopUpIdempotencyRecord> {
    const providerMetadata = {
      ...cloneMetadata(input.providerMetadata ?? {}),
      ...(input.duplicateOfId ? { duplicateOfId: input.duplicateOfId } : {})
    };
    return this.markTerminalFailure({ ...input, providerMetadata }, "duplicate");
  }

  private async markTerminalFailure(input: ProviderTopUpFailureInput, status: "failed" | "ignored" | "duplicate"): Promise<ProviderTopUpIdempotencyRecord> {
    if (!input.failureReason || input.failureReason.trim().length === 0) {
      throw new ApiHttpError(400, {
        code: "PROVIDER_TOP_UP_FAILURE_REASON_REQUIRED",
        message: "A reason is required to update provider top-up idempotency status.",
        details: { providerName: input.providerName, providerEventId: input.providerEventId, status }
      });
    }

    const now = this.clock.now();
    const result = await this.pool.query<ProviderTopUpIdempotencyRow>(
      `UPDATE provider_top_up_idempotency_records
       SET status = $3, last_seen_at = $4, failure_reason = $5,
           provider_metadata_json = provider_metadata_json || $6::jsonb
       WHERE provider_name = $1 AND provider_event_id = $2
       RETURNING id, provider_name, provider_event_id, normalized_idempotency_key, player_id, status, point_amount,
                 points_metadata_json, provider_metadata_json, first_seen_at, last_seen_at, completed_at, failure_reason`,
      [input.providerName, input.providerEventId, status, now, input.failureReason, jsonParam(input.providerMetadata ?? {})]
    );
    return requireUpdatedRecord(result.rows[0], input.providerName, input.providerEventId);
  }
}

function selectRecordSql(): string {
  return `SELECT id, provider_name, provider_event_id, normalized_idempotency_key, player_id, status, point_amount,
                 points_metadata_json, provider_metadata_json, first_seen_at, last_seen_at, completed_at, failure_reason
          FROM provider_top_up_idempotency_records`;
}

function validateReservationInput(input: ProviderTopUpIdempotencyInput): void {
  if (input.providerName.trim().length === 0 || input.providerEventId.trim().length === 0 || input.normalizedIdempotencyKey.trim().length === 0) {
    throw new ApiHttpError(400, {
      code: "PROVIDER_TOP_UP_IDEMPOTENCY_KEY_REQUIRED",
      message: "Provider name, provider event ID, and idempotency key are required.",
      details: {}
    });
  }
  if (input.pointAmount !== undefined && input.pointAmount !== null && (!Number.isSafeInteger(input.pointAmount) || input.pointAmount < 0)) {
    throw new ApiHttpError(400, {
      code: "INVALID_PROVIDER_TOP_UP_POINTS",
      message: "Provider top-up point amount must be a non-negative safe integer when supplied.",
      details: { providerName: input.providerName, providerEventId: input.providerEventId }
    });
  }
}

function requireUpdatedRecord(row: ProviderTopUpIdempotencyRow | undefined, providerName: string, providerEventId: string): ProviderTopUpIdempotencyRecord {
  if (!row) {
    throw new ApiHttpError(404, {
      code: "PROVIDER_TOP_UP_IDEMPOTENCY_RECORD_NOT_FOUND",
      message: "Provider top-up idempotency record was not found.",
      details: { providerName, providerEventId }
    });
  }
  return rowToRecord(row);
}

function rowToRecord(row: ProviderTopUpIdempotencyRow): ProviderTopUpIdempotencyRecord {
  return {
    id: row.id,
    providerName: row.provider_name,
    providerEventId: row.provider_event_id,
    normalizedIdempotencyKey: row.normalized_idempotency_key,
    playerId: row.player_id,
    status: row.status,
    pointAmount: row.point_amount === null ? null : Number(row.point_amount),
    pointsMetadata: cloneMetadata(row.points_metadata_json),
    providerMetadata: cloneMetadata(row.provider_metadata_json),
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    failureReason: row.failure_reason
  };
}

function cloneMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
}

function jsonParam(value: unknown): string {
  return JSON.stringify(value);
}
