import { describe, expect, it } from "vitest";
import { InMemoryPlayerSessionRepository } from "../../src/domain/player-identity.js";

describe("InMemoryPlayerSessionRepository", () => {
  it("keeps provider subjects distinct and applies provider/subject search filters", async () => {
    const repository = new InMemoryPlayerSessionRepository();
    const now = new Date("2026-06-21T08:00:00.000Z");
    const demoPlayer = await repository.resolvePlayer({
      provider: "demo",
      subject: "same-subject",
      expiresAt: "2026-06-21T09:00:00.000Z"
    }, now);
    const teviPlayer = await repository.resolvePlayer({
      provider: "tevi",
      subject: "same-subject",
      expiresAt: "2026-06-21T09:00:00.000Z"
    }, now);

    await repository.createSession(demoPlayer.playerId, now, new Date("2026-06-21T09:00:00.000Z"), {
      provider: "demo",
      subject: "same-subject"
    });
    await repository.createSession(teviPlayer.playerId, now, new Date("2026-06-21T09:00:00.000Z"), {
      provider: "tevi",
      subject: "same-subject"
    });

    const demoSessions = await repository.searchSessions({ provider: "demo", subject: "same-subject" });
    const teviSessions = await repository.searchSessions({ provider: "tevi", subject: "same-subject" });

    expect(demoPlayer.playerId).not.toBe(teviPlayer.playerId);
    expect(demoSessions).toHaveLength(1);
    expect(demoSessions[0]?.playerId).toBe(demoPlayer.playerId);
    expect(teviSessions).toHaveLength(1);
    expect(teviSessions[0]?.playerId).toBe(teviPlayer.playerId);
  });
});