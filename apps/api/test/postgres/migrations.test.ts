import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPostgresPool } from "../../src/db/pool.js";
import { MigrationRunner } from "../../src/db/migrations.js";

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
});

afterEach(async () => {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
});

describePostgres("PostgreSQL migrations", () => {
  it("runs migrate up, migrate down, and migrate up again from a clean database", async () => {
    const runner = new MigrationRunner({ pool: requirePool() });

    const firstUp = await runner.migrateUp();
    expect(firstUp.pending).toEqual([]);
    expect(firstUp.applied).toEqual(["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011", "0012", "0013", "0014"]);
    await expect(runner.assertReady()).resolves.toBeUndefined();

    const down = await runner.migrateDown();
    expect(down.applied).toEqual([]);
    expect(down.pending).toEqual(["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011", "0012", "0013", "0014"]);

    const secondUp = await runner.migrateUp();
    expect(secondUp.pending).toEqual([]);
    expect(secondUp.applied).toEqual(["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011", "0012", "0013", "0014"]);
  });

  it("surfaces failed migrations and blocks schema readiness", async () => {
    const migrationsDir = await mkdtemp(join(tmpdir(), "china-slot-bad-migration-"));
    await writeFile(join(migrationsDir, "0001_bad.sql"), `-- migrate:up
CREATE TABLE failed_migration_example (
  id text PRIMARY KEY,
  missing_id text NOT NULL REFERENCES missing_table(id)
);

-- migrate:down
DROP TABLE IF EXISTS failed_migration_example;
`);

    const runner = new MigrationRunner({ pool: requirePool(), migrationsDir });
    await expect(runner.migrateUp()).rejects.toMatchObject({
      code: "MIGRATION_FAILED",
      details: expect.objectContaining({ direction: "up" }) as Record<string, unknown>
    });
    await expect(runner.assertReady()).rejects.toMatchObject({
      code: "SCHEMA_NOT_READY",
      details: { pending: ["0001"] }
    });

    await rm(migrationsDir, { recursive: true, force: true });
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