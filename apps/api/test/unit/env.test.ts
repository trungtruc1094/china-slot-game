import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env.js";

describe("loadEnv", () => {
  it("loads defaults for local development", () => {
    expect(loadEnv({})).toEqual({
      nodeEnv: "development",
      port: 3000,
      persistenceMode: "memory",
      budgetProtectionEnabled: true,
      teviAuth: {
        enabled: false,
        allowAnonymousUsers: false
      }
    });
  });

  it("parses an explicit positive integer port", () => {
    expect(loadEnv({ NODE_ENV: "test", PORT: "4444" })).toEqual({
      nodeEnv: "test",
      port: 4444,
      persistenceMode: "memory",
      budgetProtectionEnabled: true,
      teviAuth: {
        enabled: false,
        allowAnonymousUsers: false
      }
    });
  });

  it("rejects invalid ports", () => {
    expect(() => loadEnv({ PORT: "not-a-number" })).toThrow("PORT must be an integer between 1 and 65535");
    expect(() => loadEnv({ PORT: "0" })).toThrow("PORT must be an integer between 1 and 65535");
    expect(() => loadEnv({ PORT: "3000abc" })).toThrow("PORT must be an integer between 1 and 65535");
    expect(() => loadEnv({ PORT: "123.45" })).toThrow("PORT must be an integer between 1 and 65535");
    expect(() => loadEnv({ PORT: "65536" })).toThrow("PORT must be an integer between 1 and 65535");
  });

  it("requires a valid database URL for production or postgres persistence mode", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow("DATABASE_URL is required");
    expect(() => loadEnv({ PERSISTENCE_MODE: "postgres" })).toThrow("DATABASE_URL is required");
    expect(() => loadEnv({ PERSISTENCE_MODE: "postgres", DATABASE_URL: "not-a-url" })).toThrow("DATABASE_URL must be a valid PostgreSQL connection URL");
    expect(() => loadEnv({ PERSISTENCE_MODE: "postgres", DATABASE_URL: "mysql://localhost/db" })).toThrow("DATABASE_URL must use the postgres:// or postgresql:// scheme");
    expect(() => loadEnv({ PERSISTENCE_MODE: "postgres", DATABASE_URL: "postgres:///china_slot_test" })).toThrow("DATABASE_URL must include a hostname");
    expect(() => loadEnv({ PERSISTENCE_MODE: "postgres", DATABASE_URL: "postgres://localhost" })).toThrow("DATABASE_URL must include a database name");
    expect(loadEnv({ PERSISTENCE_MODE: "postgres", DATABASE_URL: "postgres://user:pass@localhost:5432/china_slot_test" })).toEqual({
      nodeEnv: "development",
      port: 3000,
      persistenceMode: "postgres",
      budgetProtectionEnabled: true,
      databaseUrl: "postgres://user:pass@localhost:5432/china_slot_test",
      teviAuth: {
        enabled: false,
        allowAnonymousUsers: false
      }
    });
  });

  it("parses budget protection enablement", () => {
    expect(loadEnv({ BUDGET_PROTECTION_ENABLED: "false" })).toMatchObject({ budgetProtectionEnabled: false });
    expect(loadEnv({ BUDGET_PROTECTION_ENABLED: "true" })).toMatchObject({ budgetProtectionEnabled: true });
    expect(loadEnv({})).toMatchObject({ budgetProtectionEnabled: true });
  });

  it("defaults Tevi auth to disabled with anonymous users blocked", () => {
    expect(loadEnv({})).toMatchObject({
      teviAuth: {
        enabled: false,
        allowAnonymousUsers: false
      }
    });
  });

  it("requires Tevi app and JWKS settings when Tevi auth mode is enabled", () => {
    expect(() => loadEnv({ TEVI_AUTH_ENABLED: "true" })).toThrow("TEVI_APP_ID is required when Tevi auth is enabled");
    expect(() => loadEnv({ TEVI_AUTH_ENABLED: "true", TEVI_APP_ID: "AZX29173" })).toThrow("TEVI_JWKS_URL is required when Tevi auth is enabled");
  });

  it("parses explicit Tevi auth configuration", () => {
    expect(loadEnv({
      TEVI_AUTH_ENABLED: "true",
      TEVI_APP_ID: "AZX29173",
      TEVI_JWKS_URL: "https://sandbox.tevi.example/api/v1/auth/jwks",
      TEVI_ALLOW_ANONYMOUS_USERS: "true"
    })).toMatchObject({
      teviAuth: {
        enabled: true,
        appId: "AZX29173",
        jwksUrl: "https://sandbox.tevi.example/api/v1/auth/jwks",
        allowAnonymousUsers: true
      }
    });
  });

  it("parses Tevi token exchange configuration with a sandbox HTTPS default", () => {
    expect(loadEnv({
      TEVI_AUTH_ENABLED: "true",
      TEVI_APP_ID: "AZX29173",
      TEVI_JWKS_URL: "https://sandbox.tevi.example/api/v1/auth/jwks"
    })).toMatchObject({
      teviAuth: {
        enabled: true,
        appId: "AZX29173",
        jwksUrl: "https://sandbox.tevi.example/api/v1/auth/jwks",
        tokenExchange: {
          enabled: true,
          apiBase: "https://developer-api.sbx.tevi.dev"
        }
      }
    });
  });

  it("allows Tevi token exchange to be explicitly disabled", () => {
    expect(loadEnv({
      TEVI_AUTH_ENABLED: "true",
      TEVI_APP_ID: "AZX29173",
      TEVI_JWKS_URL: "https://sandbox.tevi.example/api/v1/auth/jwks",
      TEVI_TOKEN_EXCHANGE_ENABLED: "false"
    })).toMatchObject({
      teviAuth: {
        enabled: true,
        tokenExchange: {
          enabled: false
        }
      }
    });
  });

  it("requires explicit HTTPS Tevi API base outside local/test token exchange defaults", () => {
    expect(() => loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://user:pass@localhost:5432/china_slot_test",
      TEVI_AUTH_ENABLED: "true",
      TEVI_APP_ID: "AZX29173",
      TEVI_JWKS_URL: "https://sandbox.tevi.example/api/v1/auth/jwks"
    })).toThrow("TEVI_API_BASE is required when Tevi token exchange is enabled outside development/test");

    expect(() => loadEnv({
      TEVI_AUTH_ENABLED: "true",
      TEVI_APP_ID: "AZX29173",
      TEVI_JWKS_URL: "https://sandbox.tevi.example/api/v1/auth/jwks",
      TEVI_API_BASE: "http://developer-api.sbx.tevi.dev"
    })).toThrow("TEVI_API_BASE must be a valid HTTPS URL");

    expect(loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://user:pass@localhost:5432/china_slot_test",
      TEVI_AUTH_ENABLED: "true",
      TEVI_APP_ID: "AZX29173",
      TEVI_JWKS_URL: "https://sandbox.tevi.example/api/v1/auth/jwks",
      TEVI_API_BASE: "https://developer-api.flowstreamx.com"
    })).toMatchObject({
      teviAuth: {
        enabled: true,
        tokenExchange: {
          enabled: true,
          apiBase: "https://developer-api.flowstreamx.com"
        }
      }
    });
  });

  it("lets an explicit Tevi auth disabled flag override leftover Tevi settings", () => {
    expect(loadEnv({
      TEVI_AUTH_ENABLED: "false",
      TEVI_APP_ID: "AZX29173",
      TEVI_JWKS_URL: "https://sandbox.tevi.example/api/v1/auth/jwks"
    })).toMatchObject({
      teviAuth: {
        enabled: false,
        allowAnonymousUsers: false
      }
    });
  });

  it("rejects invalid Tevi JWKS URLs", () => {
    expect(() => loadEnv({
      TEVI_AUTH_ENABLED: "true",
      TEVI_APP_ID: "AZX29173",
      TEVI_JWKS_URL: "not-a-url"
    })).toThrow("TEVI_JWKS_URL must be a valid HTTPS URL");
    expect(() => loadEnv({
      TEVI_AUTH_ENABLED: "true",
      TEVI_APP_ID: "AZX29173",
      TEVI_JWKS_URL: "http://sandbox.tevi.example/api/v1/auth/jwks"
    })).toThrow("TEVI_JWKS_URL must be a valid HTTPS URL");
  });

  it("rejects unknown persistence modes", () => {
    expect(() => loadEnv({ PERSISTENCE_MODE: "sqlite" })).toThrow("PERSISTENCE_MODE must be either memory or postgres");
  });
});
