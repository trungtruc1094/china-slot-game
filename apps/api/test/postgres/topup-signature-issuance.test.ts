import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/migrations.js";
import { createPostgresPool } from "../../src/db/pool.js";
import { fingerprintDepositToken } from "../../src/domain/topup-service.js";
import { PostgresPlayerSessionRepository } from "../../src/repositories/postgres/player-session-repository.js";
import { PostgresTopupSignatureIssuanceRepository } from "../../src/repositories/postgres/topup-signature-issuance-repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;
let pool: ReturnType<typeof createPostgresPool> | undefined;

beforeEach(async () => {
  if (!testDatabaseUrl) {
    return;
  }

  assertSafeTestDatabaseUrl(testDatabaseUrl);
  pool = createPostgresPool(testDatabaseUrl);
  await resetPublicSchema();
  await new MigrationRunner({ pool: requirePool() }).migrateUp();
});

afterEach(async () => {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
});

describePostgres("PostgresTopupSignatureIssuanceRepository", () => {
  it("creates and reconstructs issued metadata without storing the deposit token", async () => {
    const players = new PostgresPlayerSessionRepository(requirePool());
    const player = await players.resolvePlayer({
      provider: "tevi",
      subject: "tevi-user-1",
      displayName: "Tevi Player",
      expiresAt: "2026-06-30T00:00:00.000Z"
    }, new Date("2026-06-29T00:00:00.000Z"));
    const repository = new PostgresTopupSignatureIssuanceRepository(requirePool());
    const token = "provider.deposit.token";

    const record = await repository.create({
      providerName: "tevi",
      playerId: player.playerId,
      teviSubject: "tevi-user-1",
      amount: 100,
      requestId: "req_issued",
      depositTokenFingerprint: fingerprintDepositToken(token),
      status: "issued",
      failureReason: null,
      providerStatusCode: null,
      providerMetadata: { appId: "AZX29173", billingChannelId: "2300210851" },
      createdAt: new Date("2026-06-29T00:00:00.000Z")
    });

    expect(record).toMatchObject({
      providerName: "tevi",
      playerId: player.playerId,
      teviSubject: "tevi-user-1",
      amount: 100,
      requestId: "req_issued",
      depositTokenFingerprint: fingerprintDepositToken(token),
      status: "issued",
      failureReason: null,
      createdAt: "2026-06-29T00:00:00.000Z"
    });
    expect(JSON.stringify(record)).not.toContain(token);

    const reconstructed = new PostgresTopupSignatureIssuanceRepository(requirePool());
    await expect(reconstructed.findByRequestId("req_issued")).resolves.toEqual([record]);
  });

  it("stores failed issuance metadata and keeps wallet transactions unchanged", async () => {
    const repository = new PostgresTopupSignatureIssuanceRepository(requirePool());

    const record = await repository.create({
      providerName: "tevi",
      playerId: null,
      teviSubject: "tevi-user-1",
      amount: 100,
      requestId: "req_failed",
      depositTokenFingerprint: null,
      status: "failed",
      failureReason: "PROVIDER_REJECTED",
      providerStatusCode: 403,
      providerMetadata: { appId: "AZX29173", billingChannelId: "2300210851" },
      createdAt: new Date("2026-06-29T00:00:00.000Z")
    });

    expect(record).toMatchObject({
      status: "failed",
      failureReason: "PROVIDER_REJECTED",
      providerStatusCode: 403,
      depositTokenFingerprint: null
    });
    const walletTransactions = await requirePool().query<{ count: string }>("SELECT count(*)::text AS count FROM wallet_transactions");
    expect(walletTransactions.rows[0]?.count).toBe("0");
  });

  it("enforces fingerprint-only issued records", async () => {
    await expect(requirePool().query(
      `INSERT INTO topup_signature_issuances (
         id, provider_name, request_id, status, created_at
       ) VALUES ('topup_sig_missing_fingerprint', 'tevi', 'req_bad', 'issued', now())`
    )).rejects.toMatchObject({ code: "23514" });
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
