import { ApiHttpError } from "../middleware/error-handler.js";
import type { CreateSessionRequest, SessionResponse } from "../schemas/session.schema.js";
import type { PlayerIdentityAdapter, PlayerRecord } from "./player-identity.js";
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

export class SessionService {
  private readonly sessionsById = new Map<string, SessionRecord>();

  public constructor(
    private readonly identityAdapter: PlayerIdentityAdapter,
    private readonly clock: Clock = new SystemClock()
  ) {}

  public createOrResume(request: CreateSessionRequest): { statusCode: 200 | 201; response: SessionResponse } {
    if (!request.identity) {
      throw new ApiHttpError(400, {
        code: "INVALID_IDENTITY",
        message: "Session identity payload is invalid.",
        details: {}
      });
    }

    const now = this.clock.now();
    const player = this.identityAdapter.resolve(request.identity, now);
    const session = request.resumeSessionId ? this.findSessionForResume(request.resumeSessionId, player, now) : undefined;

    if (session) {
      return {
        statusCode: 200,
        response: this.toResponse(session, true)
      };
    }

    const createdSession = this.createSession(player.playerId, now);
    return {
      statusCode: 201,
      response: this.toResponse(createdSession, false)
    };
  }

  public getActiveSession(sessionId: string): SessionRecord {
    const now = this.clock.now();
    const session = this.sessionsById.get(sessionId);

    if (!session) {
      throw new ApiHttpError(401, {
        code: "INVALID_SESSION",
        message: "A valid active session is required.",
        details: { sessionId }
      });
    }

    if (this.isExpired(session, now)) {
      session.status = "expired";
      throw new ApiHttpError(401, {
        code: "SESSION_EXPIRED",
        message: "Session has expired. Start a new session to continue.",
        details: { sessionId }
      });
    }

    return session;
  }

  private findSessionForResume(sessionId: string, player: PlayerRecord, now: Date): SessionRecord {
    const session = this.sessionsById.get(sessionId);

    if (!session || session.playerId !== player.playerId) {
      throw new ApiHttpError(404, {
        code: "SESSION_NOT_FOUND",
        message: "Session could not be found for this player.",
        details: { sessionId }
      });
    }

    if (this.isExpired(session, now)) {
      session.status = "expired";
      throw new ApiHttpError(401, {
        code: "SESSION_EXPIRED",
        message: "Session has expired. Start a new session to continue.",
        details: { sessionId }
      });
    }

    return session;
  }

  private createSession(playerId: string, now: Date): SessionRecord {
    const session: SessionRecord = {
      sessionId: `sess_${this.sessionsById.size + 1}`,
      playerId,
      status: "active",
      createdAt: now,
      expiresAt: new Date(now.getTime() + sessionTtlMs)
    };
    this.sessionsById.set(session.sessionId, session);
    return session;
  }

  private isExpired(session: SessionRecord, now: Date): boolean {
    return session.expiresAt.getTime() <= now.getTime();
  }

  private toResponse(session: SessionRecord, resumed: boolean): SessionResponse {
    return {
      sessionId: session.sessionId,
      playerId: session.playerId,
      balance: {
        points: starterBalancePoints
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
