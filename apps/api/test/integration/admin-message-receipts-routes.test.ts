import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryAdminAuditRepository } from "../../src/domain/admin-audit-repository.js";
import type { TeviMessageReceiptRecord, TeviReceiptServicePort } from "../../src/domain/tevi-receipt-service.js";
import type { ApiEnvelope } from "../../src/schemas/api-envelope.js";

const sampleRecord: TeviMessageReceiptRecord = {
  receiptId: "receipt_test_1",
  messageType: "topup_credit",
  recipientTeviSubject: "1168097029",
  playerId: "player_1",
  sourceEventId: "evt_topup_1",
  sourceCorrelationKey: "topup:evt_topup_1",
  amount: 100,
  cashoutStatus: null,
  status: "failed_retryable",
  dispatchAttemptCount: 1,
  failureReason: "PROVIDER_UNAVAILABLE",
  providerStatusCode: 503,
  providerResponseSummary: { failureReason: "PROVIDER_UNAVAILABLE" },
  messageBodyPreview: "Your Stars top-up of 100 was credited. Reference: req_1.",
  requestId: "req_webhook_1",
  createdAt: new Date("2026-07-02T00:00:00.000Z"),
  updatedAt: new Date("2026-07-02T00:00:00.000Z"),
  sentAt: null
};

class FakeReceiptService implements TeviReceiptServicePort {
  public retryCalls: string[] = [];

  public constructor(
    private readonly searchResult: { records: TeviMessageReceiptRecord[]; total: number } = { records: [sampleRecord], total: 1 },
    private readonly detail: TeviMessageReceiptRecord | null = sampleRecord,
    private readonly retryResult: Awaited<ReturnType<TeviReceiptServicePort["retryDispatch"]>> = {
      ok: true,
      receiptId: "receipt_test_1",
      status: "sent",
      dispatchAttemptCount: 2
    }
  ) {}

  public async dispatchTopupReceipt(_input: Parameters<TeviReceiptServicePort["dispatchTopupReceipt"]>[0]) {
    return "sent" as const;
  }

  public async dispatchCashoutReceipt(_input: Parameters<TeviReceiptServicePort["dispatchCashoutReceipt"]>[0]) {
    return "sent" as const;
  }

  public async searchRecords() {
    return this.searchResult;
  }

  public async getRecord(receiptId: string) {
    return this.detail?.receiptId === receiptId ? this.detail : null;
  }

  public async retryDispatch(receiptId: string) {
    this.retryCalls.push(receiptId);
    return this.retryResult;
  }
}

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let receiptService: FakeReceiptService;

beforeEach(async () => {
  receiptService = new FakeReceiptService();
  server = createServer(createApp({
    teviReceiptService: receiptService,
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
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("admin message receipt routes", () => {
  it("searches message receipts for support role", async () => {
    const response = await fetch(`${baseUrl}/api/admin/message-receipts?messageType=topup_credit`, {
      headers: {
        "x-admin-role": "support",
        "x-admin-actor": "support_user"
      }
    });
    const body = await response.json() as ApiEnvelope<{ records: Array<{ receipt_id: string; status: string }>; total: number }>;

    expect(response.status).toBe(200);
    expect(body.data?.total).toBe(1);
    expect(body.data?.records[0]).toMatchObject({
      receipt_id: "receipt_test_1",
      status: "failed_retryable"
    });
  });

  it("returns receipt detail", async () => {
    const response = await fetch(`${baseUrl}/api/admin/message-receipts/receipt_test_1`, {
      headers: {
        "x-admin-role": "support",
        "x-admin-actor": "support_user"
      }
    });
    const body = await response.json() as ApiEnvelope<{ record: { source_event_id: string } }>;

    expect(response.status).toBe(200);
    expect(body.data?.record.source_event_id).toBe("evt_topup_1");
  });

  it("allows operator retry", async () => {
    const response = await fetch(`${baseUrl}/api/admin/message-receipts/receipt_test_1/retry`, {
      method: "POST",
      headers: {
        "x-admin-role": "operator",
        "x-admin-actor": "operator_user",
        "x-request-id": "req_admin_retry"
      }
    });
    const body = await response.json() as ApiEnvelope<{ status: string; dispatch_attempt_count: number }>;

    expect(response.status).toBe(200);
    expect(body.data?.status).toBe("sent");
    expect(receiptService.retryCalls).toEqual(["receipt_test_1"]);
  });

  it("returns 404 when receipt detail is missing", async () => {
    receiptService = new FakeReceiptService({ records: [], total: 0 }, null);
    server.close();
    server = createServer(createApp({
      teviReceiptService: receiptService,
      adminAuditRepository: new InMemoryAdminAuditRepository()
    }));
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const response = await fetch(`${baseUrl}/api/admin/message-receipts/receipt_missing`, {
      headers: {
        "x-admin-role": "support",
        "x-admin-actor": "support_user"
      }
    });

    expect(response.status).toBe(404);
  });

  it("surfaces retry failures from the receipt service", async () => {
    receiptService = new FakeReceiptService(undefined, sampleRecord, {
      ok: false,
      code: "RECEIPT_RETRY_DISPATCH_FAILED",
      reasonCode: "PROVIDER_UNAVAILABLE",
      statusCode: 503,
      providerStatusCode: 503
    });
    server.close();
    server = createServer(createApp({
      teviReceiptService: receiptService,
      adminAuditRepository: new InMemoryAdminAuditRepository()
    }));
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const response = await fetch(`${baseUrl}/api/admin/message-receipts/receipt_test_1/retry`, {
      method: "POST",
      headers: {
        "x-admin-role": "operator",
        "x-admin-actor": "operator_user",
        "x-request-id": "req_admin_retry_fail"
      }
    });

    expect(response.status).toBe(503);
  });
});
