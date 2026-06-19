import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryAdminAuditRepository } from "../../src/domain/admin-audit-repository.js";
import { InMemoryRequestTraceRepository } from "../../src/domain/request-trace-repository.js";
import { WalletService } from "../../src/domain/wallet-service.js";
import type { Clock } from "../../src/domain/session-service.js";
import type { ApiEnvelope } from "../../src/schemas/api-envelope.js";
import { simpleConfig } from "../fixtures/simple-config.js";

class MutableClock implements Clock {
  public current = new Date("2026-06-19T08:00:00.000Z");
  public now(): Date {
    return this.current;
  }
}

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let traces: InMemoryRequestTraceRepository;
let auditRepository: InMemoryAdminAuditRepository;
let walletService: WalletService;
let clock: MutableClock;

beforeEach(async () => {
  clock = new MutableClock();
  traces = new InMemoryRequestTraceRepository();
  auditRepository = new InMemoryAdminAuditRepository(clock);
  walletService = new WalletService(clock);
  server = createServer(createApp({
    clock,
    requestTraceRepository: traces,
    adminAuditRepository: auditRepository,
    walletService,
    activeConfig: simpleConfig,
    nextRandom: () => 0
  }));
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

async function createSession(): Promise<string> {
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "trace_session" },
    body: JSON.stringify({
      identity: { provider: "demo", subject: "player-trace", expiresAt: "2026-06-20T10:00:00.000Z" }
    })
  });
  const body = await response.json() as ApiEnvelope<{ sessionId: string }>;
  return body.data?.sessionId ?? "";
}

describe("request tracing", () => {
  it("emits a trace with correlation ID for public endpoints", async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { "x-request-id": "trace_health" }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("trace_health");
    expect(traces.list()).toEqual([
      expect.objectContaining({
        correlationId: "trace_health",
        method: "GET",
        path: "/api/health",
        statusCode: 200,
        outcome: "succeeded",
        latencyMs: expect.any(Number)
      })
    ]);
    expect(traces.list()[0]).not.toHaveProperty("body");
    expect(traces.list()[0]).not.toHaveProperty("identity");
  });

  it("links a spin endpoint trace, wallet transaction, and audit event by correlation ID", async () => {
    const sessionId = await createSession();
    const response = await fetch(`${baseUrl}/api/spins`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "trace_spin_1" },
      body: JSON.stringify({
        clientSpinId: "trace-spin",
        sessionId,
        wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
      })
    });

    expect(response.status).toBe(200);
    expect(traces.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        correlationId: "trace_spin_1",
        method: "POST",
        path: "/api/spins",
        statusCode: 200,
        outcome: "succeeded"
      })
    ]));
    expect(walletService.listTransactions()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metadata: expect.objectContaining({ correlationId: "trace_spin_1" })
      })
    ]));
    expect(auditRepository.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requestId: "trace_spin_1",
        source: "spins",
        action: "spin.accepted",
        resource: expect.objectContaining({ type: "spin" })
      })
    ]));
  });
});
