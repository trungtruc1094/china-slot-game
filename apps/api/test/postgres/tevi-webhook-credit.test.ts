import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPostgresPool } from "../../src/db/pool.js";
import { MigrationRunner } from "../../src/db/migrations.js";
import { PostgresPlayerSessionRepository } from "../../src/repositories/postgres/player-session-repository.js";
import { PostgresProviderTopUpIdempotencyRepository } from "../../src/repositories/postgres/provider-top-up-idempotency-repository.js";
import { PostgresTeviWebhookCreditRepository } from "../../src/repositories/postgres/tevi-webhook-credit-repository.js";
import { TeviWebhookService } from "../../src/domain/tevi-webhook-service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;
let pool: ReturnType<typeof createPostgresPool> | undefined;

const clock = {
  current: new Date("2026-06-21T00:00:00.000Z"),
  now() {
    return this.current;
  }
};

const teviSubject = "633505726";

function topupPayload(overrides: { id?: string; amount?: number } = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? "evt_topup_1",
    event: "user_topup",
    space_id: "space_1",
    created_at: "2026-06-21T00:00:00.000Z",
    data: {
      user: teviSubject,
      amount: overrides.amount ?? 250,
      metadata: { app_id: "app_1", user_id: Number(teviSubject), type: "deposit" }
    }
  };
}

beforeEach(async () => {
  if (!testDatabaseUrl) {
    return;
  }
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  assertSafeTestDatabaseUrl(testDatabaseUrl);
  pool = createPostgresPool(testDatabaseUrl);
  await resetPublicSchema();
  await new MigrationRunner({ pool: requirePool() }).migrateUp();
  clock.current = new Date("2026-06-21T00:00:00.000Z");
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (pool) {
    await pool.end();
    pool = undefined;
  }
});

describePostgres("Tevi webhook atomic credit + replay", () => {
  it("commits wallet credit, the credit transaction, and idempotency completion atomically", async () => {
    const players = new PostgresPlayerSessionRepository(requirePool());
    const player = await mapTeviPlayer(players);
    const idempotency = new PostgresProviderTopUpIdempotencyRepository(requirePool(), clock);
    const credit = new PostgresTeviWebhookCreditRepository(requirePool(), clock);

    await idempotency.createOrGet({
      providerName: "tevi",
      providerEventId: "evt_topup_1",
      normalizedIdempotencyKey: "tevi:user_topup:evt_topup_1",
      playerId: player.playerId,
      pointAmount: 250
    });

    const result = await credit.creditTopupAtomically({
      providerEventId: "evt_topup_1",
      playerId: player.playerId,
      amount: 250,
      correlationId: "req_credit_1"
    });

    expect(result).toMatchObject({ credited: true, alreadyCompleted: false, balanceAfter: 1250 });

    const completed = await idempotency.getByProviderEvent("tevi", "evt_topup_1");
    expect(completed?.status).toBe("completed");
    expect(completed?.completedAt).not.toBeNull();
    await expectCreditRows(player.playerId, 1, 250);
    await expectBalance(player.playerId, 1250);
  });

  it("replays the same event N times with exactly one credit row and one completed record", async () => {
    const players = new PostgresPlayerSessionRepository(requirePool());
    const player = await mapTeviPlayer(players);
    const idempotency = new PostgresProviderTopUpIdempotencyRepository(requirePool(), clock);
    const credit = new PostgresTeviWebhookCreditRepository(requirePool(), clock);
    const service = new TeviWebhookService({ idempotencyRepository: idempotency, creditPort: credit, playerLookup: players });

    const deliveries = 4;
    const statuses: string[] = [];
    for (let i = 0; i < deliveries; i++) {
      const outcome = await service.process({ payload: topupPayload(), requestId: `req_replay_${i}` });
      statuses.push(outcome.status);
    }

    expect(statuses[0]).toBe("credited");
    expect(statuses.slice(1)).toEqual(["replayed", "replayed", "replayed"]);
    await expectCreditRows(player.playerId, 1, 250);
    await expectBalance(player.playerId, 1250);

    const completedCount = await requirePool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM provider_top_up_idempotency_records WHERE provider_event_id = 'evt_topup_1' AND status = 'completed'`
    );
    expect(completedCount.rows[0]?.count).toBe("1");
  });

  it("quarantines a conflicting payload as duplicate with no wallet mutation", async () => {
    const players = new PostgresPlayerSessionRepository(requirePool());
    const player = await mapTeviPlayer(players);
    const idempotency = new PostgresProviderTopUpIdempotencyRepository(requirePool(), clock);
    const credit = new PostgresTeviWebhookCreditRepository(requirePool(), clock);
    const service = new TeviWebhookService({ idempotencyRepository: idempotency, creditPort: credit, playerLookup: players });

    await service.process({ payload: topupPayload({ amount: 250 }), requestId: "req_first" });
    const conflict = await service.process({ payload: topupPayload({ amount: 9999 }), requestId: "req_conflict" });

    expect(conflict).toMatchObject({ status: "duplicate", reasonCode: "conflicting_payload" });
    await expectCreditRows(player.playerId, 1, 250);
    await expectBalance(player.playerId, 1250);
    // The conflicting redelivery is reported as duplicate but must NOT demote the already-completed credit.
    const record = await idempotency.getByProviderEvent("tevi", "evt_topup_1");
    expect(record?.status).toBe("completed");
  });

  it("fails an unknown user without crediting or auto-creating a player", async () => {
    const players = new PostgresPlayerSessionRepository(requirePool());
    const idempotency = new PostgresProviderTopUpIdempotencyRepository(requirePool(), clock);
    const credit = new PostgresTeviWebhookCreditRepository(requirePool(), clock);
    const service = new TeviWebhookService({ idempotencyRepository: idempotency, creditPort: credit, playerLookup: players });

    const result = await service.process({ payload: topupPayload(), requestId: "req_unknown" });

    expect(result).toMatchObject({ status: "failed", reasonCode: "unknown_user" });
    const walletCount = await requirePool().query<{ count: string }>("SELECT count(*)::text AS count FROM wallets");
    expect(walletCount.rows[0]?.count).toBe("0");
    const playerCount = await requirePool().query<{ count: string }>("SELECT count(*)::text AS count FROM players");
    expect(playerCount.rows[0]?.count).toBe("0");
  });
});

async function mapTeviPlayer(players: PostgresPlayerSessionRepository): Promise<{ playerId: string }> {
  return players.resolvePlayer({
    provider: "tevi",
    subject: teviSubject,
    displayName: "Tevi Player",
    expiresAt: "2026-06-22T00:00:00.000Z"
  }, clock.now());
}

async function expectCreditRows(playerId: string, expectedCount: number, expectedAmount: number): Promise<void> {
  const result = await requirePool().query<{ amount: string }>(
    `SELECT amount FROM wallet_transactions WHERE player_id = $1 AND transaction_type = 'credit' AND source = 'tevi_topup'`,
    [playerId]
  );
  expect(result.rows).toHaveLength(expectedCount);
  for (const row of result.rows) {
    expect(Number(row.amount)).toBe(expectedAmount);
  }
}

async function expectBalance(playerId: string, expectedBalance: number): Promise<void> {
  const result = await requirePool().query<{ balance: string }>(`SELECT balance FROM wallets WHERE player_id = $1`, [playerId]);
  expect(Number(result.rows[0]?.balance)).toBe(expectedBalance);
}

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
