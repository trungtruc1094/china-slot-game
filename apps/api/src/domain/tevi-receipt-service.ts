import { randomUUID } from "node:crypto";
import type { Clock } from "./session-service.js";
import type { TeviMessageClientPort } from "./tevi-message-client.js";
import { ApiHttpError } from "../middleware/error-handler.js";

export type TeviMessageReceiptType = "topup_credit" | "cashout_dispatch";
export type TeviMessageReceiptStatus = "pending" | "sent" | "failed_retryable" | "failed_terminal";

export interface TeviMessageReceiptRecord {
  receiptId: string;
  messageType: TeviMessageReceiptType;
  recipientTeviSubject: string;
  playerId: string | null;
  sourceEventId: string;
  sourceCorrelationKey: string;
  amount: number | null;
  cashoutStatus: string | null;
  status: TeviMessageReceiptStatus;
  dispatchAttemptCount: number;
  failureReason: string | null;
  providerStatusCode: number | null;
  providerResponseSummary: Record<string, unknown>;
  messageBodyPreview: string;
  requestId: string;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
}

export interface TeviMessageReceiptSearchFilters {
  playerId?: string;
  receiptId?: string;
  sourceEventId?: string;
  messageType?: TeviMessageReceiptType;
  status?: TeviMessageReceiptStatus;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export interface TeviMessageReceiptSearchResult {
  records: TeviMessageReceiptRecord[];
  total: number;
}

export interface TeviMessageReceiptCreateInput {
  messageType: TeviMessageReceiptType;
  recipientTeviSubject: string;
  playerId: string;
  sourceEventId: string;
  sourceCorrelationKey: string;
  amount: number;
  cashoutStatus: string | null;
  messageBodyPreview: string;
  requestId: string;
  createdAt: Date;
}

export interface TeviMessageReceiptRepository {
  createOrGet(input: TeviMessageReceiptCreateInput): Promise<{ record: TeviMessageReceiptRecord; created: boolean }>;
  recordDispatchOutcome(
    receiptId: string,
    outcome: {
      status: TeviMessageReceiptStatus;
      failureReason: string | null;
      providerStatusCode: number | null;
      providerResponseSummary: Record<string, unknown>;
      sentAt: Date | null;
    }
  ): Promise<void>;
  findById(receiptId: string): Promise<TeviMessageReceiptRecord | null>;
  findBySource(messageType: TeviMessageReceiptType, sourceCorrelationKey: string): Promise<TeviMessageReceiptRecord | null>;
  searchRecords(filters: TeviMessageReceiptSearchFilters): Promise<TeviMessageReceiptSearchResult>;
}

export interface TopupReceiptDispatchInput {
  providerEventId: string;
  playerId: string;
  teviSubject: string;
  amount: number;
  correlationId: string;
  requestId: string;
}

export interface CashoutReceiptDispatchInput {
  cashoutRequestId: string;
  playerId: string;
  teviSubject: string;
  amount: number;
  cashoutStatus: string;
  requestId: string;
}

export type TeviReceiptRetryResult =
  | {
      ok: true;
      receiptId: string;
      status: TeviMessageReceiptStatus;
      dispatchAttemptCount: number;
    }
  | {
      ok: false;
      code: "RECEIPT_NOT_FOUND" | "RECEIPT_RETRY_NOT_ALLOWED" | "RECEIPT_RETRY_DISPATCH_FAILED";
      reasonCode: string;
      statusCode: number;
      providerStatusCode?: number;
    };

const systemClock: Clock = { now: () => new Date() };

export function buildTopupReceiptCorrelationKey(providerEventId: string): string {
  return `topup:${providerEventId}`;
}

export function buildCashoutReceiptCorrelationKey(cashoutRequestId: string): string {
  return `cashout:${cashoutRequestId}`;
}

export function formatTopupReceiptMessage(amount: number, correlationId: string): string {
  return `Your Stars top-up of ${amount} was credited. Reference: ${correlationId}.`;
}

export function formatCashoutReceiptMessage(
  amount: number,
  cashoutRequestId: string,
  cashoutStatus: string
): string {
  return `Your cashout of ${amount} Stars was submitted to Tevi. Request ID: ${cashoutRequestId}. Status: ${cashoutStatus}.`;
}

export class TeviReceiptService {
  public constructor(
    private readonly repository: TeviMessageReceiptRepository,
    private readonly messageClient: TeviMessageClientPort,
    private readonly clock: Clock = systemClock
  ) {}

  public async dispatchTopupReceipt(input: TopupReceiptDispatchInput): Promise<TeviMessageReceiptStatus | null> {
    try {
      return await this.dispatchReceipt({
        messageType: "topup_credit",
        recipientTeviSubject: input.teviSubject,
        playerId: input.playerId,
        sourceEventId: input.providerEventId,
        sourceCorrelationKey: buildTopupReceiptCorrelationKey(input.providerEventId),
        amount: input.amount,
        cashoutStatus: null,
        messageText: formatTopupReceiptMessage(input.amount, input.correlationId),
        requestId: input.requestId
      });
    } catch (error) {
      console.warn("[tevi-receipt] top-up receipt dispatch failed without rolling back credit", {
        requestId: input.requestId,
        providerEventId: input.providerEventId,
        reasonCode: error instanceof Error ? error.message : "UNKNOWN"
      });
      return null;
    }
  }

  public async dispatchCashoutReceipt(input: CashoutReceiptDispatchInput): Promise<TeviMessageReceiptStatus | null> {
    try {
      return await this.dispatchReceipt({
        messageType: "cashout_dispatch",
        recipientTeviSubject: input.teviSubject,
        playerId: input.playerId,
        sourceEventId: input.cashoutRequestId,
        sourceCorrelationKey: buildCashoutReceiptCorrelationKey(input.cashoutRequestId),
        amount: input.amount,
        cashoutStatus: input.cashoutStatus,
        messageText: formatCashoutReceiptMessage(input.amount, input.cashoutRequestId, input.cashoutStatus),
        requestId: input.requestId
      });
    } catch (error) {
      console.warn("[tevi-receipt] cashout receipt dispatch failed without rolling back cashout", {
        requestId: input.requestId,
        cashoutRequestId: input.cashoutRequestId,
        reasonCode: error instanceof Error ? error.message : "UNKNOWN"
      });
      return null;
    }
  }

  public async searchRecords(filters: TeviMessageReceiptSearchFilters): Promise<TeviMessageReceiptSearchResult> {
    return this.repository.searchRecords(filters);
  }

  public async getRecord(receiptId: string): Promise<TeviMessageReceiptRecord | null> {
    return this.repository.findById(receiptId);
  }

  public async retryDispatch(receiptId: string, actorRequestId: string): Promise<TeviReceiptRetryResult> {
    const record = await this.repository.findById(receiptId);
    if (!record) {
      return {
        ok: false,
        code: "RECEIPT_NOT_FOUND",
        reasonCode: "MESSAGE_RECEIPT_NOT_FOUND",
        statusCode: 404
      };
    }

    if (record.status === "sent" || record.status === "failed_terminal") {
      return {
        ok: false,
        code: "RECEIPT_RETRY_NOT_ALLOWED",
        reasonCode: "MESSAGE_RECEIPT_RETRY_NOT_ALLOWED",
        statusCode: 409
      };
    }

    const messageText = record.messageBodyPreview;
    const dispatchResult = await this.messageClient.sendMessage({
      teviSubject: record.recipientTeviSubject,
      text: messageText,
      requestId: actorRequestId
    });

    const now = this.clock.now();
    if (dispatchResult.ok) {
      await this.repository.recordDispatchOutcome(record.receiptId, {
        status: "sent",
        failureReason: null,
        providerStatusCode: null,
        providerResponseSummary: {
          providerMessageId: dispatchResult.providerMessageId,
          retry: true
        },
        sentAt: now
      });
      console.info("[tevi-receipt] message receipt retry sent", {
        requestId: actorRequestId,
        receiptId: record.receiptId,
        messageType: record.messageType
      });
      return {
        ok: true,
        receiptId: record.receiptId,
        status: "sent",
        dispatchAttemptCount: record.dispatchAttemptCount + 1
      };
    }

    await this.repository.recordDispatchOutcome(record.receiptId, {
      status: "failed_retryable",
      failureReason: dispatchResult.reasonCode,
      providerStatusCode: dispatchResult.providerStatusCode ?? null,
      providerResponseSummary: {
        providerStatusCode: dispatchResult.providerStatusCode ?? null,
        failureReason: dispatchResult.reasonCode,
        retry: true
      },
      sentAt: null
    });

    if (dispatchResult.reasonCode === "PROVIDER_REJECTED") {
      const conflictFailure: Extract<TeviReceiptRetryResult, { ok: false }> = {
        ok: false,
        code: "RECEIPT_RETRY_NOT_ALLOWED",
        reasonCode: dispatchResult.reasonCode,
        statusCode: 409
      };
      if (dispatchResult.providerStatusCode !== undefined) {
        conflictFailure.providerStatusCode = dispatchResult.providerStatusCode;
      }
      return conflictFailure;
    }

    const failure: Extract<TeviReceiptRetryResult, { ok: false }> = {
      ok: false,
      code: "RECEIPT_RETRY_DISPATCH_FAILED",
      reasonCode: dispatchResult.reasonCode,
      statusCode: dispatchResult.statusCode
    };
    if (dispatchResult.providerStatusCode !== undefined) {
      failure.providerStatusCode = dispatchResult.providerStatusCode;
    }
    return failure;
  }

  private async dispatchReceipt(input: {
    messageType: TeviMessageReceiptType;
    recipientTeviSubject: string;
    playerId: string;
    sourceEventId: string;
    sourceCorrelationKey: string;
    amount: number;
    cashoutStatus: string | null;
    messageText: string;
    requestId: string;
  }): Promise<TeviMessageReceiptStatus> {
    const now = this.clock.now();
    const reservation = await this.repository.createOrGet({
      messageType: input.messageType,
      recipientTeviSubject: input.recipientTeviSubject,
      playerId: input.playerId,
      sourceEventId: input.sourceEventId,
      sourceCorrelationKey: input.sourceCorrelationKey,
      amount: input.amount,
      cashoutStatus: input.cashoutStatus,
      messageBodyPreview: input.messageText,
      requestId: input.requestId,
      createdAt: now
    });

    if (!reservation.created && reservation.record.status === "sent") {
      console.info("[tevi-receipt] message receipt already sent", {
        requestId: input.requestId,
        receiptId: reservation.record.receiptId,
        messageType: input.messageType
      });
      return reservation.record.status;
    }

    const dispatchResult = await this.messageClient.sendMessage({
      teviSubject: input.recipientTeviSubject,
      text: input.messageText,
      requestId: input.requestId
    });

    if (dispatchResult.ok) {
      await this.repository.recordDispatchOutcome(reservation.record.receiptId, {
        status: "sent",
        failureReason: null,
        providerStatusCode: null,
        providerResponseSummary: {
          providerMessageId: dispatchResult.providerMessageId
        },
        sentAt: now
      });
      console.info("[tevi-receipt] message receipt sent", {
        requestId: input.requestId,
        receiptId: reservation.record.receiptId,
        messageType: input.messageType,
        sourceEventId: input.sourceEventId
      });
      return "sent";
    }

    const terminal = dispatchResult.reasonCode === "PROVIDER_REJECTED";
    const status: TeviMessageReceiptStatus = terminal ? "failed_terminal" : "failed_retryable";
    await this.repository.recordDispatchOutcome(reservation.record.receiptId, {
      status,
      failureReason: dispatchResult.reasonCode,
      providerStatusCode: dispatchResult.providerStatusCode ?? null,
      providerResponseSummary: {
        providerStatusCode: dispatchResult.providerStatusCode ?? null,
        failureReason: dispatchResult.reasonCode
      },
      sentAt: null
    });
    console.warn("[tevi-receipt] message receipt dispatch failed (money path preserved)", {
      requestId: input.requestId,
      receiptId: reservation.record.receiptId,
      messageType: input.messageType,
      reasonCode: dispatchResult.reasonCode
    });
    return status;
  }
}

export interface TeviReceiptServicePort {
  dispatchTopupReceipt(input: TopupReceiptDispatchInput): Promise<TeviMessageReceiptStatus | null>;
  dispatchCashoutReceipt(input: CashoutReceiptDispatchInput): Promise<TeviMessageReceiptStatus | null>;
  searchRecords(filters: TeviMessageReceiptSearchFilters): Promise<TeviMessageReceiptSearchResult>;
  getRecord(receiptId: string): Promise<TeviMessageReceiptRecord | null>;
  retryDispatch(receiptId: string, actorRequestId: string): Promise<TeviReceiptRetryResult>;
}

export function assertReceiptRetryAllowed(status: TeviMessageReceiptStatus): void {
  if (status === "sent" || status === "failed_terminal") {
    throw new ApiHttpError(409, {
      code: "RECEIPT_RETRY_NOT_ALLOWED",
      message: "This message receipt cannot be retried.",
      details: { status }
    });
  }
}

export function newReceiptId(): string {
  return `receipt_${randomUUID()}`;
}
