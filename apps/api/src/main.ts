import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createProductionDependencies, shouldUsePostgresPersistence } from "./composition/production-dependencies.js";

const env = loadEnv();
let productionDependencies: Awaited<ReturnType<typeof createProductionDependencies>> | undefined;
try {
  productionDependencies = shouldUsePostgresPersistence(env)
    ? await createProductionDependencies(env)
    : undefined;
} catch (error) {
  console.error("[api] production startup failed", {
    nodeEnv: env.nodeEnv,
    persistenceMode: env.persistenceMode,
    code: typeof error === "object" && error !== null && "code" in error ? error.code : undefined,
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
}
const app = createApp(productionDependencies?.appDependencies);
const server = createServer(app);
let shutdownStarted = false;

async function shutdownProductionDependencies(): Promise<void> {
  if (!productionDependencies || shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  await productionDependencies.shutdown();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
      server.close((error) => {
      if (error) {
        console.error("[api] server shutdown failed", error);
        process.exitCode = 1;
      }
        shutdownProductionDependencies().catch((shutdownError: unknown) => {
          console.error("[api] PostgreSQL pool shutdown failed", shutdownError);
          process.exitCode = 1;
        });
    });
  });
}

server.listen(env.port, () => {
  console.log(`china-slot-api listening on ${env.port} (${env.nodeEnv})`);
});
