import { describe, expect, it, vi } from "vitest";
import {
  TeviReceiptService,
  assertReceiptRetryAllowed,
  buildCashoutReceiptCorrelationKey,
  buildTopupReceiptCorrelationKey,
  formatCashoutReceiptMessage,
  formatTopupReceiptMessage
} from "../../src/domain/tevi-receipt-service.js";
import type {
  TeviMessageReceiptRecord,
  TeviMessageReceiptRepository
} from "../../src/domain/tevi-receipt-service.js";
import type { TeviMessageClientPort } from "../../src/domain/tevi-message-client.js";
import { ApiHttpError } from "../../src/middleware/error-handler.js";

class InMemoryReceiptRepository implements TeviMessageReceiptRepository {
  public records = new Map<string, TeviMessageReceiptRecord>();
  public throwOnCreate = false;

  public async createOrGet(input: Parameters<TeviMessageReceiptRepository["createOrGet"]>[0]) {
    if (this.throwOnCreate) {
      throw new Error("repository unavailable");
    }
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

  public async searchRecords(filters: Parameters<TeviMessageReceiptRepository["searchRecords"]>[0]) {
    const records = [...this.records.values()].filter((record) => {
      if (filters.receiptId && record.receiptId !== filters.receiptId) return false;
      if (filters.playerId && record.playerId !== filters.playerId) return false;
      return true;
    });
    return { records, total: records.length };
  }
}

const dispatchInput = {
  providerEventId: "evt_topup_1",
  playerId: "player_1",
  teviSubject: "1168097029",
  amount: 100,
  correlationId: "req_webhook_1",
  requestId: "req_webhook_1"
};

describe("TeviReceiptService", () => {
  it("formats top-up and cashout receipt messages with required fields", () => {
    expect(formatTopupReceiptMessage(250, "req_topup_1")).toContain("250");
    expect(formatTopupReceiptMessage(250, "req_topup_1")).toContain("req_topup_1");
    expect(formatCashoutReceiptMessage(100, "cashout_abc", "dispatched")).toContain("cashout_abc");
    expect(formatCashoutReceiptMessage(100, "cashout_abc", "dispatched")).toContain("dispatched");
    expect(buildTopupReceiptCorrelationKey("evt_1")).toBe("topup:evt_1");
    expect(buildCashoutReceiptCorrelationKey("cashout_1")).toBe("cashout:cashout_1");
  });

  it("records sent receipts without throwing to money-path callers", async () => {
    const repository = new InMemoryReceiptRepository();
    const messageClient: TeviMessageClientPort = {
      sendMessage: vi.fn(async () => ({ ok: true as const, providerMessageId: "msg_1" }))
    };
    const service = new TeviReceiptService(repository, messageClient);

    await expect(service.dispatchTopupReceipt(dispatchInput)).resolves.toBe("sent");

    const record = [...repository.records.values()][0];
    expect(record?.status).toBe("sent");
    expect(record?.messageBodyPreview).toContain("100");
  });

  it("returns existing sent receipt without re-dispatching", async () => {
    const repository = new InMemoryReceiptRepository();
    repository.records.set("receipt_test_1", {
      receiptId: "receipt_test_1",
      messageType: "topup_credit",
      recipientTeviSubject: "1168097029",
      playerId: "player_1",
      sourceEventId: "evt_topup_1",
      sourceCorrelationKey: "topup:evt_topup_1",
      amount: 100,
      cashoutStatus: null,
      status: "sent",
      dispatchAttemptCount: 1,
      failureReason: null,
      providerStatusCode: null,
      providerResponseSummary: {},
      messageBodyPreview: "already sent",
      requestId: "req_webhook_1",
      createdAt: new Date(),
      updatedAt: new Date(),
      sentAt: new Date()
    });
    const sendMessage = vi.fn();
    const service = new TeviReceiptService(repository, { sendMessage });

    await expect(service.dispatchTopupReceipt(dispatchInput)).resolves.toBe("sent");
    expect(sendMessage).not.toHaveBeenCalled();
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

  it("marks provider auth failures as terminal", async () => {
    const repository = new InMemoryReceiptRepository();
    const service = new TeviReceiptService(repository, {
      sendMessage: vi.fn(async () => ({
        ok: false as const,
        reasonCode: "PROVIDER_REJECTED",
        statusCode: 401,
        providerStatusCode: 401
      }))
    });

    await expect(service.dispatchTopupReceipt(dispatchInput)).resolves.toBe("failed_terminal");
  });

  it("swallows repository errors from top-up and cashout dispatch wrappers", async () => {
    const repository = new InMemoryReceiptRepository();
    repository.throwOnCreate = true;
    const service = new TeviReceiptService(repository, { sendMessage: vi.fn() });

    await expect(service.dispatchTopupReceipt(dispatchInput)).resolves.toBeNull();
    await expect(service.dispatchCashoutReceipt({
      cashoutRequestId: "cashout_1",
      playerId: "player_1",
      teviSubject: "1168097029",
      amount: 50,
      cashoutStatus: "dispatched",
      requestId: "req_cashout_1"
    })).resolves.toBeNull();
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

  it("returns not found when retrying a missing receipt", async () => {
    const service = new TeviReceiptService(new InMemoryReceiptRepository(), { sendMessage: vi.fn() });

    await expect(service.retryDispatch("receipt_missing", "req_retry")).resolves.toMatchObject({
      ok: false,
      code: "RECEIPT_NOT_FOUND"
    });
  });

  it("retries failed receipts successfully", async () => {
    const repository = new InMemoryReceiptRepository();
    repository.records.set("receipt_retry", {
      receiptId: "receipt_retry",
      messageType: "cashout_dispatch",
      recipientTeviSubject: "1168097029",
      playerId: "player_1",
      sourceEventId: "cashout_1",
      sourceCorrelationKey: "cashout:cashout_1",
      amount: 50,
      cashoutStatus: "dispatched",
      status: "failed_retryable",
      dispatchAttemptCount: 1,
      failureReason: "PROVIDER_UNAVAILABLE",
      providerStatusCode: 503,
      providerResponseSummary: {},
      messageBodyPreview: "retry me",
      requestId: "req_1",
      createdAt: new Date(),
      updatedAt: new Date(),
      sentAt: null
    });
    const service = new TeviReceiptService(repository, {
      sendMessage: vi.fn(async () => ({ ok: true as const, providerMessageId: "msg_retry" }))
    });

    await expect(service.retryDispatch("receipt_retry", "req_retry")).resolves.toMatchObject({
      ok: true,
      status: "sent",
      dispatchAttemptCount: 3
    });
  });

  it("maps retry provider rejection to not-allowed and other failures to dispatch failed", async () => {
    const repository = new InMemoryReceiptRepository();
    const baseRecord: TeviMessageReceiptRecord = {
      receiptId: "receipt_retry",
      messageType: "cashout_dispatch",
      recipientTeviSubject: "1168097029",
      playerId: "player_1",
      sourceEventId: "cashout_1",
      sourceCorrelationKey: "cashout:cashout_1",
      amount: 50,
      cashoutStatus: "dispatched",
      status: "failed_retryable",
      dispatchAttemptCount: 1,
      failureReason: "PROVIDER_UNAVAILABLE",
      providerStatusCode: 503,
      providerResponseSummary: {},
      messageBodyPreview: "retry me",
      requestId: "req_1",
      createdAt: new Date(),
      updatedAt: new Date(),
      sentAt: null
    };
    repository.records.set("receipt_retry", baseRecord);

    const rejectedService = new TeviReceiptService(repository, {
      sendMessage: vi.fn(async () => ({
        ok: false as const,
        reasonCode: "PROVIDER_REJECTED",
        statusCode: 401,
        providerStatusCode: 401
      }))
    });
    await expect(rejectedService.retryDispatch("receipt_retry", "req_retry")).resolves.toMatchObject({
      ok: false,
      code: "RECEIPT_RETRY_NOT_ALLOWED",
      providerStatusCode: 401
    });

    baseRecord.status = "failed_retryable";
    const failedService = new TeviReceiptService(repository, {
      sendMessage: vi.fn(async () => ({
        ok: false as const,
        reasonCode: "PROVIDER_UNAVAILABLE",
        statusCode: 503
      }))
    });
    await expect(failedService.retryDispatch("receipt_retry", "req_retry_2")).resolves.toMatchObject({
      ok: false,
      code: "RECEIPT_RETRY_DISPATCH_FAILED"
    });
  });

  it("delegates search and getRecord to the repository", async () => {
    const repository = new InMemoryReceiptRepository();
    const service = new TeviReceiptService(repository, {
      sendMessage: vi.fn(async () => ({ ok: true as const, providerMessageId: "msg_search" }))
    });
    await service.dispatchTopupReceipt({
      ...dispatchInput,
      providerEventId: "evt_search"
    });

    await expect(service.getRecord("receipt_test_1")).resolves.toMatchObject({ receiptId: "receipt_test_1" });
    await expect(service.searchRecords({ playerId: "player_1", limit: 10, offset: 0 })).resolves.toMatchObject({ total: 1 });
  });

  it("assertReceiptRetryAllowed throws for terminal statuses", () => {
    expect(() => assertReceiptRetryAllowed("sent")).toThrow(ApiHttpError);
    expect(() => assertReceiptRetryAllowed("failed_terminal")).toThrow(ApiHttpError);
    expect(() => assertReceiptRetryAllowed("failed_retryable")).not.toThrow();
  });
});
