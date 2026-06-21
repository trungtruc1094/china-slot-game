import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

let server: ReturnType<typeof createServer>;
let baseUrl: string;

beforeEach(async () => {
  server = createServer(createApp());
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

describe("health and readiness routes", () => {
  it("returns stable API envelopes with request IDs", async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { "x-request-id": "req_test_health" }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req_test_health");
    await expect(response.json()).resolves.toEqual({
      data: {
        status: "ok",
        service: "china-slot-api"
      },
      error: null,
      requestId: "req_test_health"
    });
  });

  it("returns readiness dependency state in the same envelope contract", async () => {
    const response = await fetch(`${baseUrl}/api/ready`);
    const body = await response.json() as { requestId: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        status: "ok",
        service: "china-slot-api",
        dependencies: {
          api: "ready"
        }
      },
      error: null,
      requestId: expect.stringMatching(/^req_[0-9a-f-]+$/)
    });
  });

  it("returns 503 when an injected readiness dependency fails", async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = createServer(createApp({
      readinessCheck: async () => {
        throw new Error("schema not ready");
      }
    }));
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/api/ready`, {
      headers: { "x-request-id": "req_ready_failed" }
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: "READINESS_CHECK_FAILED",
        message: "schema not ready",
        details: {}
      },
      requestId: "req_ready_failed"
    });
  });

  it("returns stable error envelopes for missing routes", async () => {
    const response = await fetch(`${baseUrl}/api/missing`, {
      headers: { "x-request-id": "req_missing" }
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "No route matches GET /api/missing",
        details: {
          method: "GET",
          path: "/api/missing"
        }
      },
      requestId: "req_missing"
    });
  });

  it("returns client error envelopes for malformed JSON with request IDs", async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_bad_json"
      },
      body: "{"
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: "INVALID_JSON_BODY",
        message: "Request body must be valid JSON.",
        details: {}
      },
      requestId: "req_bad_json"
    });
  });

  it("generates a bounded request ID when the incoming request ID is invalid", async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { "x-request-id": "x".repeat(129) }
    });
    const body = await response.json() as { requestId: string };

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toMatch(/^req_[0-9a-f-]+$/);
    expect(body.requestId).toMatch(/^req_[0-9a-f-]+$/);
  });
});
