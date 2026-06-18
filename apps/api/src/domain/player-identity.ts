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

export class InMemoryPlayerIdentityAdapter implements PlayerIdentityAdapter {
  private readonly playersByProvider = new Map<string, Map<string, PlayerRecord>>();

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
