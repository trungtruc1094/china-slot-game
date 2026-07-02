import { createHash } from "node:crypto";
import type {
  CashoutRequestDetailRecord,
  CashoutRequestSearchFilters,
  CashoutRequestSearchResult
} from "./cashout-reconciliation-service.js";
import type { Clock } from "./session-service.js";
import type { TeviAuthContext } from "./tevi-auth-adapter.js";
import type { TeviMessageReceiptStatus } from "./tevi-receipt-service.js";
import type { TeviReceiptServicePort } from "./tevi-receipt-service.js";
import { ApiHttpError } from "../middleware/error-handler.js";

export type CashoutRequestStatus =
  | "pending"
  | "dispatched"
  | "failed_retryable"
  | "failed_terminal"
  | "idempotency_conflict";

export interface CashoutDispatchRequest {
  teviSubject: string;
  amount: number;
  idempotencyKey: string;
  requestId: string;
  description: string;
}

export type CashoutDispatchResult = CashoutDispatchSuccess | CashoutDispatchFailure;

export interface CashoutDispatchSuccess {
  ok: true;
}

export interface CashoutDispatchFailure {
  ok: false;
  reasonCode: string;
  statusCode: number;
  providerStatusCode?: number;
  idempotencyConflict?: boolean;
}

export interface CashoutDispatchClientPort {
  dispatchCashout(request: CashoutDispatchRequest): Promise<CashoutDispatchResult>;
}

export interface CashoutCommitInput {
  playerId: string;
  teviSubject: string;
  amount: number;
  requestId: string;
  payloadFingerprint: string;
  createdAt: Date;
}

export interface CashoutCommitResult {
  cashoutRequestId: string;
  walletTransactionId: string;
  balanceAfter: number;
  status: CashoutRequestStatus;
  idempotencyKey: string;
  payloadFingerprint: string;
  alreadyExists: boolean;
}

export interface CashoutRequestRepository {
  findByRequestId(requestId: string): Promise<CashoutCommitResult | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<CashoutCommitResult | null>;
  commitCashoutDebit(input: CashoutCommitInput): Promise<CashoutCommitResult>;
  recordDispatchOutcome(
    cashoutRequestId: string,
    outcome: {
      status: CashoutRequestStatus;
      failureReason: string | null;
      providerStatusCode: number | null;
      providerMetadata: Record<string, unknown>;
      dispatchedAt: Date | null;
    }
  ): Promise<void>;
  reconcileUserWithdraw(input: {
    playerId: string;
    teviSubject: string;
    amount: number;
    providerEventId: string;
    correlationId: string;
  }): Promise<{
    status: "reconciled" | "already_dispatched" | "no_match";
    cashoutRequestId: string | null;
  }>;
  findDetailById(cashoutRequestId: string): Promise<CashoutRequestDetailRecord | null>;
  searchCashoutRequests(filters: CashoutRequestSearchFilters): Promise<CashoutRequestSearchResult>;
}

export type {
  CashoutReconciliationState,
  CashoutRequestDetailRecord,
  CashoutRequestSearchFilters,
  CashoutRequestSearchResult
} from "./cashout-reconciliation-service.js";

export type CashoutRequestResult = CashoutRequestSuccess | CashoutRequestFailure;

export interface CashoutRequestSuccess {
  ok: true;
  cashoutRequestId: string;
  status: CashoutRequestStatus;
  amount: number;
  balanceAfter: number;
  idempotencyKey: string;
  walletTransactionId: string;
  receiptStatus?: TeviMessageReceiptStatus | null;
}

export interface CashoutRequestFailure {
  ok: false;
  code:
    | "INVALID_CASHOUT_AMOUNT"
    | "INSUFFICIENT_BALANCE"
    | "TEVI_AUTH_REQUIRED"
    | "TEVI_PAYMENT_CONFIG_MISSING"
    | "TEVI_CASHOUT_DUPLICATE_REQUEST"
    | "TEVI_CASHOUT_IDEMPOTENCY_CONFLICT"
    | "TEVI_CASHOUT_DISPATCH_FAILED";
  reasonCode: string;
  statusCode: number;
  providerStatusCode?: number;
}

export interface CashoutRequestServiceInput {
  playerId: string;
  teviAuth: TeviAuthContext;
  amount: number;
  requestId: string;
}

const systemClock: Clock = { now: () => new Date() };

export class CashoutRequestService {
  public constructor(
    private readonly repository: CashoutRequestRepository,
    private readonly dispatchClient: CashoutDispatchClientPort,
    private readonly receiptService?: TeviReceiptServicePort,
    private readonly clock: Clock = systemClock
  ) {}

  public async requestCashout(input: CashoutRequestServiceInput): Promise<CashoutRequestResult> {
    if (!input.playerId.trim() || input.teviAuth.provider !== "tevi" || !input.teviAuth.subject.trim()) {
      return {
        ok: false,
        code: "TEVI_AUTH_REQUIRED",
        reasonCode: "AUTH_CONTEXT_INVALID",
        statusCode: 401
      };
    }

    const amountFailure = validateAmount(input.amount);
    if (amountFailure) {
      return amountFailure;
    }

    const existingByRequest = await this.repository.findByRequestId(input.requestId);
    if (existingByRequest && existingByRequest.status !== "pending") {
      const replayConflict = await this.checkIdempotencyConflict(existingByRequest, input.amount, input.teviAuth.subject);
      if (replayConflict) {
        return replayConflict;
      }
      return this.toSuccess(existingByRequest, input.amount);
    }

    const payloadFingerprint = fingerprintCashoutPayload(input.teviAuth.subject, input.amount);
    const now = this.clock.now();

    let committed: CashoutCommitResult;
    if (existingByRequest?.status === "pending") {
      committed = { ...existingByRequest, alreadyExists: true };
    } else {
      try {
        committed = await this.repository.commitCashoutDebit({
          playerId: input.playerId,
          teviSubject: input.teviAuth.subject,
          amount: input.amount,
          requestId: input.requestId,
          payloadFingerprint,
          createdAt: now
        });
      } catch (error) {
        if (isInsufficientBalanceError(error)) {
          return {
            ok: false,
            code: "INSUFFICIENT_BALANCE",
            reasonCode: "WITHDRAWABLE_BALANCE_EXCEEDED",
            statusCode: 409
          };
        }
        throw error;
      }
    }

    if (committed.alreadyExists && committed.status !== "pending") {
      const conflict = await this.checkIdempotencyConflict(committed, input.amount, input.teviAuth.subject);
      if (conflict) {
        return conflict;
      }
      if (committed.status === "dispatched" || committed.status === "failed_retryable") {
        return this.toSuccess(committed, input.amount);
      }
    }

    const dispatchResult = await this.dispatchClient.dispatchCashout({
      teviSubject: input.teviAuth.subject,
      amount: input.amount,
      idempotencyKey: committed.idempotencyKey,
      requestId: input.requestId,
      description: `China Slot cashout ${committed.cashoutRequestId}`
    });

    const finalStatus: CashoutRequestStatus = dispatchResult.ok
      ? "dispatched"
      : (!dispatchResult.ok && dispatchResult.idempotencyConflict)
        ? "idempotency_conflict"
        : "failed_retryable";

    await this.repository.recordDispatchOutcome(committed.cashoutRequestId, {
      status: finalStatus,
      failureReason: dispatchResult.ok ? null : dispatchResult.reasonCode,
      providerStatusCode: dispatchResult.ok ? null : dispatchResult.providerStatusCode ?? null,
      providerMetadata: {},
      dispatchedAt: dispatchResult.ok ? this.clock.now() : null
    });

    if (!dispatchResult.ok && dispatchResult.idempotencyConflict) {
      const conflictFailure: CashoutRequestFailure = {
        ok: false,
        code: "TEVI_CASHOUT_IDEMPOTENCY_CONFLICT",
        reasonCode: "IDEMPOTENCY_PAYLOAD_MISMATCH",
        statusCode: 409
      };
      if (dispatchResult.providerStatusCode !== undefined) {
        conflictFailure.providerStatusCode = dispatchResult.providerStatusCode;
      }
      return conflictFailure;
    }

    if (!dispatchResult.ok) {
      return {
        ok: true,
        cashoutRequestId: committed.cashoutRequestId,
        status: "failed_retryable",
        amount: input.amount,
        balanceAfter: committed.balanceAfter,
        idempotencyKey: committed.idempotencyKey,
        walletTransactionId: committed.walletTransactionId
      };
    }

    const receiptStatus = await this.maybeDispatchCashoutReceipt({
      cashoutRequestId: committed.cashoutRequestId,
      playerId: input.playerId,
      teviSubject: input.teviAuth.subject,
      amount: input.amount,
      cashoutStatus: "dispatched",
      requestId: input.requestId
    });

    return {
      ok: true,
      cashoutRequestId: committed.cashoutRequestId,
      status: "dispatched",
      amount: input.amount,
      balanceAfter: committed.balanceAfter,
      idempotencyKey: committed.idempotencyKey,
      walletTransactionId: committed.walletTransactionId,
      receiptStatus
    };
  }

  private async maybeDispatchCashoutReceipt(input: {
    cashoutRequestId: string;
    playerId: string;
    teviSubject: string;
    amount: number;
    cashoutStatus: string;
    requestId: string;
  }): Promise<TeviMessageReceiptStatus | null> {
    if (!this.receiptService) {
      return null;
    }
    return this.receiptService.dispatchCashoutReceipt(input);
  }

  private async checkIdempotencyConflict(
    existing: CashoutCommitResult,
    amount: number,
    teviSubject: string
  ): Promise<CashoutRequestFailure | null> {
    const expectedFingerprint = fingerprintCashoutPayload(teviSubject, amount);
    if (existing.payloadFingerprint !== expectedFingerprint) {
      return {
        ok: false,
        code: "TEVI_CASHOUT_IDEMPOTENCY_CONFLICT",
        reasonCode: "IDEMPOTENCY_PAYLOAD_MISMATCH",
        statusCode: 409
      };
    }
    const row = await this.repository.findByIdempotencyKey(existing.idempotencyKey);
    if (row && row.status === "idempotency_conflict") {
      return {
        ok: false,
        code: "TEVI_CASHOUT_IDEMPOTENCY_CONFLICT",
        reasonCode: "IDEMPOTENCY_PAYLOAD_MISMATCH",
        statusCode: 409
      };
    }
    return null;
  }

  private toSuccess(committed: CashoutCommitResult, amount: number): CashoutRequestSuccess {
    return {
      ok: true,
      cashoutRequestId: committed.cashoutRequestId,
      status: committed.status === "pending" ? "failed_retryable" : committed.status,
      amount,
      balanceAfter: committed.balanceAfter,
      idempotencyKey: committed.idempotencyKey,
      walletTransactionId: committed.walletTransactionId
    };
  }
}

function validateAmount(amount: number): CashoutRequestFailure | undefined {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, code: "INVALID_CASHOUT_AMOUNT", reasonCode: "AMOUNT_NOT_POSITIVE_INTEGER", statusCode: 400 };
  }
  return undefined;
}

export function deriveCashoutIdempotencyKey(cashoutRequestId: string): string {
  const hash = createHash("sha256").update(`cashout-idempotency:${cashoutRequestId}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function fingerprintCashoutPayload(teviSubject: string, amount: number): string {
  return createHash("sha256").update(`${teviSubject}:${amount}`).digest("hex");
}

function isInsufficientBalanceError(error: unknown): boolean {
  return error instanceof ApiHttpError && error.apiError.code === "INSUFFICIENT_BALANCE";
}
