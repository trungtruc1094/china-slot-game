import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPostgresPool } from "../../src/db/pool.js";
import { MigrationRunner } from "../../src/db/migrations.js";
import { PostgresPlayerSessionRepository } from "../../src/repositories/postgres/player-session-repository.js";
import { SessionService, type Clock } from "../../src/domain/session-service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;
let pool: ReturnType<typeof createPostgresPool> | undefined;

class MutableClock implements Clock {
  public current = new Date("2026-06-21T08:00:00.000Z");

  public now(): Date {
    return this.current;
  }
}

beforeEach(async () => {
  if (!testDatabaseUrl) {
    return;
  }

  assertSafeTestDatabaseUrl(testDatabaseUrl);
  pool = createPostgresPool(testDatabaseUrl);
  await resetPublicSchema();
  await new MigrationRunner({ pool }).migrateUp();
});

afterEach(async () => {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
});

describePostgres("PostgresPlayerSessionRepository", () => {
  it("persists stable provider mappings, distinct providers, and resumable sessions", async () => {
    const clock = new MutableClock();
    const service = new SessionService(new PostgresPlayerSessionRepository(requirePool()), clock);

    const first = await service.createOrResume({ identity: identity({ provider: "demo", subject: "same-subject" }) });
    const second = await service.createOrResume({ identity: identity({ provider: "demo", subject: "same-subject" }) });
    const otherProvider = await service.createOrResume({ identity: identity({ provider: "tevi", subject: "same-subject" }) });
    const resumed = await service.createOrResume({
      identity: identity({ provider: "demo", subject: "same-subject" }),
      resumeSessionId: first.response.sessionId
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.response.playerId).toBe(first.response.playerId);
    expect(second.response.sessionId).not.toBe(first.response.sessionId);
    expect(otherProvider.response.playerId).not.toBe(first.response.playerId);
    expect(resumed.statusCode).toBe(200);
    expect(resumed.response).toMatchObject({
      sessionId: first.response.sessionId,
      playerId: first.response.playerId,
      session: { resumed: true }
    });

    await expect(service.createOrResume({
      identity: identity({ provider: "tevi", subject: "same-subject" }),
      resumeSessionId: first.response.sessionId
    })).rejects.toMatchObject({
      statusCode: 404,
      apiError: { code: "SESSION_NOT_FOUND" }
    });
  });

  it("resolves concurrent duplicate provider identities to one player", async () => {
    const clock = new MutableClock();
    const service = new SessionService(new PostgresPlayerSessionRepository(requirePool()), clock);

    const results = await Promise.all([
      service.createOrResume({ identity: identity({ subject: "concurrent-player" }) }),
      service.createOrResume({ identity: identity({ subject: "concurrent-player" }) }),
      service.createOrResume({ identity: identity({ subject: "concurrent-player" }) })
    ]);

    expect(new Set(results.map((result) => result.response.playerId)).size).toBe(1);
    const identityCount = await requirePool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM provider_identity_mappings WHERE provider = 'demo' AND subject = 'concurrent-player'`
    );
    expect(identityCount.rows[0]?.count).toBe("1");
  });

  it("enforces expiry through the expires_at column and keeps expired sessions searchable", async () => {
    const clock = new MutableClock();
    const service = new SessionService(new PostgresPlayerSessionRepository(requirePool()), clock);
    const created = await service.createOrResume({ identity: identity() });

    clock.current = new Date("2026-06-21T09:00:00.000Z");
    await expect(service.getActiveSession(created.response.sessionId)).rejects.toMatchObject({
      statusCode: 401,
      apiError: { code: "SESSION_EXPIRED" }
    });

    const expiredSessions = await service.searchSessions({ status: "expired", provider: "demo", subject: "player-123" });
    expect(expiredSessions).toEqual([
      expect.objectContaining({
        sessionId: created.response.sessionId,
        playerId: created.response.playerId,
        status: "expired"
      })
    ]);
  });

  it("recovers active sessions after repository reconstruction", async () => {
    const clock = new MutableClock();
    const firstService = new SessionService(new PostgresPlayerSessionRepository(requirePool()), clock);
    const created = await firstService.createOrResume({ identity: identity() });

    const secondService = new SessionService(new PostgresPlayerSessionRepository(requirePool()), clock);
    const activeSession = await secondService.getActiveSession(created.response.sessionId);
    const resumed = await secondService.createOrResume({
      identity: identity(),
      resumeSessionId: created.response.sessionId
    });

    expect(activeSession).toMatchObject({
      sessionId: created.response.sessionId,
      playerId: created.response.playerId,
      status: "active"
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.response.playerId).toBe(created.response.playerId);
  });

  it("enforces DB-level foreign keys with restricted deletes", async () => {
    const service = new SessionService(new PostgresPlayerSessionRepository(requirePool()), new MutableClock());
    const created = await service.createOrResume({ identity: identity() });

    await expect(requirePool().query("DELETE FROM players WHERE id = $1", [created.response.playerId]))
      .rejects
      .toMatchObject({ code: "23001" });
  });
});

async function resetPublicSchema(): Promise<void> {
  await requirePool().query("DROP SCHEMA public CASCADE");
  await requirePool().query("CREATE SCHEMA public");
}

function requirePool(): ReturnType<typeof createPostgresPool> {
  if (!pool) {
    throw new Error("PostgreSQL test pool was not initialized.");
  }

  return pool;
}

function assertSafeTestDatabaseUrl(databaseUrl: string): void {
  const parsedUrl = new URL(databaseUrl);
  const databaseName = parsedUrl.pathname.replace(/^\//, "");

  if (databaseName !== "china_slot_test" && !databaseName.endsWith("_test") && !databaseName.startsWith("test_")) {
    throw new Error("PostgreSQL integration tests require a dedicated test database name ending with _test or starting with test_.");
  }
}

function identity(overrides: Partial<{ provider: string; subject: string; displayName: string; expiresAt: string }> = {}) {
  return {
    provider: "demo",
    subject: "player-123",
    displayName: "Player 123",
    expiresAt: "2026-06-21T10:00:00.000Z",
    ...overrides
  };
}