import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { createHealthRouter } from "./routes/health.routes.js";
import { createAdminAlertsRouter } from "./routes/admin-alerts.routes.js";
import { createAdminBalanceTransactionsRouter } from "./routes/admin-balance-transactions.routes.js";
import { createAdminBudgetProtectionRouter } from "./routes/admin-budget-protection.routes.js";
import { createAdminConfigRouter } from "./routes/admin-config.routes.js";
import { createAdminMetricsRouter } from "./routes/admin-metrics.routes.js";
import { createAdminOperatorLimitsRouter } from "./routes/admin-operator-limits.routes.js";
import { createAdminSpinLedgerRouter } from "./routes/admin-spin-ledger.routes.js";
import { createSessionsRouter } from "./routes/sessions.routes.js";
import { createSpinsRouter } from "./routes/spins.routes.js";
import { InMemoryPlayerIdentityAdapter } from "./domain/player-identity.js";
import { InMemoryGameConfigurationRepository, type GameConfigurationProvider } from "./domain/game-configuration-repository.js";
import { MetricsService } from "./domain/metrics-service.js";
import { InMemoryOperatorLimitsRepository } from "./domain/operator-limits-repository.js";
import { SessionService, type Clock } from "./domain/session-service.js";
import { SpinService } from "./domain/spin-service.js";
import type { SpinServiceOptions } from "./domain/spin-service.js";
import { WalletService } from "./domain/wallet-service.js";
import type { GameConfiguration } from "@china-slot-game/game-math";
import { InMemoryAlertRepository } from "./domain/alert-repository.js";
import { AlertService } from "./domain/alert-service.js";
import { InMemoryBudgetProtectionRepository } from "./domain/budget-protection-repository.js";
import { InMemoryAdminAuditRepository } from "./domain/admin-audit-repository.js";

export interface AppDependencies {
  clock?: Clock;
  activeConfig?: GameConfiguration;
  configRepository?: InMemoryGameConfigurationRepository;
  operatorLimitsRepository?: InMemoryOperatorLimitsRepository;
  alertRepository?: InMemoryAlertRepository;
  budgetProtectionRepository?: InMemoryBudgetProtectionRepository;
  budgetProtectionEnabled?: boolean;
  configProvider?: GameConfigurationProvider;
  nextRandom?: () => number;
  failLedgerCommit?: SpinServiceOptions["failLedgerCommit"];
  sessionService?: SessionService;
  walletService?: WalletService;
  spinService?: SpinService;
  adminAuditRepository?: InMemoryAdminAuditRepository;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const sessionService = dependencies.sessionService ?? new SessionService(
    new InMemoryPlayerIdentityAdapter(),
    dependencies.clock
  );
  const walletService = dependencies.walletService ?? new WalletService(dependencies.clock ?? { now: () => new Date() });
  const adminAuditRepository = dependencies.adminAuditRepository ?? new InMemoryAdminAuditRepository(
    dependencies.clock ?? { now: () => new Date() }
  );
  const configRepository = dependencies.configRepository ?? new InMemoryGameConfigurationRepository(
    dependencies.clock ?? { now: () => new Date() },
    adminAuditRepository
  );
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
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", createHealthRouter());
  app.use("/api", createAdminAlertsRouter(alertRepository, alertService));
  app.use("/api", createAdminBudgetProtectionRouter(budgetProtectionRepository, budgetProtectionEnabled));
  app.use("/api", createAdminBalanceTransactionsRouter(walletService, adminAuditRepository));
  app.use("/api", createAdminConfigRouter(configRepository));
  app.use("/api", createAdminOperatorLimitsRouter(operatorLimitsRepository));
  app.use("/api", createAdminSpinLedgerRouter(spinService, adminAuditRepository));
  app.use("/api", createAdminMetricsRouter(metricsService));
  app.use("/api", createSessionsRouter(sessionService));
  app.use("/api", createSpinsRouter(spinService));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
