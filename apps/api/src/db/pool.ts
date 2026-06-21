import { Pool, type PoolConfig } from "pg";

export interface DatabaseErrorDetails {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export class DatabaseReadinessError extends Error {
  public readonly code = "DATABASE_NOT_READY";
  public readonly details: Record<string, unknown>;

  public constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "DatabaseReadinessError";
    this.details = details;
  }

  public toErrorDetails(): DatabaseErrorDetails {
    return {
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
}

export function createPostgresPool(databaseUrl: string, config: Omit<PoolConfig, "connectionString"> = {}): Pool {
  return new Pool({
    ...config,
    connectionString: databaseUrl
  });
}

export async function checkPostgresConnection(pool: Pool): Promise<void> {
  try {
    await pool.query("SELECT 1 AS ready");
  } catch (error) {
    throw new DatabaseReadinessError("PostgreSQL connection check failed", {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function checkSchemaMigrationsTable(pool: Pool): Promise<void> {
  try {
    const result = await pool.query<{ exists: boolean }>("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists");
    if (result.rows[0]?.exists !== true) {
      throw new DatabaseReadinessError("PostgreSQL schema migrations table is missing", {
        table: "schema_migrations"
      });
    }
  } catch (error) {
    if (error instanceof DatabaseReadinessError) {
      throw error;
    }

    throw new DatabaseReadinessError("PostgreSQL schema readiness check failed", {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}