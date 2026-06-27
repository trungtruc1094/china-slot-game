import type { Pool } from "pg";
import type { AppDependencies } from "../app.js";
import type { ApiEnv } from "../config/env.js";
import { MigrationRunner, toDatabaseReadinessError } from "../db/migrations.js";
import { createPostgresPool } from "../db/pool.js";
import { SessionService, SystemClock } from "../domain/session-service.js";
import { PostgresGameConfigurationRepository } from "../repositories/postgres/game-configuration-repository.js";
import { PostgresProviderTopUpIdempotencyRepository } from "../repositories/postgres/provider-top-up-idempotency-repository.js";
import {
  PostgresAdminAuditRepository,
  PostgresAlertRepository,
  PostgresBudgetProtectionRepository,
  PostgresOperatorLimitsRepository,
  PostgresRequestTraceRepository
} from "../repositories/postgres/operational-repositories.js";
import { PostgresPlayerSessionRepository } from "../repositories/postgres/player-session-repository.js";
import { PostgresSpinService } from "../repositories/postgres/spin-service.js";
import { PostgresWalletRepository } from "../repositories/postgres/wallet-repository.js";

export interface ProductionDependencies {
  appDependencies: AppDependencies;
  pool: Pool;
  readinessCheck: () => Promise<Record<string, "ready">>;
  shutdown: () => Promise<void>;
  providerTopUpIdempotencyRepository: PostgresProviderTopUpIdempotencyRepository;
}

export async function createProductionDependencies(env: ApiEnv): Promise<ProductionDependencies> {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is required for PostgreSQL production dependencies.");
  }
  if (process.env.SEED_ACTIVE_CONFIG === "true") {
    throw new Error("SEED_ACTIVE_CONFIG cannot be used when PostgreSQL persistence is enabled.");
  }

  const pool = createPostgresPool(env.databaseUrl);
  const migrationRunner = new MigrationRunner({ pool });
  const clock = new SystemClock();

  try {
    await migrationRunner.assertReady();

    const adminAuditRepository = new PostgresAdminAuditRepository(pool, clock);
    const requestTraceRepository = new PostgresRequestTraceRepository(pool);
    const playerSessionRepository = new PostgresPlayerSessionRepository(pool);
    const walletRepository = new PostgresWalletRepository(pool, clock);
    const sessionService = new SessionService(playerSessionRepository, clock, walletRepository);
    const configRepository = new PostgresGameConfigurationRepository(pool, clock, adminAuditRepository);
    const operatorLimitsRepository = new PostgresOperatorLimitsRepository(pool, clock, adminAuditRepository);
    const budgetProtectionRepository = new PostgresBudgetProtectionRepository(pool, clock, adminAuditRepository);
    const alertRepository = new PostgresAlertRepository(pool, clock, adminAuditRepository);
    const providerTopUpIdempotencyRepository = new PostgresProviderTopUpIdempotencyRepository(pool, clock);

    await configRepository.getActiveRecord();
    await operatorLimitsRepository.load();
    await budgetProtectionRepository.load();
    await alertRepository.load();

    const spinService = new PostgresSpinService(pool, {
      configProvider: configRepository,
      operatorLimitsProvider: operatorLimitsRepository,
      budgetProtectionProvider: budgetProtectionRepository,
      budgetProtectionEnabled: env.budgetProtectionEnabled
    }, clock);
    await spinService.loadLedger();

    const readinessCheck = async (): Promise<Record<string, "ready">> => {
      try {
        await migrationRunner.assertReady();
        return { postgres: "ready" };
      } catch (error) {
        throw toDatabaseReadinessError(error);
      }
    };

    return {
      appDependencies: {
        sessionService,
        walletService: walletRepository,
        spinService,
        configRepository,
        configProvider: configRepository,
        operatorLimitsRepository,
        budgetProtectionRepository,
        budgetProtectionEnabled: env.budgetProtectionEnabled,
        alertRepository,
        adminAuditRepository,
        requestTraceRepository,
        readinessCheck
      },
      pool,
      readinessCheck,
      shutdown: async () => {
        await pool.end();
      },
      providerTopUpIdempotencyRepository
    };
  } catch (error) {
    await pool.end();
    throw toDatabaseReadinessError(error);
  }
}

export function shouldUsePostgresPersistence(env: ApiEnv): boolean {
  return env.nodeEnv === "production" || env.persistenceMode === "postgres";
}
