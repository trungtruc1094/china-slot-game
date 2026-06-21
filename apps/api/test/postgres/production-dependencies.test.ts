import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { createProductionDependencies, shouldUsePostgresPersistence } from "../../src/composition/production-dependencies.js";
import type { ApiEnv } from "../../src/config/env.js";
import { createPostgresPool } from "../../src/db/pool.js";
import { MigrationRunner } from "../../src/db/migrations.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;
let pool: ReturnType<typeof createPostgresPool> | undefined;

beforeEach(async () => {
  vi.unstubAllEnvs();
  if (!testDatabaseUrl) {
    return;
  }
  assertSafeTestDatabaseUrl(testDatabaseUrl);
  pool = createPostgresPool(testDatabaseUrl);
  await resetPublicSchema();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (pool) {
    await resetPublicSchema();
    await pool.end();
    pool = undefined;
  }
});

describe("shouldUsePostgresPersistence", () => {
  it("selects PostgreSQL for production or explicit postgres mode only", () => {
    expect(shouldUsePostgresPersistence(env({ nodeEnv: "production", persistenceMode: "memory", databaseUrl: "postgres://localhost/db" }))).toBe(true);
    expect(shouldUsePostgresPersistence(env({ nodeEnv: "development", persistenceMode: "postgres", databaseUrl: "postgres://localhost/db" }))).toBe(true);
    expect(shouldUsePostgresPersistence(env({ nodeEnv: "development", persistenceMode: "memory" }))).toBe(false);
    expect(shouldUsePostgresPersistence(env({ nodeEnv: "test", persistenceMode: "memory" }))).toBe(false);
  });
});

describePostgres("production PostgreSQL dependencies", () => {
  it("creates PostgreSQL-backed app dependencies and reports readiness", async () => {
    await new MigrationRunner({ pool: requirePool() }).migrateUp();
    let production: Awaited<ReturnType<typeof createProductionDependencies>> | undefined;

    try {
      production = await createProductionDependencies(env({ persistenceMode: "postgres", databaseUrl: requireTestDatabaseUrl() }));
      await expect(production.readinessCheck()).resolves.toEqual({ postgres: "ready" });
      expect(production.appDependencies.sessionService).toBeDefined();
      expect(production.appDependencies.walletService?.constructor.name).toBe("PostgresWalletRepository");
      expect(production.appDependencies.spinService?.constructor.name).toBe("PostgresSpinService");
      expect(production.appDependencies.configRepository?.constructor.name).toBe("PostgresGameConfigurationRepository");
      expect(production.appDependencies.operatorLimitsRepository?.constructor.name).toBe("PostgresOperatorLimitsRepository");
      expect(production.appDependencies.budgetProtectionRepository?.constructor.name).toBe("PostgresBudgetProtectionRepository");
      expect(production.appDependencies.alertRepository?.constructor.name).toBe("PostgresAlertRepository");
      expect(production.appDependencies.adminAuditRepository?.constructor.name).toBe("PostgresAdminAuditRepository");
      expect(production.appDependencies.requestTraceRepository?.constructor.name).toBe("PostgresRequestTraceRepository");
      expect(production.providerTopUpIdempotencyRepository.constructor.name).toBe("PostgresProviderTopUpIdempotencyRepository");
    } finally {
      await production?.shutdown();
    }
  });

  it("uses validated budget protection enablement from env", async () => {
    await new MigrationRunner({ pool: requirePool() }).migrateUp();
    const production = await createProductionDependencies(env({
      persistenceMode: "postgres",
      databaseUrl: requireTestDatabaseUrl(),
      budgetProtectionEnabled: false
    }));

    try {
      expect(production.appDependencies.budgetProtectionEnabled).toBe(false);
    } finally {
      await production.shutdown();
    }
  });

  it("keeps createApp defaults explicitly in-memory for local tests", async () => {
    const server = createServer(createApp());
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/ready`, { headers: { "x-request-id": "req_memory_ready" } });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: {
          status: "ok",
          service: "china-slot-api",
          dependencies: { api: "ready" }
        },
        error: null,
        requestId: "req_memory_ready"
      });
    } finally {
      await closeServer(server);
    }
  });

  it("blocks PostgreSQL startup when schema migrations are pending", async () => {
    await expect(createProductionDependencies(env({ persistenceMode: "postgres", databaseUrl: requireTestDatabaseUrl() })))
      .rejects
      .toMatchObject({ code: "DATABASE_NOT_READY" });
  });

  it("blocks PostgreSQL startup when the database is unreachable", async () => {
    await expect(createProductionDependencies(env({ persistenceMode: "postgres", databaseUrl: "postgres://china_slot@127.0.0.1:59999/china_slot_test" })))
      .rejects
      .toMatchObject({ code: "DATABASE_NOT_READY" });
  });

  it("allows a migrated empty database but keeps reward-bearing spins fail-safe", async () => {
    await new MigrationRunner({ pool: requirePool() }).migrateUp();
    const production = await createProductionDependencies(env({ persistenceMode: "postgres", databaseUrl: requireTestDatabaseUrl() }));
    const server = createServer(createApp(production.appDependencies));

    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/spins`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": "req_empty_config_spin" },
        body: JSON.stringify({
          sessionId: "sess_missing",
          clientSpinId: "spin_missing_config",
          wager: { lineBet: 1, totalWager: 1 }
        })
      });

      expect(response.status).not.toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: null,
        requestId: "req_empty_config_spin"
      });
    } finally {
      await closeServer(server);
      await production.shutdown();
    }
  });

  it("blocks PostgreSQL startup when in-memory active config seeding is requested", async () => {
    await new MigrationRunner({ pool: requirePool() }).migrateUp();
    vi.stubEnv("SEED_ACTIVE_CONFIG", "true");

    await expect(createProductionDependencies(env({ persistenceMode: "postgres", databaseUrl: requireTestDatabaseUrl() })))
      .rejects
      .toThrow("SEED_ACTIVE_CONFIG cannot be used when PostgreSQL persistence is enabled.");
  });

  it("returns PostgreSQL readiness in the ready route envelope", async () => {
    await new MigrationRunner({ pool: requirePool() }).migrateUp();
    const production = await createProductionDependencies(env({ persistenceMode: "postgres", databaseUrl: requireTestDatabaseUrl() }));
    const server = createServer(createApp(production.appDependencies));

    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/ready`, { headers: { "x-request-id": "req_pg_ready" } });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: {
          status: "ok",
          service: "china-slot-api",
          dependencies: { api: "ready", postgres: "ready" }
        },
        error: null,
        requestId: "req_pg_ready"
      });
    } finally {
      await closeServer(server);
      await production.shutdown();
    }
  });

  it("returns 503 from readiness when PostgreSQL schema becomes not ready", async () => {
    await new MigrationRunner({ pool: requirePool() }).migrateUp();
    const production = await createProductionDependencies(env({ persistenceMode: "postgres", databaseUrl: requireTestDatabaseUrl() }));
    await requirePool().query("DROP TABLE schema_migrations");
    const server = createServer(createApp(production.appDependencies));

    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/ready`, { headers: { "x-request-id": "req_pg_not_ready" } });

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        data: null,
        error: {
          code: "DATABASE_NOT_READY",
          message: expect.stringContaining("schema") as string,
          details: expect.any(Object) as Record<string, unknown>
        },
        requestId: "req_pg_not_ready"
      });
    } finally {
      await closeServer(server);
      await production.shutdown();
    }
  });
});

function env(overrides: Partial<ApiEnv>): ApiEnv {
  return {
    nodeEnv: "test",
    port: 0,
    persistenceMode: "memory",
    budgetProtectionEnabled: true,
    ...overrides
  };
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

function requireTestDatabaseUrl(): string {
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for PostgreSQL production dependency tests.");
  }
  return testDatabaseUrl;
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function assertSafeTestDatabaseUrl(databaseUrl: string): void {
  const parsedUrl = new URL(databaseUrl);
  const databaseName = parsedUrl.pathname.replace(/^\//, "");

  if (databaseName !== "china_slot_test" && !databaseName.endsWith("_test") && !databaseName.startsWith("test_")) {
    throw new Error("PostgreSQL integration tests require a dedicated test database name ending with _test or starting with test_.");
  }
}
