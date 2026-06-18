import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { createHealthRouter } from "./routes/health.routes.js";
import { createSessionsRouter } from "./routes/sessions.routes.js";
import { createSpinsRouter } from "./routes/spins.routes.js";
import { InMemoryPlayerIdentityAdapter } from "./domain/player-identity.js";
import { SessionService, type Clock } from "./domain/session-service.js";
import { SpinService } from "./domain/spin-service.js";
import type { SpinServiceOptions } from "./domain/spin-service.js";
import { WalletService } from "./domain/wallet-service.js";
import type { GameConfiguration } from "@china-slot-game/game-math";

export interface AppDependencies {
  clock?: Clock;
  activeConfig?: GameConfiguration;
  nextRandom?: () => number;
  failLedgerCommit?: SpinServiceOptions["failLedgerCommit"];
  sessionService?: SessionService;
  walletService?: WalletService;
  spinService?: SpinService;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const sessionService = dependencies.sessionService ?? new SessionService(
    new InMemoryPlayerIdentityAdapter(),
    dependencies.clock
  );
  const walletService = dependencies.walletService ?? new WalletService(dependencies.clock ?? { now: () => new Date() });
  const spinOptions: SpinServiceOptions = {};
  if (dependencies.activeConfig) {
    spinOptions.activeConfig = dependencies.activeConfig;
  }
  if (dependencies.nextRandom) {
    spinOptions.nextRandom = dependencies.nextRandom;
  }
  if (dependencies.failLedgerCommit) {
    spinOptions.failLedgerCommit = dependencies.failLedgerCommit;
  }
  const spinService = dependencies.spinService ?? new SpinService(
    sessionService,
    walletService,
    spinOptions,
    dependencies.clock
  );

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors());
  app.use(requestIdMiddleware);
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", createHealthRouter());
  app.use("/api", createSessionsRouter(sessionService));
  app.use("/api", createSpinsRouter(spinService));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
