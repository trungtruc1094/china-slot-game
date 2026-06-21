import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool, PoolClient } from "pg";
import { checkPostgresConnection, DatabaseReadinessError } from "./pool.js";
import { withTransaction } from "./transactions.js";

export interface Migration {
  version: string;
  name: string;
  filePath: string;
  checksum: string;
  upSql: string;
  downSql: string;
}

export interface MigrationRunnerOptions {
  pool: Pool;
  migrationsDir?: string;
}

export interface MigrationStatus {
  applied: string[];
  pending: string[];
}

interface AppliedMigrationRow {
  version: string;
  name: string;
  checksum: string;
}

export class MigrationError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown>;

  public constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
    this.details = details;
  }
}

export class SchemaReadinessError extends Error {
  public readonly code = "SCHEMA_NOT_READY";
  public readonly details: Record<string, unknown>;

  public constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "SchemaReadinessError";
    this.details = details;
  }
}

export class MigrationRunner {
  private readonly pool: Pool;
  private readonly migrationsDir: string;

  public constructor(options: MigrationRunnerOptions) {
    this.pool = options.pool;
    this.migrationsDir = options.migrationsDir ?? defaultMigrationsDir();
  }

  public async migrateUp(): Promise<MigrationStatus> {
    await this.ensureMigrationsTable();
    const migrations = await loadMigrations(this.migrationsDir);
    const applied = await this.loadAppliedMigrations();

    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        assertChecksumUnchanged(migration, applied.get(migration.version));
        continue;
      }

      await this.applyMigration(migration, "up");
    }

    return this.status();
  }

  public async migrateDown(steps = Number.POSITIVE_INFINITY): Promise<MigrationStatus> {
    await this.ensureMigrationsTable();
    const migrations = await loadMigrations(this.migrationsDir);
    const migrationsByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
    const applied = [...(await this.loadAppliedMigrations()).values()].sort((left, right) => right.version.localeCompare(left.version));
    const selected = applied.slice(0, steps);

    for (const appliedMigration of selected) {
      const migration = migrationsByVersion.get(appliedMigration.version);
      if (!migration) {
        throw new MigrationError("MIGRATION_FILE_MISSING", "Applied migration file is missing", {
          version: appliedMigration.version,
          name: appliedMigration.name
        });
      }
      assertChecksumUnchanged(migration, appliedMigration);
      await this.applyMigration(migration, "down");
    }

    return this.status();
  }

  public async status(): Promise<MigrationStatus> {
    await this.ensureMigrationsTable();
    const migrations = await loadMigrations(this.migrationsDir);
    const applied = await this.loadAppliedMigrations();
    const appliedVersions: string[] = [];
    const pendingVersions: string[] = [];

    for (const migration of migrations) {
      const appliedMigration = applied.get(migration.version);
      if (appliedMigration) {
        assertChecksumUnchanged(migration, appliedMigration);
        appliedVersions.push(migration.version);
      } else {
        pendingVersions.push(migration.version);
      }
    }

    return {
      applied: appliedVersions,
      pending: pendingVersions
    };
  }

  public async assertReady(): Promise<void> {
    await checkPostgresConnection(this.pool);
    const status = await this.status();

    if (status.pending.length > 0) {
      throw new SchemaReadinessError("PostgreSQL schema has pending migrations", {
        pending: status.pending
      });
    }
  }

  private async ensureMigrationsTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        name text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  private async loadAppliedMigrations(): Promise<Map<string, AppliedMigrationRow>> {
    const result = await this.pool.query<AppliedMigrationRow>(`
      SELECT version, name, checksum
      FROM schema_migrations
      ORDER BY version ASC
    `);

    return new Map(result.rows.map((row) => [row.version, row]));
  }

  private async applyMigration(migration: Migration, direction: "up" | "down"): Promise<void> {
    try {
      await withTransaction(this.pool, async (client) => {
        const sql = direction === "up" ? migration.upSql : migration.downSql;
        if (sql.length > 0) {
          await client.query(sql);
        }
        await recordMigration(client, migration, direction);
      });
    } catch (error) {
      throw new MigrationError("MIGRATION_FAILED", `Migration ${migration.version} ${direction} failed`, {
        version: migration.version,
        name: migration.name,
        direction,
        cause: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export async function loadMigrations(migrationsDir = defaultMigrationsDir()): Promise<Migration[]> {
  const entries = await readdir(migrationsDir);
  const migrationFiles = entries
    .filter((entry) => /^\d+_.+\.sql$/.test(entry))
    .sort((left, right) => left.localeCompare(right));

  const migrations: Migration[] = [];
  for (const fileName of migrationFiles) {
    const filePath = resolve(migrationsDir, fileName);
    const content = await readFile(filePath, "utf8");
    const version = fileName.slice(0, fileName.indexOf("_"));
    migrations.push(parseMigrationFile(version, fileName, filePath, content));
  }

  return migrations;
}

export function toDatabaseReadinessError(error: unknown): DatabaseReadinessError {
  if (error instanceof DatabaseReadinessError) {
    return error;
  }

  if (error instanceof SchemaReadinessError || error instanceof MigrationError) {
    return new DatabaseReadinessError(error.message, {
      code: error.code,
      details: error.details
    });
  }

  return new DatabaseReadinessError("PostgreSQL readiness check failed", {
    cause: error instanceof Error ? error.message : String(error)
  });
}

function parseMigrationFile(version: string, name: string, filePath: string, content: string): Migration {
  const upMarker = content.match(/^--\s*migrate:up\s*$/m);
  const downMarker = content.match(/^--\s*migrate:down\s*$/m);

  if (!upMarker || !downMarker || upMarker.index === undefined || downMarker.index === undefined || upMarker.index > downMarker.index) {
    throw new MigrationError("INVALID_MIGRATION_FORMAT", "Migration must contain migrate:up before migrate:down markers", {
      filePath
    });
  }

  const upSql = content.slice(upMarker.index + upMarker[0].length, downMarker.index).trim();
  const downSql = content.slice(downMarker.index + downMarker[0].length).trim();

  if (upSql.length === 0 || downSql.length === 0) {
    throw new MigrationError("INVALID_MIGRATION_FORMAT", "Migration up and down sections must both contain SQL", {
      filePath
    });
  }

  return {
    version,
    name,
    filePath,
    checksum: createHash("sha256").update(content).digest("hex"),
    upSql,
    downSql
  };
}

function assertChecksumUnchanged(migration: Migration, appliedMigration: AppliedMigrationRow | undefined): void {
  if (appliedMigration && appliedMigration.checksum !== migration.checksum) {
    throw new SchemaReadinessError("Applied migration checksum does not match the migration file", {
      version: migration.version,
      name: migration.name
    });
  }
}

async function recordMigration(client: PoolClient, migration: Migration, direction: "up" | "down"): Promise<void> {
  if (direction === "up") {
    await client.query(
      `INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)`,
      [migration.version, migration.name, migration.checksum]
    );
    return;
  }

  await client.query(`DELETE FROM schema_migrations WHERE version = $1`, [migration.version]);
}

function defaultMigrationsDir(): string {
  return resolve(new URL("../../db/migrations", import.meta.url).pathname);
}