import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { requestTracingMiddleware } from "./middleware/request-tracing.js";
import { createHealthRouter } from "./routes/health.routes.js";
import { createRewardBoundaryRouter } from "./routes/reward-boundary.routes.js";
import { createAdminAlertsRouter } from "./routes/admin-alerts.routes.js";
import { createAdminAuditRouter } from "./routes/admin-audit.routes.js";
import { createAdminBalanceTransactionsRouter } from "./routes/admin-balance-transactions.routes.js";
import { createAdminBudgetProtectionRouter } from "./routes/admin-budget-protection.routes.js";
import { createAdminConfigRouter } from "./routes/admin-config.routes.js";
import { createAdminMetricsRouter } from "./routes/admin-metrics.routes.js";
import { createAdminOperatorLimitsRouter } from "./routes/admin-operator-limits.routes.js";
import { createAdminSpinLedgerRouter } from "./routes/admin-spin-ledger.routes.js";
import { createSessionsRouter } from "./routes/sessions.routes.js";
import { createSpinsRouter } from "./routes/spins.routes.js";
import { InMemoryPlayerIdentityAdapter } from "./domain/player-identity.js";
import { InMemoryGameConfigurationRepository, type GameConfigurationProvider, type GameConfigurationRepository } from "./domain/game-configuration-repository.js";
import { MetricsService } from "./domain/metrics-service.js";
import { InMemoryOperatorLimitsRepository, type OperatorLimitsRepository } from "./domain/operator-limits-repository.js";
import { SessionService, type Clock } from "./domain/session-service.js";
import { SpinService } from "./domain/spin-service.js";
import type { SpinServiceOptions } from "./domain/spin-service.js";
import { WalletService, type WalletOperations } from "./domain/wallet-service.js";
import type { GameConfiguration } from "@china-slot-game/game-math";
import { InMemoryAlertRepository, type AlertRepository } from "./domain/alert-repository.js";
import { AlertService } from "./domain/alert-service.js";
import { InMemoryBudgetProtectionRepository, type BudgetProtectionRepository } from "./domain/budget-protection-repository.js";
import { InMemoryAdminAuditRepository, type AdminAuditRepository } from "./domain/admin-audit-repository.js";
import { InMemoryRequestTraceRepository, type RequestTraceRepository } from "./domain/request-trace-repository.js";
import { seedActiveConfigForDeployment } from "./config/seed-active-config.js";

export interface AppDependencies {
  clock?: Clock;
  activeConfig?: GameConfiguration;
  configRepository?: GameConfigurationRepository & GameConfigurationProvider;
  operatorLimitsRepository?: OperatorLimitsRepository;
  alertRepository?: AlertRepository;
  budgetProtectionRepository?: BudgetProtectionRepository;
  budgetProtectionEnabled?: boolean;
  configProvider?: GameConfigurationProvider;
  nextRandom?: () => number;
  failLedgerCommit?: SpinServiceOptions["failLedgerCommit"];
  sessionService?: SessionService;
  walletService?: WalletOperations;
  spinService?: SpinService;
  adminAuditRepository?: AdminAuditRepository;
  requestTraceRepository?: RequestTraceRepository;
  readinessCheck?: () => Promise<Record<string, "ready">>;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const walletService = dependencies.walletService ?? new WalletService(dependencies.clock ?? { now: () => new Date() });
  const sessionService = dependencies.sessionService ?? new SessionService(
    new InMemoryPlayerIdentityAdapter(),
    dependencies.clock,
    walletService
  );
  const adminAuditRepository = dependencies.adminAuditRepository ?? new InMemoryAdminAuditRepository(
    dependencies.clock ?? { now: () => new Date() }
  );
  const requestTraceRepository = dependencies.requestTraceRepository ?? new InMemoryRequestTraceRepository();
  const defaultConfigRepository = new InMemoryGameConfigurationRepository(
    dependencies.clock ?? { now: () => new Date() },
    adminAuditRepository
  );
  const configRepository = dependencies.configRepository ?? defaultConfigRepository;
  if (!dependencies.configRepository && process.env.SEED_ACTIVE_CONFIG === "true") {
    seedActiveConfigForDeployment(defaultConfigRepository);
  }
  const operatorLimitsRepository = dependencies.operatorLimitsRepository ?? new InMemoryOperatorLimitsRepository(
    dependencies.clock ?? { now: () => new Date() },
    adminAuditRepository
  );
  const alertRepository = dependencies.alertRepository ?? new InMemoryAlertRepository(
    dependencies.clock ?? { now: () => new Date() },
    adminAuditRepository
  );
  const budgetProtectionRepository = dependencies.budgetProtectionRepository ?? new InMemoryBudgetProtectionRepository(
    dependencies.clock ?? { now: () => new Date() },
    adminAuditRepository
  );
  const budgetProtectionEnabled = dependencies.budgetProtectionEnabled ?? process.env.BUDGET_PROTECTION_ENABLED !== "false";
  const spinOptions: SpinServiceOptions = {};
  if (dependencies.activeConfig) {
    spinOptions.activeConfig = dependencies.activeConfig;
  }
  spinOptions.configProvider = dependencies.configProvider ?? configRepository;
  if (dependencies.nextRandom) {
    spinOptions.nextRandom = dependencies.nextRandom;
  }
  if (dependencies.failLedgerCommit) {
    spinOptions.failLedgerCommit = dependencies.failLedgerCommit;
  }
  spinOptions.operatorLimitsProvider = operatorLimitsRepository;
  spinOptions.budgetProtectionProvider = budgetProtectionRepository;
  spinOptions.budgetProtectionEnabled = budgetProtectionEnabled;
  const spinService = dependencies.spinService ?? new SpinService(
    sessionService,
    walletService,
    spinOptions,
    dependencies.clock
  );
  const metricsService = new MetricsService(spinService, spinOptions.configProvider, operatorLimitsRepository, alertRepository);
  const alertService = new AlertService(alertRepository, metricsService);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors());
  app.use(requestIdMiddleware);
  app.use(requestTracingMiddleware(requestTraceRepository, dependencies.clock ?? { now: () => new Date() }));
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", createHealthRouter(
    dependencies.readinessCheck ? { readinessCheck: dependencies.readinessCheck } : {}
  ));
  app.use("/api", createRewardBoundaryRouter(adminAuditRepository));
  app.use("/api", createAdminAuditRouter(adminAuditRepository));
  app.use("/api", createAdminAlertsRouter(alertRepository, alertService));
  app.use("/api", createAdminBudgetProtectionRouter(budgetProtectionRepository, budgetProtectionEnabled));
  app.use("/api", createAdminBalanceTransactionsRouter(walletService, adminAuditRepository));
  app.use("/api", createAdminConfigRouter(configRepository));
  app.use("/api", createAdminOperatorLimitsRouter(operatorLimitsRepository));
  app.use("/api", createAdminSpinLedgerRouter(spinService, adminAuditRepository));
  app.use("/api", createAdminMetricsRouter(metricsService));
  app.use("/api", createSessionsRouter(sessionService));
  app.use("/api", createSpinsRouter(spinService, adminAuditRepository));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
