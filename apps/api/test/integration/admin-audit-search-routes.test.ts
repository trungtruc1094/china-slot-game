import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryAdminAuditRepository } from "../../src/domain/admin-audit-repository.js";
import type { Clock } from "../../src/domain/session-service.js";
import type { ApiEnvelope } from "../../src/schemas/api-envelope.js";

class MutableClock implements Clock {
  public current = new Date("2026-06-18T08:00:00.000Z");
  public now(): Date {
    return this.current;
  }
}

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let clock: MutableClock;
let auditRepository: InMemoryAdminAuditRepository;

beforeEach(async () => {
  clock = new MutableClock();
  auditRepository = new InMemoryAdminAuditRepository(clock);
  server = createServer(createApp({ clock, adminAuditRepository: auditRepository }));
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

function adminHeaders(role = "operator", actor = "operator-1"): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-admin-role": role,
    "x-admin-actor": actor,
    "x-request-id": "req_admin_audit_search_test"
  };
}

function seedAuditEvents(): void {
  auditRepository.record({
    actor: "operator-1",
    role: "operator",
    action: "config.activate",
    resource: { type: "config_version", id: "draft-1" },
    requestId: "req-config",
    reason: "launch",
    source: "config",
    outcome: "succeeded",
    after: { versionId: "simple-config-v1" },
    metadata: { configId: "simple-config" }
  });
  clock.current = new Date("2026-06-18T08:05:00.000Z");
  auditRepository.record({
    actor: "support-1",
    role: "support",
    action: "admin.spin_ledger.search",
    resource: { type: "admin_search", id: "req-search" },
    requestId: "req-search",
    source: "support-search",
    outcome: "succeeded",
    metadata: { returned: 1, total: 1 }
  });
  clock.current = new Date("2026-06-18T08:10:00.000Z");
  auditRepository.record({
    actor: "alert-service",
    role: "system",
    action: "alert.firing",
    resource: { type: "alert", id: "alert_1" },
    source: "alerts",
    outcome: "succeeded",
    after: { status: "firing", severity: "critical" },
    metadata: { evaluationKey: "rule-1|window" }
  });
}

describe("admin audit search", () => {
  it("returns bounded unified events from multiple sources", async () => {
    seedAuditEvents();

    const response = await fetch(`${baseUrl}/api/admin/audit-events?limit=2`, {
      headers: adminHeaders("support", "support-1")
    });
    const body = await response.json() as ApiEnvelope<{
      events: Array<Record<string, unknown>>;
      page: Record<string, unknown>;
    }>;

    expect(response.status).toBe(200);
    expect(body.data?.page).toEqual({ limit: 2, offset: 0, total: 3, hasMore: true });
    expect(body.data?.events).toHaveLength(2);
    expect(new Set(body.data?.events.map((event) => event.source))).toEqual(new Set(["alerts", "support-search"]));
    expect(body.data?.events[0]).toMatchObject({
      action: "alert.firing",
      resource: { type: "alert", id: "alert_1" },
      outcome: "succeeded",
      metadata: { evaluationKey: "rule-1|window" }
    });
    expect(body.data?.events[0]).not.toHaveProperty("identity");
    expect(body.data?.events[0]).not.toHaveProperty("providerSubject");
  });

  it("filters by actor, action, resource, request id, source, and time range", async () => {
    seedAuditEvents();

    const response = await fetch(
      `${baseUrl}/api/admin/audit-events?actor=operator-1&action=config.activate&resourceType=config_version&resourceId=draft-1&requestId=req-config&source=config&from=2026-06-18T07:59:00.000Z&to=2026-06-18T08:01:00.000Z`,
      { headers: adminHeaders("operator", "operator-1") }
    );
    const body = await response.json() as ApiEnvelope<{
      events: Array<Record<string, unknown>>;
      page: Record<string, unknown>;
    }>;

    expect(response.status).toBe(200);
    expect(body.data?.page).toEqual({ limit: 25, offset: 0, total: 1, hasMore: false });
    expect(body.data?.events).toEqual([
      expect.objectContaining({
        actor: "operator-1",
        action: "config.activate",
        resource: { type: "config_version", id: "draft-1" },
        requestId: "req-config",
        source: "config",
        reason: "launch"
      })
    ]);
  });

  it("validates malformed query parameters", async () => {
    const response = await fetch(`${baseUrl}/api/admin/audit-events?limit=0&from=2026-06-18T08:01:00.000Z&to=2026-06-18T08:00:00.000Z`, {
      headers: adminHeaders()
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code: "INVALID_ADMIN_AUDIT_QUERY" }
    });
  });

  it("requires a support-capable admin role", async () => {
    const viewerResponse = await fetch(`${baseUrl}/api/admin/audit-events`, {
      headers: adminHeaders("viewer", "viewer-1")
    });
    const missingRoleResponse = await fetch(`${baseUrl}/api/admin/audit-events`);

    expect(viewerResponse.status).toBe(403);
    await expect(viewerResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "ADMIN_FORBIDDEN" }
    });
    expect(missingRoleResponse.status).toBe(401);
  });
});
