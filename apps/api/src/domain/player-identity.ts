import { ApiHttpError } from "../middleware/error-handler.js";
import type { SessionIdentityInput } from "../schemas/session.schema.js";

export interface PlayerRecord {
  playerId: string;
  provider: string;
  subject: string;
  displayName?: string;
}

export interface PlayerIdentityAdapter {
  resolve(input: SessionIdentityInput, now: Date): PlayerRecord;
}

export interface PlayerSessionRepository {
  resolvePlayer(input: SessionIdentityInput, now: Date): Promise<PlayerRecord>;
  // Read-only identity lookup: returns the player mapped to a provider subject without ever creating one.
  // Used by the Tevi webhook credit path (Story 8.6) — an unknown user is a safe failure, never an auto-create.
  findPlayerByProviderSubject(provider: string, subject: string): Promise<PlayerRecord | null>;
  createSession(playerId: string, now: Date, expiresAt: Date, metadata?: Record<string, unknown>): Promise<SessionRecordLike>;
  findSessionForResume(sessionId: string, playerId: string, now: Date): Promise<SessionRecordLike | undefined>;
  getActiveSession(sessionId: string, now: Date): Promise<SessionRecordLike | undefined>;
  searchSessions(filters?: SessionSearchFilters): Promise<SessionRecordLike[]>;
}

export interface SessionRecordLike {
  sessionId: string;
  playerId: string;
  status: "active" | "expired";
  createdAt: Date;
  expiresAt: Date;
  requestMetadata?: Record<string, unknown>;
}

export interface SessionSearchFilters {
  playerId?: string;
  provider?: string;
  subject?: string;
  status?: "active" | "expired";
  createdFrom?: Date;
  createdTo?: Date;
}

export class InMemoryPlayerIdentityAdapter implements PlayerIdentityAdapter {
  private readonly playersByProvider = new Map<string, Map<string, PlayerRecord>>();

  public findByProviderSubject(provider: string, subject: string): PlayerRecord | null {
    return this.playersByProvider.get(provider)?.get(subject) ?? null;
  }

  public resolve(input: SessionIdentityInput, now: Date): PlayerRecord {
    if (Date.parse(input.expiresAt) <= now.getTime()) {
      throw new ApiHttpError(401, {
        code: "UNAUTHENTICATED",
        message: "Identity assertion has expired.",
        details: { provider: input.provider }
      });
    }

    let playersBySubject = this.playersByProvider.get(input.provider);

    if (!playersBySubject) {
      playersBySubject = new Map<string, PlayerRecord>();
      this.playersByProvider.set(input.provider, playersBySubject);
    }

    const existingPlayer = playersBySubject.get(input.subject);

    if (existingPlayer) {
      return existingPlayer;
    }

    const player: PlayerRecord = {
      playerId: `player_${this.playerCount() + 1}`,
      provider: input.provider,
      subject: input.subject,
      ...(input.displayName ? { displayName: input.displayName } : {})
    };
    playersBySubject.set(input.subject, player);
    return player;
  }

  private playerCount(): number {
    let count = 0;

    for (const playersBySubject of this.playersByProvider.values()) {
      count += playersBySubject.size;
    }

    return count;
  }
}

export class InMemoryPlayerSessionRepository implements PlayerSessionRepository {
  private readonly identityAdapter = new InMemoryPlayerIdentityAdapter();
  private readonly sessionsById = new Map<string, SessionRecordLike>();

  public async resolvePlayer(input: SessionIdentityInput, now: Date): Promise<PlayerRecord> {
    return this.identityAdapter.resolve(input, now);
  }

  public async findPlayerByProviderSubject(provider: string, subject: string): Promise<PlayerRecord | null> {
    return this.identityAdapter.findByProviderSubject(provider, subject);
  }

  public async createSession(playerId: string, now: Date, expiresAt: Date, metadata: Record<string, unknown> = {}): Promise<SessionRecordLike> {
    const session: SessionRecordLike = {
      sessionId: `sess_${this.sessionsById.size + 1}`,
      playerId,
      status: "active",
      createdAt: now,
      expiresAt,
      requestMetadata: metadata
    };
    this.sessionsById.set(session.sessionId, session);
    return session;
  }

  public async findSessionForResume(sessionId: string, playerId: string, now: Date): Promise<SessionRecordLike | undefined> {
    const session = this.sessionsById.get(sessionId);
    if (!session || session.playerId !== playerId) {
      return undefined;
    }

    return this.refreshExpiry(session, now);
  }

  public async getActiveSession(sessionId: string, now: Date): Promise<SessionRecordLike | undefined> {
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      return undefined;
    }

    return this.refreshExpiry(session, now);
  }

  public async searchSessions(filters: SessionSearchFilters = {}): Promise<SessionRecordLike[]> {
    return [...this.sessionsById.values()].filter((session) => {
      if (filters.playerId && session.playerId !== filters.playerId) {
        return false;
      }
      if (filters.status && session.status !== filters.status) {
        return false;
      }
      if (filters.createdFrom && session.createdAt < filters.createdFrom) {
        return false;
      }
      if (filters.createdTo && session.createdAt > filters.createdTo) {
        return false;
      }
      if (filters.provider && session.requestMetadata?.provider !== filters.provider) {
        return false;
      }
      if (filters.subject && session.requestMetadata?.subject !== filters.subject) {
        return false;
      }
      return true;
    });
  }

  private refreshExpiry(session: SessionRecordLike, now: Date): SessionRecordLike {
    if (session.expiresAt.getTime() <= now.getTime()) {
      session.status = "expired";
    }

    return session;
  }
}
