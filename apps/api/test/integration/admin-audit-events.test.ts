import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryAdminAuditRepository } from "../../src/domain/admin-audit-repository.js";
import { InMemoryPlayerIdentityAdapter } from "../../src/domain/player-identity.js";
import { SessionService, type Clock } from "../../src/domain/session-service.js";
import { SpinService } from "../../src/domain/spin-service.js";
import { WalletService } from "../../src/domain/wallet-service.js";
import { simpleConfig } from "../fixtures/simple-config.js";

class MutableClock implements Clock {
  public current = new Date("2026-06-18T08:00:00.000Z");
  public now(): Date {
    return this.current;
  }
}

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let auditRepository: InMemoryAdminAuditRepository;

beforeEach(async () => {
  const clock = new MutableClock();
  auditRepository = new InMemoryAdminAuditRepository(clock);
  const sessionService = new SessionService(new InMemoryPlayerIdentityAdapter(), clock);
  const walletService = new WalletService(clock);
  const spinService = new SpinService(
    sessionService,
    walletService,
    { activeConfig: simpleConfig, nextRandom: () => 0 },
    clock
  );
  server = createServer(createApp({ clock, sessionService, walletService, spinService, adminAuditRepository: auditRepository }));
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

function adminHeaders(role = "support", actor = "support-1"): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-admin-role": role,
    "x-admin-actor": actor,
    "x-request-id": "req_admin_audit_test"
  };
}

async function createSession(): Promise<string> {
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identity: {
        provider: "demo",
        subject: "player-a",
        expiresAt: "2026-06-18T09:00:00.000Z"
      }
    })
  });
  const body = await response.json() as { data?: { sessionId?: string } };
  return body.data?.sessionId ?? "";
}

async function postSpin(sessionId: string): Promise<void> {
  await fetch(`${baseUrl}/api/spins`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientSpinId: "spin-audit",
      sessionId,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    })
  });
}

describe("admin audit events from admin routes", () => {
  it("records spin ledger and balance transaction searches", async () => {
    const sessionId = await createSession();
    await postSpin(sessionId);

    await fetch(`${baseUrl}/api/admin/spins?playerId=player_1`, { headers: adminHeaders("support", "support-1") });
    await fetch(`${baseUrl}/api/admin/balance-transactions?sessionId=${sessionId}`, { headers: adminHeaders("operator", "operator-1") });

    expect(auditRepository.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor: "support-1",
        role: "support",
        action: "admin.spin_ledger.search",
        source: "support-search",
        requestId: "req_admin_audit_test",
        outcome: "succeeded"
      }),
      expect.objectContaining({
        actor: "operator-1",
        role: "operator",
        action: "admin.balance_transactions.search",
        source: "support-search",
        requestId: "req_admin_audit_test",
        outcome: "succeeded"
      })
    ]));
  });

  it("records protected admin auth failures", async () => {
    await fetch(`${baseUrl}/api/admin/spins`);
    await fetch(`${baseUrl}/api/admin/balance-transactions`, { headers: adminHeaders("viewer", "viewer-1") });

    expect(auditRepository.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "admin.auth.unauthenticated",
        source: "auth",
        outcome: "failed"
      }),
      expect.objectContaining({
        action: "admin.auth.forbidden",
        source: "auth",
        outcome: "failed"
      })
    ]));
  });
});
