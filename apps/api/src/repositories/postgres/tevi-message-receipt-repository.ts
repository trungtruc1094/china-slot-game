import type { Pool } from "pg";
import type { Clock } from "../../domain/session-service.js";
import {
  newReceiptId,
  type TeviMessageReceiptCreateInput,
  type TeviMessageReceiptRecord,
  type TeviMessageReceiptRepository,
  type TeviMessageReceiptSearchFilters,
  type TeviMessageReceiptSearchResult,
  type TeviMessageReceiptStatus,
  type TeviMessageReceiptType
} from "../../domain/tevi-receipt-service.js";

interface ReceiptRow {
  id: string;
  message_type: TeviMessageReceiptType;
  recipient_tevi_subject: string;
  player_id: string | null;
  source_event_id: string;
  source_correlation_key: string;
  amount: string | null;
  cashout_status: string | null;
  status: TeviMessageReceiptStatus;
  dispatch_attempt_count: number;
  failure_reason: string | null;
  provider_status_code: number | null;
  provider_response_summary_json: Record<string, unknown>;
  message_body_preview: string;
  request_id: string;
  created_at: Date;
  updated_at: Date;
  sent_at: Date | null;
}

export class PostgresTeviMessageReceiptRepository implements TeviMessageReceiptRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly clock: Clock = { now: () => new Date() }
  ) {}

  public async createOrGet(
    input: TeviMessageReceiptCreateInput
  ): Promise<{ record: TeviMessageReceiptRecord; created: boolean }> {
    const existing = await this.pool.query<ReceiptRow>(
      `SELECT id, message_type, recipient_tevi_subject, player_id, source_event_id,
              source_correlation_key, amount, cashout_status, status, dispatch_attempt_count,
              failure_reason, provider_status_code, provider_response_summary_json,
              message_body_preview, request_id, created_at, updated_at, sent_at
       FROM tevi_message_receipt_records
       WHERE message_type = $1 AND source_correlation_key = $2`,
      [input.messageType, input.sourceCorrelationKey]
    );
    const existingRow = existing.rows[0];
    if (existingRow) {
      return { record: rowToRecord(existingRow), created: false };
    }

    const receiptId = newReceiptId();
    const now = input.createdAt;
    await this.pool.query(
      `INSERT INTO tevi_message_receipt_records (
         id, message_type, recipient_tevi_subject, player_id, source_event_id,
         source_correlation_key, amount, cashout_status, status, dispatch_attempt_count,
         failure_reason, provider_status_code, provider_response_summary_json,
         message_body_preview, request_id, created_at, updated_at, sent_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, 'pending', 0,
         NULL, NULL, '{}'::jsonb, $9, $10, $11, $11, NULL
       )`,
      [
        receiptId,
        input.messageType,
        input.recipientTeviSubject,
        input.playerId,
        input.sourceEventId,
        input.sourceCorrelationKey,
        input.amount,
        input.cashoutStatus,
        input.messageBodyPreview,
        input.requestId,
        now
      ]
    );

    const inserted = await this.pool.query<ReceiptRow>(
      `SELECT id, message_type, recipient_tevi_subject, player_id, source_event_id,
              source_correlation_key, amount, cashout_status, status, dispatch_attempt_count,
              failure_reason, provider_status_code, provider_response_summary_json,
              message_body_preview, request_id, created_at, updated_at, sent_at
       FROM tevi_message_receipt_records
       WHERE id = $1`,
      [receiptId]
    );
    const insertedRow = inserted.rows[0];
    if (!insertedRow) {
      throw new Error("Failed to load inserted message receipt record.");
    }
    return { record: rowToRecord(insertedRow), created: true };
  }

  public async recordDispatchOutcome(
    receiptId: string,
    outcome: {
      status: TeviMessageReceiptStatus;
      failureReason: string | null;
      providerStatusCode: number | null;
      providerResponseSummary: Record<string, unknown>;
      sentAt: Date | null;
    }
  ): Promise<void> {
    const now = this.clock.now();
    await this.pool.query(
      `UPDATE tevi_message_receipt_records
       SET status = $2,
           dispatch_attempt_count = dispatch_attempt_count + 1,
           failure_reason = $3,
           provider_status_code = $4,
           provider_response_summary_json = $5::jsonb,
           sent_at = $6,
           updated_at = $7
       WHERE id = $1`,
      [
        receiptId,
        outcome.status,
        outcome.failureReason,
        outcome.providerStatusCode,
        JSON.stringify(outcome.providerResponseSummary),
        outcome.sentAt,
        now
      ]
    );
  }

  public async findById(receiptId: string): Promise<TeviMessageReceiptRecord | null> {
    const result = await this.pool.query<ReceiptRow>(
      `SELECT id, message_type, recipient_tevi_subject, player_id, source_event_id,
              source_correlation_key, amount, cashout_status, status, dispatch_attempt_count,
              failure_reason, provider_status_code, provider_response_summary_json,
              message_body_preview, request_id, created_at, updated_at, sent_at
       FROM tevi_message_receipt_records
       WHERE id = $1`,
      [receiptId]
    );
    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
  }

  public async findBySource(
    messageType: TeviMessageReceiptType,
    sourceCorrelationKey: string
  ): Promise<TeviMessageReceiptRecord | null> {
    const result = await this.pool.query<ReceiptRow>(
      `SELECT id, message_type, recipient_tevi_subject, player_id, source_event_id,
              source_correlation_key, amount, cashout_status, status, dispatch_attempt_count,
              failure_reason, provider_status_code, provider_response_summary_json,
              message_body_preview, request_id, created_at, updated_at, sent_at
       FROM tevi_message_receipt_records
       WHERE message_type = $1 AND source_correlation_key = $2`,
      [messageType, sourceCorrelationKey]
    );
    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
  }

  public async searchRecords(filters: TeviMessageReceiptSearchFilters): Promise<TeviMessageReceiptSearchResult> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.playerId) {
      params.push(filters.playerId);
      conditions.push(`player_id = $${params.length}`);
    }
    if (filters.receiptId) {
      params.push(filters.receiptId);
      conditions.push(`id = $${params.length}`);
    }
    if (filters.sourceEventId) {
      params.push(filters.sourceEventId);
      conditions.push(`source_event_id = $${params.length}`);
    }
    if (filters.messageType) {
      params.push(filters.messageType);
      conditions.push(`message_type = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filters.from) {
      params.push(filters.from);
      conditions.push(`created_at >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      conditions.push(`created_at <= $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countResult = await this.pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM tevi_message_receipt_records ${whereClause}`,
      params
    );

    params.push(filters.limit);
    params.push(filters.offset);
    const listResult = await this.pool.query<ReceiptRow>(
      `SELECT id, message_type, recipient_tevi_subject, player_id, source_event_id,
              source_correlation_key, amount, cashout_status, status, dispatch_attempt_count,
              failure_reason, provider_status_code, provider_response_summary_json,
              message_body_preview, request_id, created_at, updated_at, sent_at
       FROM tevi_message_receipt_records
       ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params
    );

    return {
      records: listResult.rows.map(rowToRecord),
      total: Number(countResult.rows[0]?.total ?? 0)
    };
  }
}

function rowToRecord(row: ReceiptRow): TeviMessageReceiptRecord {
  return {
    receiptId: row.id,
    messageType: row.message_type,
    recipientTeviSubject: row.recipient_tevi_subject,
    playerId: row.player_id,
    sourceEventId: row.source_event_id,
    sourceCorrelationKey: row.source_correlation_key,
    amount: row.amount === null ? null : Number(row.amount),
    cashoutStatus: row.cashout_status,
    status: row.status,
    dispatchAttemptCount: row.dispatch_attempt_count,
    failureReason: row.failure_reason,
    providerStatusCode: row.provider_status_code,
    providerResponseSummary: row.provider_response_summary_json ?? {},
    messageBodyPreview: row.message_body_preview,
    requestId: row.request_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at
  };
}
