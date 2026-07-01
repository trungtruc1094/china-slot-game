import type { ProviderTopUpIdempotencyRepository } from "./provider-top-up-idempotency-repository.js";
import { teviProviderName } from "./tevi-webhook-service.js";

export interface CashoutWithdrawReconciliationInput {
  playerId: string;
  teviSubject: string;
  amount: number;
  providerEventId: string;
  correlationId: string;
}

export type CashoutWithdrawReconciliationStatus = "reconciled" | "replayed" | "ignored" | "failed" | "duplicate";

export interface CashoutWithdrawReconciliationResult {
  status: CashoutWithdrawReconciliationStatus;
  reasonCode: string;
  cashoutRequestId: string | null;
}

export interface CashoutWithdrawReconciliationPort {
  reconcileUserWithdraw(input: CashoutWithdrawReconciliationInput): Promise<{
    status: "reconciled" | "already_dispatched" | "no_match";
    cashoutRequestId: string | null;
  }>;
}

export class TeviWebhookCashoutReconciliation {
  public constructor(
    private readonly idempotencyRepository: ProviderTopUpIdempotencyRepository,
    private readonly cashoutRepository: CashoutWithdrawReconciliationPort
  ) {}

  public async reconcileUserWithdraw(
    input: CashoutWithdrawReconciliationInput
  ): Promise<CashoutWithdrawReconciliationResult> {
    const normalizedIdempotencyKey = buildWithdrawIdempotencyKey(input.providerEventId);
    const safeMetadata = {
      event: "user_withdraw",
      teviSubject: input.teviSubject,
      amount: input.amount,
      type: "refund"
    };

    const reservation = await this.idempotencyRepository.createOrGet({
      providerName: teviProviderName,
      providerEventId: input.providerEventId,
      normalizedIdempotencyKey,
      playerId: input.playerId,
      pointAmount: input.amount,
      providerMetadata: safeMetadata
    });

    if (!reservation.created) {
      const existing = reservation.record;
      if (reservation.duplicateReason === "idempotency_key" && existing.providerEventId !== input.providerEventId) {
        await this.idempotencyRepository.markDuplicate({
          providerName: teviProviderName,
          providerEventId: input.providerEventId,
          failureReason: "idempotency_key_conflict",
          duplicateOfId: existing.id
        });
        return { status: "duplicate", reasonCode: "idempotency_key_conflict", cashoutRequestId: null };
      }

      const payloadMatches = existing.playerId === input.playerId && existing.pointAmount === input.amount;
      if (!payloadMatches) {
        if (existing.status === "completed") {
          return { status: "duplicate", reasonCode: "conflicting_payload", cashoutRequestId: null };
        }
        await this.idempotencyRepository.markDuplicate({
          providerName: teviProviderName,
          providerEventId: input.providerEventId,
          failureReason: "conflicting_payload",
          duplicateOfId: existing.id
        });
        return { status: "duplicate", reasonCode: "conflicting_payload", cashoutRequestId: null };
      }

      if (existing.status === "completed") {
        return { status: "replayed", reasonCode: "already_completed", cashoutRequestId: null };
      }
      if (existing.status === "failed" || existing.status === "ignored" || existing.status === "duplicate") {
        return { status: existing.status, reasonCode: "already_terminal", cashoutRequestId: null };
      }
    }

    const outcome = await this.cashoutRepository.reconcileUserWithdraw(input);

    if (outcome.status === "reconciled") {
      await this.idempotencyRepository.markCompleted({
        providerName: teviProviderName,
        providerEventId: input.providerEventId,
        providerMetadata: {
          ...safeMetadata,
          cashoutRequestId: outcome.cashoutRequestId,
          correlationId: input.correlationId
        }
      });
      return {
        status: "reconciled",
        reasonCode: "cashout_reconciled",
        cashoutRequestId: outcome.cashoutRequestId
      };
    }

    if (outcome.status === "already_dispatched") {
      await this.idempotencyRepository.markCompleted({
        providerName: teviProviderName,
        providerEventId: input.providerEventId,
        providerMetadata: {
          ...safeMetadata,
          cashoutRequestId: outcome.cashoutRequestId,
          correlationId: input.correlationId
        }
      });
      return {
        status: "replayed",
        reasonCode: "cashout_already_dispatched",
        cashoutRequestId: outcome.cashoutRequestId
      };
    }

    await this.idempotencyRepository.markIgnored({
      providerName: teviProviderName,
      providerEventId: input.providerEventId,
      failureReason: "no_matching_cashout"
    });
    return { status: "ignored", reasonCode: "no_matching_cashout", cashoutRequestId: null };
  }
}

function buildWithdrawIdempotencyKey(providerEventId: string): string {
  return `tevi:user_withdraw:${providerEventId}`;
}
