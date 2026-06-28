import "dotenv/config";

export interface ApiEnv {
  nodeEnv: string;
  port: number;
  persistenceMode: "memory" | "postgres";
  budgetProtectionEnabled: boolean;
  teviAuth: TeviAuthEnv;
  databaseUrl?: string;
}

export type TeviAuthEnv = TeviAuthDisabledEnv | TeviAuthEnabledEnv;

export interface TeviAuthDisabledEnv {
  enabled: false;
  allowAnonymousUsers: false;
}

export interface TeviAuthEnabledEnv {
  enabled: true;
  appId: string;
  jwksUrl: string;
  allowAnonymousUsers: boolean;
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
    budgetProtectionEnabled: source.BUDGET_PROTECTION_ENABLED !== "false",
    teviAuth: parseTeviAuthEnv(source)
  };

  if (databaseUrl) {
    env.databaseUrl = databaseUrl;
  }

  return env;
}

function parseTeviAuthEnv(source: NodeJS.ProcessEnv): TeviAuthEnv {
  const enabled = source.TEVI_AUTH_ENABLED === "true" || Boolean(source.TEVI_APP_ID) || Boolean(source.TEVI_JWKS_URL);
  if (!enabled) {
    return {
      enabled: false,
      allowAnonymousUsers: false
    };
  }

  const appId = source.TEVI_APP_ID?.trim();
  if (!appId) {
    throw new Error("TEVI_APP_ID is required when Tevi auth is enabled");
  }

  const jwksUrl = source.TEVI_JWKS_URL?.trim();
  if (!jwksUrl) {
    throw new Error("TEVI_JWKS_URL is required when Tevi auth is enabled");
  }
  validateTeviJwksUrl(jwksUrl);

  return {
    enabled: true,
    appId,
    jwksUrl,
    allowAnonymousUsers: source.TEVI_ALLOW_ANONYMOUS_USERS === "true"
  };
}

function validateTeviJwksUrl(rawUrl: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("TEVI_JWKS_URL must be a valid HTTPS URL");
  }

  if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname) {
    throw new Error("TEVI_JWKS_URL must be a valid HTTPS URL");
  }
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
