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
  tokenExchange: TeviTokenExchangeEnv;
  payment: TeviPaymentEnv;
}

export type TeviTokenExchangeEnv = TeviTokenExchangeDisabledEnv | TeviTokenExchangeEnabledEnv;

export interface TeviTokenExchangeDisabledEnv {
  enabled: false;
}

export interface TeviTokenExchangeEnabledEnv {
  enabled: true;
  apiBase: string;
}

export type TeviPaymentEnv = TeviPaymentDisabledEnv | TeviPaymentEnabledEnv;

export interface TeviPaymentDisabledEnv {
  enabled: false;
}

export interface TeviPaymentEnabledEnv {
  enabled: true;
  apiBase: string;
  depositTokenPath: string;
  apiKey: string;
  secretKey: string;
  billingChannelId: string;
  depositMinStars: number;
  depositMaxStars: number;
  // Webhook crediting secret (Story 8.6). Tevi confirmed the webhook is signed with the SAME secret key they
  // issue for payment calls, so this defaults to `secretKey` (TEVI_SECRET_KEY). An explicit TEVI_WEBHOOK_SECRET
  // overrides it only if Tevi ever splits them. Always present when payment is enabled; never logged.
  webhookSecret: string;
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
    teviAuth: parseTeviAuthEnv(source, nodeEnv)
  };

  if (databaseUrl) {
    env.databaseUrl = databaseUrl;
  }

  return env;
}

function parseTeviAuthEnv(source: NodeJS.ProcessEnv, nodeEnv: string): TeviAuthEnv {
  const explicitlyDisabled = source.TEVI_AUTH_ENABLED === "false";
  const enabled = !explicitlyDisabled && (source.TEVI_AUTH_ENABLED === "true" || Boolean(source.TEVI_APP_ID) || Boolean(source.TEVI_JWKS_URL));
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
    allowAnonymousUsers: source.TEVI_ALLOW_ANONYMOUS_USERS === "true",
    tokenExchange: parseTeviTokenExchangeEnv(source, nodeEnv),
    payment: parseTeviPaymentEnv(source, nodeEnv)
  };
}

function parseTeviPaymentEnv(source: NodeJS.ProcessEnv, nodeEnv: string): TeviPaymentEnv {
  if (source.TEVI_PAYMENT_ENABLED !== "true") {
    return { enabled: false };
  }

  if (nodeEnv !== "development" && nodeEnv !== "test" && source.PERSISTENCE_MODE !== "postgres") {
    throw new Error("PERSISTENCE_MODE=postgres is required when Tevi payment is enabled outside development/test");
  }

  const apiBase = source.TEVI_PAYMENT_API_BASE?.trim() || source.TEVI_API_BASE?.trim() || "https://developer-api.sbx.tevi.dev";
  validatePaymentApiBase(apiBase);

  const depositTokenPath = source.TEVI_DEPOSIT_TOKEN_PATH?.trim() || "/api/v1/payments/deposit-token";
  if (!depositTokenPath.startsWith("/")) {
    throw new Error("TEVI_DEPOSIT_TOKEN_PATH must start with /");
  }

  const apiKey = source.TEVI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("TEVI_API_KEY is required when Tevi payment is enabled");
  }

  const secretKey = source.TEVI_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("TEVI_SECRET_KEY is required when Tevi payment is enabled");
  }

  const billingChannelId = source.TEVI_BILLING_CHANNEL_ID?.trim() || source.TEVI_CHANNEL_ID?.trim();
  if (!billingChannelId) {
    throw new Error("TEVI_BILLING_CHANNEL_ID is required when Tevi payment is enabled");
  }

  const depositMinStars = parsePositiveSafeInteger(source.TEVI_DEPOSIT_MIN_STARS ?? "1", "TEVI_DEPOSIT_MIN_STARS");
  const depositMaxStars = parsePositiveSafeInteger(source.TEVI_DEPOSIT_MAX_STARS ?? "10000", "TEVI_DEPOSIT_MAX_STARS");
  if (depositMaxStars < depositMinStars) {
    throw new Error("TEVI_DEPOSIT_MAX_STARS must be greater than or equal to TEVI_DEPOSIT_MIN_STARS");
  }

  // Tevi signs user_topup webhooks with the SAME secret key (TEVI_SECRET_KEY) they issue for payment calls,
  // so the webhook secret defaults to `secretKey`. TEVI_WEBHOOK_SECRET is an optional override (kept in case
  // Tevi ever splits them, and useful for tests). Never log either value.
  const rawWebhookSecret = source.TEVI_WEBHOOK_SECRET?.trim();
  if (source.TEVI_WEBHOOK_SECRET !== undefined && (!rawWebhookSecret || rawWebhookSecret.length === 0)) {
    throw new Error("TEVI_WEBHOOK_SECRET must be a non-empty value when provided");
  }

  return {
    enabled: true,
    apiBase,
    depositTokenPath,
    apiKey,
    secretKey,
    billingChannelId,
    depositMinStars,
    depositMaxStars,
    webhookSecret: rawWebhookSecret ?? secretKey
  };
}

function parseTeviTokenExchangeEnv(source: NodeJS.ProcessEnv, nodeEnv: string): TeviTokenExchangeEnv {
  if (source.TEVI_TOKEN_EXCHANGE_ENABLED === "false") {
    return { enabled: false };
  }

  const rawApiBase = source.TEVI_API_BASE?.trim();
  if (!rawApiBase && nodeEnv !== "development" && nodeEnv !== "test") {
    throw new Error("TEVI_API_BASE is required when Tevi token exchange is enabled outside development/test");
  }

  const apiBase = rawApiBase ?? "https://developer-api.sbx.tevi.dev";
  validateTeviApiBase(apiBase);

  return {
    enabled: true,
    apiBase
  };
}

function validateTeviJwksUrl(rawUrl: string): void {
  validateHttpsUrl(rawUrl, "TEVI_JWKS_URL");
}

function validateTeviApiBase(rawUrl: string): void {
  validateHttpsUrl(rawUrl, "TEVI_API_BASE");
}

function validatePaymentApiBase(rawUrl: string): void {
  validateHttpsUrl(rawUrl, "TEVI_PAYMENT_API_BASE");
}

function parsePositiveSafeInteger(rawValue: string, name: string): number {
  const parsedValue = Number(rawValue);
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }

  return parsedValue;
}

function validateHttpsUrl(rawUrl: string, name: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }

  if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname) {
    throw new Error(`${name} must be a valid HTTPS URL`);
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
