import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPostgresPool } from "../../src/db/pool.js";
import { MigrationRunner } from "../../src/db/migrations.js";
import { PostgresTeviMessageReceiptRepository } from "../../src/repositories/postgres/tevi-message-receipt-repository.js";
import type { Clock } from "../../src/domain/session-service.js";
import {
  buildTopupReceiptCorrelationKey,
  type TeviMessageReceiptCreateInput
} from "../../src/domain/tevi-receipt-service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;
let pool: ReturnType<typeof createPostgresPool> | undefined;

class MutableClock implements Clock {
  public current = new Date("2026-07-02T08:00:00.000Z");

  public now(): Date {
    return this.current;
  }
}

const baseInput = (): TeviMessageReceiptCreateInput => ({
  messageType: "topup_credit",
  recipientTeviSubject: "1168097029",
  playerId: "player_1",
  sourceEventId: "evt_topup_1",
  sourceCorrelationKey: buildTopupReceiptCorrelationKey("evt_topup_1"),
  amount: 100,
  cashoutStatus: null,
  messageBodyPreview: "Your Stars top-up of 100 was credited. Reference: req_1.",
  requestId: "req_webhook_1",
  createdAt: new Date("2026-07-02T08:00:00.000Z")
});

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

describePostgres("PostgresTeviMessageReceiptRepository", () => {
  it("creates, deduplicates, updates, and searches message receipt records", async () => {
    const clock = new MutableClock();
    const repository = new PostgresTeviMessageReceiptRepository(requirePool(), clock);
    const input = baseInput();

    await createPlayer("player_1");

    const created = await repository.createOrGet(input);
    expect(created.created).toBe(true);
    expect(created.record).toMatchObject({
      messageType: "topup_credit",
      playerId: "player_1",
      status: "pending",
      dispatchAttemptCount: 0,
      amount: 100
    });

    const existing = await repository.createOrGet(input);
    expect(existing.created).toBe(false);
    expect(existing.record.receiptId).toBe(created.record.receiptId);

    clock.current = new Date("2026-07-02T08:05:00.000Z");
    await repository.recordDispatchOutcome(created.record.receiptId, {
      status: "sent",
      failureReason: null,
      providerStatusCode: null,
      providerResponseSummary: { providerMessageId: "msg_1" },
      sentAt: clock.now()
    });

    const byId = await repository.findById(created.record.receiptId);
    expect(byId).toMatchObject({
      status: "sent",
      dispatchAttemptCount: 1,
      failureReason: null
    });

    const bySource = await repository.findBySource("topup_credit", input.sourceCorrelationKey);
    expect(bySource?.receiptId).toBe(created.record.receiptId);

    const filtered = await repository.searchRecords({
      playerId: "player_1",
      receiptId: created.record.receiptId,
      sourceEventId: "evt_topup_1",
      messageType: "topup_credit",
      status: "sent",
      from: new Date("2026-07-02T07:00:00.000Z"),
      to: new Date("2026-07-02T09:00:00.000Z"),
      limit: 10,
      offset: 0
    });
    expect(filtered.total).toBe(1);
    expect(filtered.records[0]?.receiptId).toBe(created.record.receiptId);

    await expect(repository.findById("receipt_missing")).resolves.toBeNull();
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

async function createPlayer(playerId: string): Promise<void> {
  const now = new Date("2026-07-02T08:00:00.000Z");
  await requirePool().query(
    `INSERT INTO players (id, display_name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
    [playerId, playerId, now]
  );
}
