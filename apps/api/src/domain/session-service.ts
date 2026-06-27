import { ApiHttpError } from "../middleware/error-handler.js";
import type { CreateSessionRequest, SessionResponse } from "../schemas/session.schema.js";
import { InMemoryPlayerSessionRepository, type PlayerIdentityAdapter, type PlayerRecord, type PlayerSessionRepository, type SessionSearchFilters } from "./player-identity.js";
import { getRewardModelMetadata } from "./reward-boundary.js";

export interface SessionRecord {
  sessionId: string;
  playerId: string;
  status: "active" | "expired";
  createdAt: Date;
  expiresAt: Date;
}

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}

const sessionTtlMs = 60 * 60 * 1000;
const starterBalancePoints = 1000;

interface SessionWalletReader {
  getWallet(playerId: string): { balance: number } | Promise<{ balance: number }>;
}

class StarterBalanceWalletReader implements SessionWalletReader {
  public getWallet(playerId: string): { playerId: string; balance: number } {
    return { playerId, balance: starterBalancePoints };
  }
}

export class SessionService {
  private readonly repository: PlayerSessionRepository;

  public constructor(
    identityAdapterOrRepository: PlayerIdentityAdapter | PlayerSessionRepository,
    private readonly clock: Clock = new SystemClock(),
    private readonly walletReader: SessionWalletReader = new StarterBalanceWalletReader()
  ) {
    this.repository = isPlayerSessionRepository(identityAdapterOrRepository)
      ? identityAdapterOrRepository
      : new LegacyIdentitySessionRepository(identityAdapterOrRepository);
  }

  public async createOrResume(request: CreateSessionRequest): Promise<{ statusCode: 200 | 201; response: SessionResponse }> {
    if (!request.identity) {
      throw new ApiHttpError(400, {
        code: "INVALID_IDENTITY",
        message: "Session identity payload is invalid.",
        details: {}
      });
    }

    const now = this.clock.now();
    const player = await this.repository.resolvePlayer(request.identity, now);
    const session = request.resumeSessionId ? await this.findSessionForResume(request.resumeSessionId, player, now) : undefined;

    if (session) {
      return {
        statusCode: 200,
        response: await this.toResponse(session, true)
      };
    }

    const createdSession = await this.createSession(player.playerId, now, {
      provider: request.identity.provider,
      subject: request.identity.subject
    });
    return {
      statusCode: 201,
      response: await this.toResponse(createdSession, false)
    };
  }

  public async getActiveSession(sessionId: string): Promise<SessionRecord> {
    const now = this.clock.now();
    const session = await this.repository.getActiveSession(sessionId, now);

    if (!session) {
      throw new ApiHttpError(401, {
        code: "INVALID_SESSION",
        message: "A valid active session is required.",
        details: { sessionId }
      });
    }

    if (session.status === "expired" || this.isExpired(session, now)) {
      throw new ApiHttpError(401, {
        code: "SESSION_EXPIRED",
        message: "Session has expired. Start a new session to continue.",
        details: { sessionId }
      });
    }

    return session;
  }

  public async searchSessions(filters: SessionSearchFilters = {}): Promise<SessionRecord[]> {
    return (await this.repository.searchSessions(filters)).map((session) => ({
      sessionId: session.sessionId,
      playerId: session.playerId,
      status: session.status,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt
    }));
  }

  private async findSessionForResume(sessionId: string, player: PlayerRecord, now: Date): Promise<SessionRecord> {
    const session = await this.repository.findSessionForResume(sessionId, player.playerId, now);

    if (!session || session.playerId !== player.playerId) {
      throw new ApiHttpError(404, {
        code: "SESSION_NOT_FOUND",
        message: "Session could not be found for this player.",
        details: { sessionId }
      });
    }

    if (session.status === "expired" || this.isExpired(session, now)) {
      throw new ApiHttpError(401, {
        code: "SESSION_EXPIRED",
        message: "Session has expired. Start a new session to continue.",
        details: { sessionId }
      });
    }

    return session;
  }

  private async createSession(playerId: string, now: Date, metadata: Record<string, unknown>): Promise<SessionRecord> {
    const session = await this.repository.createSession(playerId, now, new Date(now.getTime() + sessionTtlMs), metadata);
    return {
      sessionId: session.sessionId,
      playerId: session.playerId,
      status: session.status,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt
    };
  }

  private isExpired(session: SessionRecord, now: Date): boolean {
    return session.expiresAt.getTime() <= now.getTime();
  }

  private async toResponse(session: SessionRecord, resumed: boolean): Promise<SessionResponse> {
    const wallet = await this.walletReader.getWallet(session.playerId);

    return {
      sessionId: session.sessionId,
      playerId: session.playerId,
      balance: {
        points: wallet.balance
      },
      rewardModel: getRewardModelMetadata(),
      session: {
        status: "active",
        createdAt: session.createdAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        resumed
      }
    };
  }
}

class LegacyIdentitySessionRepository extends InMemoryPlayerSessionRepository {
  public constructor(private readonly legacyIdentityAdapter: PlayerIdentityAdapter) {
    super();
  }

  public override async resolvePlayer(input: Parameters<PlayerIdentityAdapter["resolve"]>[0], now: Date): Promise<PlayerRecord> {
    return this.legacyIdentityAdapter.resolve(input, now);
  }
}

function isPlayerSessionRepository(value: PlayerIdentityAdapter | PlayerSessionRepository): value is PlayerSessionRepository {
  return "resolvePlayer" in value;
}
