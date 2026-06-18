import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { createHealthRouter } from "./routes/health.routes.js";
import { createSessionsRouter } from "./routes/sessions.routes.js";
import { InMemoryPlayerIdentityAdapter } from "./domain/player-identity.js";
import { SessionService, type Clock } from "./domain/session-service.js";

export interface AppDependencies {
  clock?: Clock;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const sessionService = new SessionService(
    new InMemoryPlayerIdentityAdapter(),
    dependencies.clock
  );

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors());
  app.use(requestIdMiddleware);
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", createHealthRouter());
  app.use("/api", createSessionsRouter(sessionService));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
