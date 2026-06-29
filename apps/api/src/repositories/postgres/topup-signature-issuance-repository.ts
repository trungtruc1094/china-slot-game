import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { TopupSignatureIssuanceInput, TopupSignatureIssuanceRecord, TopupSignatureIssuanceRepository, TopupSignatureStatus } from "../../domain/topup-service.js";

interface TopupSignatureIssuanceRow {
  id: string;
  provider_name: "tevi";
  player_id: string | null;
  tevi_subject: string | null;
  amount: string | null;
  request_id: string;
  deposit_token_fingerprint: string | null;
  status: TopupSignatureStatus;
  failure_reason: string | null;
  provider_status_code: number | null;
  provider_metadata_json: Record<string, unknown>;
  created_at: Date;
}

export class PostgresTopupSignatureIssuanceRepository implements TopupSignatureIssuanceRepository {
  public constructor(private readonly pool: Pool) {}

  public async create(input: TopupSignatureIssuanceInput): Promise<TopupSignatureIssuanceRecord> {
    const id = `topup_sig_${randomUUID()}`;
    const result = await this.pool.query<TopupSignatureIssuanceRow>(
      `INSERT INTO topup_signature_issuances (
         id, provider_name, player_id, tevi_subject, amount, request_id, deposit_token_fingerprint,
         status, failure_reason, provider_status_code, provider_metadata_json, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, provider_name, player_id, tevi_subject, amount, request_id, deposit_token_fingerprint,
                 status, failure_reason, provider_status_code, provider_metadata_json, created_at`,
      [
        id,
        input.providerName,
        input.playerId,
        input.teviSubject,
        input.amount,
        input.requestId,
        input.depositTokenFingerprint,
        input.status,
        input.failureReason,
        input.providerStatusCode,
        JSON.stringify(input.providerMetadata),
        input.createdAt
      ]
    );

    return rowToRecord(result.rows[0]);
  }

  public async findByRequestId(requestId: string): Promise<TopupSignatureIssuanceRecord[]> {
    const result = await this.pool.query<TopupSignatureIssuanceRow>(
      `SELECT id, provider_name, player_id, tevi_subject, amount, request_id, deposit_token_fingerprint,
              status, failure_reason, provider_status_code, provider_metadata_json, created_at
       FROM topup_signature_issuances
       WHERE request_id = $1
       ORDER BY created_at DESC, id DESC`,
      [requestId]
    );
    return result.rows.map(rowToRecord);
  }
}

function rowToRecord(row: TopupSignatureIssuanceRow | undefined): TopupSignatureIssuanceRecord {
  if (!row) {
    throw new Error("Top-up signature issuance row was not returned.");
  }

  return {
    id: row.id,
    providerName: row.provider_name,
    playerId: row.player_id,
    teviSubject: row.tevi_subject,
    amount: row.amount === null ? null : Number(row.amount),
    requestId: row.request_id,
    depositTokenFingerprint: row.deposit_token_fingerprint,
    status: row.status,
    failureReason: row.failure_reason,
    providerStatusCode: row.provider_status_code,
    providerMetadata: JSON.parse(JSON.stringify(row.provider_metadata_json)) as Record<string, unknown>,
    createdAt: row.created_at.toISOString()
  };
}
