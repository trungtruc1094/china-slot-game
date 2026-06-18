import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env.js";

describe("loadEnv", () => {
  it("loads defaults for local development", () => {
    expect(loadEnv({})).toEqual({
      nodeEnv: "development",
      port: 3000
    });
  });

  it("parses an explicit positive integer port", () => {
    expect(loadEnv({ NODE_ENV: "test", PORT: "4444" })).toEqual({
      nodeEnv: "test",
      port: 4444
    });
  });

  it("rejects invalid ports", () => {
    expect(() => loadEnv({ PORT: "not-a-number" })).toThrow("PORT must be an integer between 1 and 65535");
    expect(() => loadEnv({ PORT: "0" })).toThrow("PORT must be an integer between 1 and 65535");
    expect(() => loadEnv({ PORT: "3000abc" })).toThrow("PORT must be an integer between 1 and 65535");
    expect(() => loadEnv({ PORT: "123.45" })).toThrow("PORT must be an integer between 1 and 65535");
    expect(() => loadEnv({ PORT: "65536" })).toThrow("PORT must be an integer between 1 and 65535");
  });
});
