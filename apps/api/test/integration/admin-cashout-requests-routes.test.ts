import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryAdminAuditRepository } from "../../src/domain/admin-audit-repository.js";
import type { CashoutRequestDetailRecord } from "../../src/domain/cashout-reconciliation-service.js";
import type { CashoutReconciliationServicePort } from "../../src/routes/admin-cashout-requests.routes.js";
import type { ApiEnvelope } from "../../src/schemas/api-envelope.js";

const sampleRecord: CashoutRequestDetailRecord = {
  cashoutRequestId: "cashout_test_1",
  playerId: "player_1",
  teviSubject: "tevi-user-1",
  amount: 250,
  status: "failed_retryable",
  reconciliationState: "retry_required",
  dispatchAttemptCount: 1,
  failureReason: "PROVIDER_UNAVAILABLE",
  providerStatusCode: 503,
  providerResponseSummary: {
    providerStatusCode: 503,
    failureReason: "PROVIDER_UNAVAILABLE",
    hasWebhookCorrelation: false,
    retrySource: null
  },
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  payloadFingerprint: "fingerprint",
  requestId: "req_player_cashout",
  walletTransactionId: "txn_test_1",
  relatedSpinId: null,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  dispatchedAt: null
};

class FakeReconciliationService implements CashoutReconciliationServicePort {
  public retryCalls: string[] = [];
  public lastRetryRequestId: string | null = null;

  public constructor(
    private readonly searchResult: { records: CashoutRequestDetailRecord[]; total: number } = { records: [sampleRecord], total: 1 },
    private readonly detail: CashoutRequestDetailRecord | null = sampleRecord,
    private readonly retryResult: Awaited<ReturnType<CashoutReconciliationServicePort["retryDispatch"]>> = {
      ok: true,
      cashoutRequestId: "cashout_test_1",
      status: "dispatched",
      dispatchAttemptCount: 2,
      reconciliationState: "provider_dispatched"
    }
  ) {}

  public async searchRecords() {
    return this.searchResult;
  }

  public async getRecord(cashoutRequestId: string) {
    return this.detail?.cashoutRequestId === cashoutRequestId ? this.detail : null;
  }

  public async retryDispatch(cashoutRequestId: string, actorRequestId: string) {
    this.retryCalls.push(cashoutRequestId);
    this.lastRetryRequestId = actorRequestId;
    return this.retryResult;
  }
}

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let reconciliationService: FakeReconciliationService;

beforeEach(async () => {
  reconciliationService = new FakeReconciliationService();
  server = createServer(createApp({
    cashoutReconciliationService: reconciliationService,
    adminAuditRepository: new InMemoryAdminAuditRepository()
  }));
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

function adminHeaders(role = "support", actor = "support-1", requestId = "req_admin_cashout_test"): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-admin-role": role,
    "x-admin-actor": actor,
    "x-request-id": requestId
  };
}

describe("admin cashout request routes", () => {
  it("returns searchable cashout records for support", async () => {
    const response = await fetch(
      `${baseUrl}/api/admin/cashout-requests?status=failed_retryable&reconciliationState=retry_required&playerId=player_1&requestId=req_player_cashout&from=2026-07-01T00:00:00.000Z&to=2026-07-02T00:00:00.000Z`,
      { headers: adminHeaders() }
    );
    const body = await response.json() as ApiEnvelope<{
      records: Array<{ cashoutRequestId: string; reconciliationState: string; dispatchedAt: string | null }>;
      page: { hasMore: boolean };
    }>;

    expect(response.status).toBe(200);
    expect(body.data?.records[0]).toMatchObject({
      cashoutRequestId: "cashout_test_1",
      reconciliationState: "retry_required",
      dispatchAttemptCount: 1,
      dispatchedAt: null
    });
    expect(body.data?.page.hasMore).toBe(false);
  });

  it("returns cashout detail by id", async () => {
    const response = await fetch(`${baseUrl}/api/admin/cashout-requests/cashout_test_1`, {
      headers: adminHeaders()
    });
    const body = await response.json() as ApiEnvelope<{ record: { walletTransactionId: string; requestId: string } }>;

    expect(response.status).toBe(200);
    expect(body.data?.record).toMatchObject({
      walletTransactionId: "txn_test_1",
      requestId: "req_player_cashout"
    });
  });

  it("returns 404 when cashout detail is missing", async () => {
    reconciliationService = new FakeReconciliationService(undefined, null);
    server.close();
    server = createServer(createApp({ cashoutReconciliationService: reconciliationService }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const response = await fetch(`${baseUrl}/api/admin/cashout-requests/cashout_missing`, {
      headers: adminHeaders()
    });
    const body = await response.json() as ApiEnvelope<unknown>;

    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("CASHOUT_NOT_FOUND");
  });

  it("rejects invalid search query ranges", async () => {
    const response = await fetch(
      `${baseUrl}/api/admin/cashout-requests?from=2026-07-02T00:00:00.000Z&to=2026-07-01T00:00:00.000Z`,
      { headers: adminHeaders() }
    );
    const body = await response.json() as ApiEnvelope<unknown>;

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("INVALID_CASHOUT_REQUEST_QUERY");
  });

  it("requires admin authentication for search", async () => {
    const response = await fetch(`${baseUrl}/api/admin/cashout-requests`, {
      headers: { "content-type": "application/json" }
    });
    const body = await response.json() as ApiEnvelope<unknown>;

    expect(response.status).toBe(401);
    expect(body.error?.code).toBe("ADMIN_UNAUTHENTICATED");
  });

  it("allows operator retry dispatch", async () => {
    const response = await fetch(`${baseUrl}/api/admin/cashout-requests/cashout_test_1/retry`, {
      method: "POST",
      headers: adminHeaders("operator", "operator-1", "req_operator_retry")
    });
    const body = await response.json() as ApiEnvelope<{ status: string; dispatch_attempt_count: number }>;

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ status: "dispatched", dispatch_attempt_count: 2 });
    expect(reconciliationService.retryCalls).toEqual(["cashout_test_1"]);
    expect(reconciliationService.lastRetryRequestId).toBe("req_operator_retry");
  });

  it("surfaces retry-not-allowed failures from the service", async () => {
    reconciliationService = new FakeReconciliationService(undefined, sampleRecord, {
      ok: false,
      code: "CASHOUT_RETRY_NOT_ALLOWED",
      reasonCode: "ALREADY_DISPATCHED",
      statusCode: 409
    });
    server.close();
    server = createServer(createApp({ cashoutReconciliationService: reconciliationService }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const response = await fetch(`${baseUrl}/api/admin/cashout-requests/cashout_test_1/retry`, {
      method: "POST",
      headers: adminHeaders("operator", "operator-1")
    });
    const body = await response.json() as ApiEnvelope<unknown>;

    expect(response.status).toBe(409);
    expect(body.error?.code).toBe("CASHOUT_RETRY_NOT_ALLOWED");
  });

  it("surfaces retry dispatch failures from the service", async () => {
    reconciliationService = new FakeReconciliationService(undefined, sampleRecord, {
      ok: false,
      code: "CASHOUT_RETRY_DISPATCH_FAILED",
      reasonCode: "PROVIDER_UNAVAILABLE",
      statusCode: 503,
      providerStatusCode: 503
    });
    server.close();
    server = createServer(createApp({ cashoutReconciliationService: reconciliationService }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const response = await fetch(`${baseUrl}/api/admin/cashout-requests/cashout_test_1/retry`, {
      method: "POST",
      headers: adminHeaders("operator", "operator-1")
    });
    const body = await response.json() as ApiEnvelope<unknown>;

    expect(response.status).toBe(503);
    expect(body.error?.code).toBe("CASHOUT_RETRY_DISPATCH_FAILED");
  });

  it("rejects support role from operator retry endpoint", async () => {
    const response = await fetch(`${baseUrl}/api/admin/cashout-requests/cashout_test_1/retry`, {
      method: "POST",
      headers: adminHeaders("support", "support-1")
    });

    expect(response.status).toBe(403);
  });
});
