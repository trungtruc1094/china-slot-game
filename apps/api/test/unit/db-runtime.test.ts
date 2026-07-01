import { describe, expect, it } from "vitest";
import { loadMigrations } from "../../src/db/migrations.js";

describe("PostgreSQL migration runtime", () => {
  it("loads ordered reversible SQL migrations", async () => {
    const migrations = await loadMigrations();

    expect(migrations.map((migration) => migration.version)).toEqual(["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011", "0012", "0013"]);
    for (const migration of migrations) {
      expect(migration.upSql.length).toBeGreaterThan(0);
      expect(migration.downSql.length).toBeGreaterThan(0);
      expect(migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("rejects migration files without reversible sections", async () => {
    await expect(loadMigrations(new URL("../fixtures/invalid-migrations", import.meta.url).pathname))
      .rejects
      .toMatchObject({ code: "INVALID_MIGRATION_FORMAT" });
  });

  it("rejects migration files with empty rollback sections", async () => {
    await expect(loadMigrations(new URL("../fixtures/empty-down-migrations", import.meta.url).pathname))
      .rejects
      .toMatchObject({ code: "INVALID_MIGRATION_FORMAT" });
  });
});