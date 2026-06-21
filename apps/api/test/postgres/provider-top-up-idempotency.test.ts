import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPostgresPool } from "../../src/db/pool.js";
import { MigrationRunner } from "../../src/db/migrations.js";
import { PostgresPlayerSessionRepository } from "../../src/repositories/postgres/player-session-repository.js";
import { PostgresProviderTopUpIdempotencyRepository } from "../../src/repositories/postgres/provider-top-up-idempotency-repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;
let pool: ReturnType<typeof createPostgresPool> | undefined;

const clock = {
  current: new Date("2026-06-21T00:00:00.000Z"),
  now() {
    return this.current;
  },
  tick(milliseconds: number) {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
};

beforeEach(async () => {
  if (!testDatabaseUrl) {
    return;
  }

  assertSafeTestDatabaseUrl(testDatabaseUrl);
  pool = createPostgresPool(testDatabaseUrl);
  await resetPublicSchema();
  await new MigrationRunner({ pool: requirePool() }).migrateUp();
  clock.current = new Date("2026-06-21T00:00:00.000Z");
});

afterEach(async () => {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
});

describePostgres("PostgresProviderTopUpIdempotencyRepository", () => {
  it("creates pending records, reads them after reconstruction, and preserves non-cash point metadata", async () => {
    const players = new PostgresPlayerSessionRepository(requirePool());
    const player = await players.resolvePlayer({
      provider: "local",
      subject: "player-1",
      displayName: "Player One",
      expiresAt: "2026-06-22T00:00:00.000Z"
    }, clock.now());
    const repository = new PostgresProviderTopUpIdempotencyRepository(requirePool(), clock);

    const reservation = await repository.createOrGet({
      providerName: "tevi",
      providerEventId: "event-1",
      normalizedIdempotencyKey: "tevi:event-1",
      playerId: player.playerId,
      pointAmount: 250,
      pointsMetadata: { pointUnit: "community_points", source: "future_provider" },
      providerMetadata: { deliveryMode: "future_webhook", rawKind: "top_up_notice" }
    });

    expect(reservation.created).toBe(true);
    expect(reservation.duplicateReason).toBe("none");
    expect(reservation.record).toMatchObject({
      providerName: "tevi",
      providerEventId: "event-1",
      normalizedIdempotencyKey: "tevi:event-1",
      playerId: player.playerId,
      status: "pending",
      pointAmount: 250,
      pointsMetadata: { pointUnit: "community_points", source: "future_provider" }
    });
    expect(JSON.stringify(reservation.record)).not.toMatch(/cash|redemption|currency/i);

    const reconstructed = new PostgresProviderTopUpIdempotencyRepository(requirePool(), clock);
    await expect(reconstructed.getByProviderEvent("tevi", "event-1")).resolves.toEqual(reservation.record);
    await expect(reconstructed.getByIdempotencyKey("tevi", "tevi:event-1")).resolves.toEqual(reservation.record);
  });

  it("records unknown-player provider events with null player mapping", async () => {
    const repository = new PostgresProviderTopUpIdempotencyRepository(requirePool(), clock);

    const reservation = await repository.createOrGet({
      providerName: "tevi",
      providerEventId: "event-unknown-player",
      normalizedIdempotencyKey: "tevi:event-unknown-player",
      pointAmount: null,
      providerMetadata: { reason: "identity_not_mapped_yet" }
    });

    expect(reservation.record.playerId).toBeNull();
    expect(reservation.record.pointAmount).toBeNull();
  });

  it("detects duplicate provider events without overwriting the original payload", async () => {
    const repository = new PostgresProviderTopUpIdempotencyRepository(requirePool(), clock);
    const first = await repository.createOrGet({
      providerName: "tevi",
      providerEventId: "event-duplicate",
      normalizedIdempotencyKey: "tevi:event-duplicate",
      pointAmount: 100,
      providerMetadata: { original: true }
    });
    clock.tick(1000);

    const duplicate = await repository.createOrGet({
      providerName: "tevi",
      providerEventId: "event-duplicate",
      normalizedIdempotencyKey: "tevi:event-duplicate-changed",
      pointAmount: 999,
      providerMetadata: { original: false, attemptedOverwrite: true }
    });

    expect(duplicate.created).toBe(false);
    expect(duplicate.duplicateReason).toBe("provider_event");
    expect(duplicate.record.id).toBe(first.record.id);
    expect(duplicate.record.pointAmount).toBe(100);
    expect(duplicate.record.providerMetadata).toEqual({ original: true });
    expect(duplicate.record.lastSeenAt).toBe(first.record.lastSeenAt);
  });

  it("detects duplicate idempotency keys across different provider events", async () => {
    const repository = new PostgresProviderTopUpIdempotencyRepository(requirePool(), clock);
    const first = await repository.createOrGet({
      providerName: "tevi",
      providerEventId: "event-key-1",
      normalizedIdempotencyKey: "shared-key",
      pointAmount: 50
    });

    const duplicate = await repository.createOrGet({
      providerName: "tevi",
      providerEventId: "event-key-2",
      normalizedIdempotencyKey: "shared-key",
      pointAmount: 75
    });

    expect(duplicate.created).toBe(false);
    expect(duplicate.duplicateReason).toBe("idempotency_key");
    expect(duplicate.record.id).toBe(first.record.id);
  });

  it("marks records completed, failed, ignored, and duplicate without wallet crediting", async () => {
    const repository = new PostgresProviderTopUpIdempotencyRepository(requirePool(), clock);
    await repository.createOrGet({ providerName: "tevi", providerEventId: "complete-event", normalizedIdempotencyKey: "complete-key", pointAmount: 10 });
    await repository.createOrGet({ providerName: "tevi", providerEventId: "failed-event", normalizedIdempotencyKey: "failed-key", pointAmount: 20 });
    await repository.createOrGet({ providerName: "tevi", providerEventId: "ignored-event", normalizedIdempotencyKey: "ignored-key" });
    await repository.createOrGet({ providerName: "tevi", providerEventId: "duplicate-event", normalizedIdempotencyKey: "duplicate-key" });

    clock.tick(1000);
    const completed = await repository.markCompleted({
      providerName: "tevi",
      providerEventId: "complete-event",
      pointsMetadata: { reconciliationState: "reserved_only" },
      providerMetadata: { finalNotice: true }
    });
    const failed = await repository.markFailed({ providerName: "tevi", providerEventId: "failed-event", failureReason: "provider rejected event" });
    const ignored = await repository.markIgnored({ providerName: "tevi", providerEventId: "ignored-event", failureReason: "unsupported future event" });
    const duplicate = await repository.markDuplicate({
      providerName: "tevi",
      providerEventId: "duplicate-event",
      failureReason: "same provider event already reserved",
      duplicateOfId: completed.id
    });

    expect(completed).toMatchObject({ status: "completed", completedAt: "2026-06-21T00:00:01.000Z", failureReason: null });
    expect(completed.pointsMetadata).toEqual({ reconciliationState: "reserved_only" });
    expect(failed).toMatchObject({ status: "failed", failureReason: "provider rejected event" });
    expect(ignored).toMatchObject({ status: "ignored", failureReason: "unsupported future event" });
    expect(duplicate).toMatchObject({ status: "duplicate", failureReason: "same provider event already reserved" });
    expect(duplicate.providerMetadata).toEqual({ duplicateOfId: completed.id });

    const walletTables = await requirePool().query<{ count: string }>("SELECT count(*)::text AS count FROM wallet_transactions");
    expect(walletTables.rows[0]?.count).toBe("0");
  });

  it("merges metadata on completion without replacing original fields", async () => {
    const repository = new PostgresProviderTopUpIdempotencyRepository(requirePool(), clock);
    await repository.createOrGet({
      providerName: "tevi",
      providerEventId: "merge-event",
      normalizedIdempotencyKey: "merge-key",
      pointsMetadata: { original: "value", shared: "initial" },
      providerMetadata: { source: "future_provider" }
    });

    const completed = await repository.markCompleted({
      providerName: "tevi",
      providerEventId: "merge-event",
      pointsMetadata: { shared: "updated", added: "new" },
      providerMetadata: { finalNotice: true }
    });

    expect(completed.pointsMetadata).toEqual({ original: "value", shared: "updated", added: "new" });
    expect(completed.providerMetadata).toEqual({ source: "future_provider", finalNotice: true });
  });

  it("enforces provider event uniqueness in the database", async () => {
    const repository = new PostgresProviderTopUpIdempotencyRepository(requirePool(), clock);
    await repository.createOrGet({ providerName: "tevi", providerEventId: "raw-event", normalizedIdempotencyKey: "raw-key" });

    await expect(requirePool().query(
      `INSERT INTO provider_top_up_idempotency_records (
         id, provider_name, provider_event_id, normalized_idempotency_key, status, first_seen_at, last_seen_at
       ) VALUES ('manual-duplicate', 'tevi', 'raw-event', 'raw-other-key', 'pending', now(), now())`
    )).rejects.toMatchObject({ code: "23505" });
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
