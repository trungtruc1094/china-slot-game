import "dotenv/config";

export interface ApiEnv {
  nodeEnv: string;
  port: number;
  persistenceMode: "memory" | "postgres";
  budgetProtectionEnabled: boolean;
  databaseUrl?: string;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const rawPort = source.PORT ?? "3000";
  const parsedPort = Number(rawPort);
  const nodeEnv = source.NODE_ENV ?? "development";
  const persistenceMode = parsePersistenceMode(source.PERSISTENCE_MODE);
  const requiresPostgres = nodeEnv === "production" || persistenceMode === "postgres";

  if (!Number.isSafeInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const databaseUrl = source.DATABASE_URL;
  if (requiresPostgres && !databaseUrl) {
    throw new Error("DATABASE_URL is required when NODE_ENV=production or PERSISTENCE_MODE=postgres");
  }

  if (databaseUrl) {
    validateDatabaseUrl(databaseUrl);
  }

  const env: ApiEnv = {
    nodeEnv,
    port: parsedPort,
    persistenceMode,
    budgetProtectionEnabled: source.BUDGET_PROTECTION_ENABLED !== "false"
  };

  if (databaseUrl) {
    env.databaseUrl = databaseUrl;
  }

  return env;
}

function parsePersistenceMode(rawMode: string | undefined): ApiEnv["persistenceMode"] {
  const mode = rawMode ?? "memory";

  if (mode === "memory" || mode === "postgres") {
    return mode;
  }

  throw new Error("PERSISTENCE_MODE must be either memory or postgres");
}

function validateDatabaseUrl(databaseUrl: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
  }

  if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres:// or postgresql:// scheme");
  }

  if (!parsedUrl.hostname) {
    throw new Error("DATABASE_URL must include a hostname");
  }

  if (!parsedUrl.pathname || parsedUrl.pathname === "/") {
    throw new Error("DATABASE_URL must include a database name");
  }
}
