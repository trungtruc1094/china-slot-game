import { describe, expect, it, vi } from "vitest";
import {
  TeviReceiptService,
  formatCashoutReceiptMessage,
  formatTopupReceiptMessage
} from "../../src/domain/tevi-receipt-service.js";
import type {
  TeviMessageReceiptRecord,
  TeviMessageReceiptRepository
} from "../../src/domain/tevi-receipt-service.js";
import type { TeviMessageClientPort } from "../../src/domain/tevi-message-client.js";

class InMemoryReceiptRepository implements TeviMessageReceiptRepository {
  public records = new Map<string, TeviMessageReceiptRecord>();

  public async createOrGet(input: Parameters<TeviMessageReceiptRepository["createOrGet"]>[0]) {
    const existing = [...this.records.values()].find(
      (record) => record.messageType === input.messageType && record.sourceCorrelationKey === input.sourceCorrelationKey
    );
    if (existing) {
      return { record: existing, created: false };
    }
    const record: TeviMessageReceiptRecord = {
      receiptId: "receipt_test_1",
      messageType: input.messageType,
      recipientTeviSubject: input.recipientTeviSubject,
      playerId: input.playerId,
      sourceEventId: input.sourceEventId,
      sourceCorrelationKey: input.sourceCorrelationKey,
      amount: input.amount,
      cashoutStatus: input.cashoutStatus,
      status: "pending",
      dispatchAttemptCount: 0,
      failureReason: null,
      providerStatusCode: null,
      providerResponseSummary: {},
      messageBodyPreview: input.messageBodyPreview,
      requestId: input.requestId,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      sentAt: null
    };
    this.records.set(record.receiptId, record);
    return { record, created: true };
  }

  public async recordDispatchOutcome(receiptId: string, outcome: Parameters<TeviMessageReceiptRepository["recordDispatchOutcome"]>[1]) {
    const record = this.records.get(receiptId);
    if (!record) return;
    record.status = outcome.status;
    record.dispatchAttemptCount += 1;
    record.failureReason = outcome.failureReason;
    record.providerStatusCode = outcome.providerStatusCode;
    record.providerResponseSummary = outcome.providerResponseSummary;
    record.sentAt = outcome.sentAt;
    record.updatedAt = outcome.sentAt ?? record.updatedAt;
  }

  public async findById(receiptId: string) {
    return this.records.get(receiptId) ?? null;
  }

  public async findBySource(messageType: TeviMessageReceiptRecord["messageType"], sourceCorrelationKey: string) {
    return [...this.records.values()].find(
      (record) => record.messageType === messageType && record.sourceCorrelationKey === sourceCorrelationKey
    ) ?? null;
  }

  public async searchRecords() {
    return { records: [...this.records.values()], total: this.records.size };
  }
}

describe("TeviReceiptService", () => {
  it("formats top-up and cashout receipt messages with required fields", () => {
    expect(formatTopupReceiptMessage(250, "req_topup_1")).toContain("250");
    expect(formatTopupReceiptMessage(250, "req_topup_1")).toContain("req_topup_1");
    expect(formatCashoutReceiptMessage(100, "cashout_abc", "dispatched")).toContain("cashout_abc");
    expect(formatCashoutReceiptMessage(100, "cashout_abc", "dispatched")).toContain("dispatched");
  });

  it("records sent receipts without throwing to money-path callers", async () => {
    const repository = new InMemoryReceiptRepository();
    const messageClient: TeviMessageClientPort = {
      sendMessage: vi.fn(async () => ({ ok: true as const, providerMessageId: "msg_1" }))
    };
    const service = new TeviReceiptService(repository, messageClient);

    await expect(service.dispatchTopupReceipt({
      providerEventId: "evt_topup_1",
      playerId: "player_1",
      teviSubject: "1168097029",
      amount: 100,
      correlationId: "req_webhook_1",
      requestId: "req_webhook_1"
    })).resolves.toBe("sent");

    const record = [...repository.records.values()][0];
    expect(record?.status).toBe("sent");
    expect(record?.messageBodyPreview).toContain("100");
  });

  it("isolates message failures from wallet/cashout state", async () => {
    const repository = new InMemoryReceiptRepository();
    const messageClient: TeviMessageClientPort = {
      sendMessage: vi.fn(async () => ({
        ok: false as const,
        reasonCode: "PROVIDER_UNAVAILABLE",
        statusCode: 503,
        providerStatusCode: 503
      }))
    };
    const service = new TeviReceiptService(repository, messageClient);

    await expect(service.dispatchCashoutReceipt({
      cashoutRequestId: "cashout_1",
      playerId: "player_1",
      teviSubject: "1168097029",
      amount: 50,
      cashoutStatus: "dispatched",
      requestId: "req_cashout_1"
    })).resolves.toBe("failed_retryable");

    const record = [...repository.records.values()][0];
    expect(record?.status).toBe("failed_retryable");
    expect(record?.failureReason).toBe("PROVIDER_UNAVAILABLE");
  });

  it("rejects retry for terminal receipts", async () => {
    const repository = new InMemoryReceiptRepository();
    repository.records.set("receipt_sent", {
      receiptId: "receipt_sent",
      messageType: "topup_credit",
      recipientTeviSubject: "1168097029",
      playerId: "player_1",
      sourceEventId: "evt_1",
      sourceCorrelationKey: "topup:evt_1",
      amount: 100,
      cashoutStatus: null,
      status: "sent",
      dispatchAttemptCount: 1,
      failureReason: null,
      providerStatusCode: null,
      providerResponseSummary: {},
      messageBodyPreview: "sent",
      requestId: "req_1",
      createdAt: new Date(),
      updatedAt: new Date(),
      sentAt: new Date()
    });
    const service = new TeviReceiptService(repository, { sendMessage: vi.fn() });

    await expect(service.retryDispatch("receipt_sent", "req_retry")).resolves.toMatchObject({
      ok: false,
      code: "RECEIPT_RETRY_NOT_ALLOWED"
    });
  });
});
