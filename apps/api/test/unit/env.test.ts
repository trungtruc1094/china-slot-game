import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env.js";

describe("loadEnv", () => {
  it("loads defaults for local development", () => {
    expect(loadEnv({})).toEqual({
      nodeEnv: "development",
      port: 3000,
      persistenceMode: "memory"
    });
  });

  it("parses an explicit positive integer port", () => {
    expect(loadEnv({ NODE_ENV: "test", PORT: "4444" })).toEqual({
      nodeEnv: "test",
      port: 4444,
      persistenceMode: "memory"
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
      databaseUrl: "postgres://user:pass@localhost:5432/china_slot_test"
    });
  });

  it("rejects unknown persistence modes", () => {
    expect(() => loadEnv({ PERSISTENCE_MODE: "sqlite" })).toThrow("PERSISTENCE_MODE must be either memory or postgres");
  });
});
