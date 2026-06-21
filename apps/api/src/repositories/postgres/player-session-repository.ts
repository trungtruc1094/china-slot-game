import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ApiHttpError } from "../../middleware/error-handler.js";
import type { SessionIdentityInput } from "../../schemas/session.schema.js";
import type { PlayerRecord, PlayerSessionRepository, SessionRecordLike, SessionSearchFilters } from "../../domain/player-identity.js";
import { withTransaction } from "../../db/transactions.js";

interface PlayerIdentityRow {
  player_id: string;
  provider: string;
  subject: string;
  display_name: string | null;
}

interface SessionRow {
  id: string;
  player_id: string;
  status: "active" | "expired";
  created_at: Date;
  expires_at: Date;
  request_metadata: Record<string, unknown>;
}

export class PostgresPlayerSessionRepository implements PlayerSessionRepository {
  public constructor(private readonly pool: Pool) {}

  public async resolvePlayer(input: SessionIdentityInput, now: Date): Promise<PlayerRecord> {
    const expiresAtMs = Date.parse(input.expiresAt);
    if (Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime()) {
      throw new ApiHttpError(401, {
        code: "UNAUTHENTICATED",
        message: "Identity assertion has expired.",
        details: { provider: input.provider }
      });
    }

    try {
      return await withTransaction(this.pool, async (client) => {
      const existing = await this.findIdentity(client, input.provider, input.subject);
      if (existing) {
        await client.query(
          `UPDATE provider_identity_mappings SET display_name = COALESCE($1, display_name), last_seen_at = $2 WHERE provider = $3 AND subject = $4`,
          [input.displayName ?? null, now, input.provider, input.subject]
        );
        return rowToPlayer(existing);
      }

      const playerId = `player_${randomUUID()}`;
      const mappingId = `identity_${randomUUID()}`;
      await client.query(
        `INSERT INTO players (id, display_name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
        [playerId, input.displayName ?? null, now]
      );
      await client.query(
        `INSERT INTO provider_identity_mappings (id, player_id, provider, subject, display_name, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [mappingId, playerId, input.provider, input.subject, input.displayName ?? null, now]
      );

      return {
        playerId,
        provider: input.provider,
        subject: input.subject,
        ...(input.displayName ? { displayName: input.displayName } : {})
      };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findIdentityFromPool(input.provider, input.subject);
        if (existing) {
          return rowToPlayer(existing);
        }
      }

      throw error;
    }
  }

  public async createSession(playerId: string, now: Date, expiresAt: Date, metadata: Record<string, unknown> = {}): Promise<SessionRecordLike> {
    const sessionId = `sess_${randomUUID()}`;
    const result = await this.pool.query<SessionRow>(
      `INSERT INTO sessions (id, player_id, status, created_at, expires_at, request_metadata)
       VALUES ($1, $2, 'active', $3, $4, $5)
       RETURNING id, player_id, status, created_at, expires_at, request_metadata`,
      [sessionId, playerId, now, expiresAt, metadata]
    );

    return rowToSession(requireRow(result.rows[0]));
  }

  public async findSessionForResume(sessionId: string, playerId: string, now: Date): Promise<SessionRecordLike | undefined> {
    await this.expireSession(sessionId, now);
    const result = await this.pool.query<SessionRow>(
      `SELECT id, player_id, status, created_at, expires_at, request_metadata
       FROM sessions
       WHERE id = $1 AND player_id = $2`,
      [sessionId, playerId]
    );

    return result.rows[0] ? rowToSession(result.rows[0]) : undefined;
  }

  public async getActiveSession(sessionId: string, now: Date): Promise<SessionRecordLike | undefined> {
    await this.expireSession(sessionId, now);
    const result = await this.pool.query<SessionRow>(
      `SELECT id, player_id, status, created_at, expires_at, request_metadata
       FROM sessions
       WHERE id = $1`,
      [sessionId]
    );

    return result.rows[0] ? rowToSession(result.rows[0]) : undefined;
  }

  public async searchSessions(filters: SessionSearchFilters = {}): Promise<SessionRecordLike[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.playerId) {
      values.push(filters.playerId);
      conditions.push(`s.player_id = $${values.length}`);
    }
    if (filters.status) {
      values.push(filters.status);
      conditions.push(`s.status = $${values.length}`);
    }
    if (filters.createdFrom) {
      values.push(filters.createdFrom);
      conditions.push(`s.created_at >= $${values.length}`);
    }
    if (filters.createdTo) {
      values.push(filters.createdTo);
      conditions.push(`s.created_at <= $${values.length}`);
    }
    if (filters.provider) {
      values.push(filters.provider);
      conditions.push(`pim.provider = $${values.length}`);
    }
    if (filters.subject) {
      values.push(filters.subject);
      conditions.push(`pim.subject = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.pool.query<SessionRow>(
      `SELECT DISTINCT s.id, s.player_id, s.status, s.created_at, s.expires_at, s.request_metadata
       FROM sessions s
       LEFT JOIN provider_identity_mappings pim ON pim.player_id = s.player_id
       ${whereClause}
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT 100`,
      values
    );

    return result.rows.map(rowToSession);
  }

  private async findIdentity(client: PoolClient, provider: string, subject: string): Promise<PlayerIdentityRow | undefined> {
    const result = await client.query<PlayerIdentityRow>(
      `SELECT player_id, provider, subject, display_name
       FROM provider_identity_mappings
       WHERE provider = $1 AND subject = $2`,
      [provider, subject]
    );

    return result.rows[0];
  }

  private async findIdentityFromPool(provider: string, subject: string): Promise<PlayerIdentityRow | undefined> {
    const result = await this.pool.query<PlayerIdentityRow>(
      `SELECT player_id, provider, subject, display_name
       FROM provider_identity_mappings
       WHERE provider = $1 AND subject = $2`,
      [provider, subject]
    );

    return result.rows[0];
  }

  private async expireSession(sessionId: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE sessions
       SET status = 'expired'
       WHERE id = $1 AND status = 'active' AND expires_at <= $2`,
      [sessionId, now]
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "23505"
    && "constraint" in error
    && error.constraint === "provider_identity_mappings_unique_provider_subject";
}

function rowToPlayer(row: PlayerIdentityRow): PlayerRecord {
  return {
    playerId: row.player_id,
    provider: row.provider,
    subject: row.subject,
    ...(row.display_name ? { displayName: row.display_name } : {})
  };
}

function rowToSession(row: SessionRow): SessionRecordLike {
  return {
    sessionId: row.id,
    playerId: row.player_id,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    requestMetadata: row.request_metadata
  };
}

function requireRow(row: SessionRow | undefined): SessionRow {
  if (!row) {
    throw new Error("Expected PostgreSQL session row.");
  }

  return row;
}