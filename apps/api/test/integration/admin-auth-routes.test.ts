import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import type { ApiEnvelope } from "../../src/schemas/api-envelope.js";

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

function adminHeaders(role: string, actor = `${role}-1`): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-admin-role": role,
    "x-admin-actor": actor,
    "x-request-id": `req_${role}_auth_test`
  };
}

describe("admin authentication and roles", () => {
  it("allows each explicit role to access an allowed endpoint", async () => {
    for (const role of ["admin", "operator", "support", "viewer"]) {
      const response = await fetch(`${baseUrl}/api/admin/metrics`, {
        headers: adminHeaders(role)
      });
      const body = await response.json() as ApiEnvelope<{ metrics: Record<string, unknown> }>;

      expect(response.status).toBe(200);
      expect(body.data?.metrics).toBeDefined();
      expect(body.error).toBeNull();
    }
  });

  it("rejects each non-admin role from a disallowed endpoint with forbidden", async () => {
    for (const role of ["support", "viewer"]) {
      const response = await fetch(`${baseUrl}/api/admin/configs/drafts`, {
        method: "POST",
        headers: adminHeaders(role),
        body: JSON.stringify({ id: "blocked-draft", config: {}, reason: "blocked" })
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        data: null,
        error: { code: "ADMIN_FORBIDDEN" }
      });
    }
  });

  it("distinguishes unauthenticated admin access from forbidden admin access", async () => {
    const unauthenticatedResponse = await fetch(`${baseUrl}/api/admin/metrics`);
    const forbiddenResponse = await fetch(`${baseUrl}/api/admin/configs/drafts`, {
      method: "POST",
      headers: adminHeaders("viewer"),
      body: JSON.stringify({ id: "viewer-draft", config: {}, reason: "blocked" })
    });

    expect(unauthenticatedResponse.status).toBe(401);
    await expect(unauthenticatedResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "ADMIN_UNAUTHENTICATED" }
    });
    expect(forbiddenResponse.status).toBe(403);
    await expect(forbiddenResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "ADMIN_FORBIDDEN" }
    });
  });

  it("does not allow any admin endpoint without a valid role", async () => {
    const endpoints: Array<{ method: string; path: string }> = [
      { method: "GET", path: "/api/admin/metrics" },
      { method: "GET", path: "/api/admin/configs/drafts" },
      { method: "GET", path: "/api/admin/operator-limits" },
      { method: "GET", path: "/api/admin/alert-rules" },
      { method: "GET", path: "/api/admin/budget-protection/actions" }
    ];

    for (const endpoint of endpoints) {
      const response = await fetch(`${baseUrl}${endpoint.path}`, { method: endpoint.method });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        data: null,
        error: { code: "ADMIN_UNAUTHENTICATED" }
      });
    }
  });
});
