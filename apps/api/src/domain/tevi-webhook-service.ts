import type { PlayerRecord } from "./player-identity.js";
import type {
  ProviderTopUpIdempotencyRecord,
  ProviderTopUpIdempotencyRepository
} from "./provider-top-up-idempotency-repository.js";
import type { TeviWebhookCashoutReconciliation } from "./tevi-webhook-cashout-reconciliation.js";

export const teviProviderName = "tevi";
export const teviTopupEvent = "user_topup";
export const teviWithdrawEvent = "user_withdraw";

// Deposit credits the wallet via user_topup (type deposit). Cashout debits on API commit; user_withdraw
// (type refund) reconciles provider payout without mutating the wallet again.

export type TeviWebhookProcessStatus = "credited" | "reconciled" | "replayed" | "ignored" | "failed" | "duplicate";

export interface TeviWebhookProcessResult {
  status: TeviWebhookProcessStatus;
  reasonCode: string;
  providerEventId: string | null;
}

export interface TeviWebhookServicePort {
  process(input: { payload: unknown; requestId: string }): Promise<TeviWebhookProcessResult>;
}

export interface TeviWebhookPlayerLookup {
  findPlayerByProviderSubject(provider: string, subject: string): Promise<PlayerRecord | null>;
}

export interface TeviWebhookCreditInput {
  providerEventId: string;
  playerId: string;
  amount: number;
  correlationId: string;
}

export interface TeviWebhookCreditResult {
  credited: boolean;
  alreadyCompleted: boolean;
  balanceAfter: number;
  transactionId: string | null;
}

export interface TeviWebhookCreditPort {
  creditTopupAtomically(input: TeviWebhookCreditInput): Promise<TeviWebhookCreditResult>;
}

export interface TeviWebhookServiceDeps {
  idempotencyRepository: ProviderTopUpIdempotencyRepository;
  creditPort: TeviWebhookCreditPort;
  playerLookup: TeviWebhookPlayerLookup;
  cashoutReconciliation?: TeviWebhookCashoutReconciliation;
}

interface ParsedTopup {
  kind: "topup";
  providerEventId: string;
  event: string;
  teviSubject: string;
  amount: number;
}

interface ParsedWithdraw {
  kind: "withdraw";
  providerEventId: string;
  event: string;
  teviSubject: string;
  amount: number;
}

interface ParsedIgnored {
  kind: "ignored";
  providerEventId: string | null;
  event: string;
  reasonCode: string;
}

interface ParsedInvalid {
  kind: "invalid";
  providerEventId: string | null;
  event: string;
  reasonCode: string;
}

type ParsedWebhook = ParsedTopup | ParsedWithdraw | ParsedIgnored | ParsedInvalid;

export class TeviWebhookService implements TeviWebhookServicePort {
  public constructor(private readonly deps: TeviWebhookServiceDeps) {}

  public async process(input: { payload: unknown; requestId: string }): Promise<TeviWebhookProcessResult> {
    const parsed = parseWebhook(input.payload);

    if (parsed.kind === "ignored") {
      return this.recordNonCrediting(parsed.providerEventId, parsed.event, "ignored", parsed.reasonCode, input.requestId);
    }
    if (parsed.kind === "invalid") {
      logWebhookShape(input.requestId, parsed.providerEventId, parsed.event, parsed.reasonCode, input.payload);
      return this.recordNonCrediting(parsed.providerEventId, parsed.event, "failed", parsed.reasonCode, input.requestId);
    }
    if (parsed.kind === "withdraw") {
      return this.processWithdraw(parsed, input.requestId);
    }

    return this.processTopup(parsed, input.requestId);
  }

  private async processTopup(parsed: ParsedTopup, requestId: string): Promise<TeviWebhookProcessResult> {
    const player = await this.deps.playerLookup.findPlayerByProviderSubject(teviProviderName, parsed.teviSubject);
    if (!player) {
      return this.recordNonCrediting(parsed.providerEventId, parsed.event, "failed", "unknown_user", requestId);
    }

    const normalizedIdempotencyKey = buildIdempotencyKey(parsed.event, parsed.providerEventId);
    const safeMetadata = {
      event: parsed.event,
      teviSubject: parsed.teviSubject,
      amount: parsed.amount,
      type: "deposit"
    };

    const reservation = await this.deps.idempotencyRepository.createOrGet({
      providerName: teviProviderName,
      providerEventId: parsed.providerEventId,
      normalizedIdempotencyKey,
      playerId: player.playerId,
      pointAmount: parsed.amount,
      providerMetadata: safeMetadata
    });

    if (!reservation.created) {
      const existing = reservation.record;
      if (reservation.duplicateReason === "idempotency_key" && existing.providerEventId !== parsed.providerEventId) {
        return this.quarantineConflict(parsed.providerEventId, parsed.event, "idempotency_key_conflict", existing, requestId);
      }

      const payloadMatches = existing.playerId === player.playerId && existing.pointAmount === parsed.amount;
      if (!payloadMatches) {
        return this.quarantineConflict(parsed.providerEventId, parsed.event, "conflicting_payload", existing, requestId);
      }

      if (existing.status === "failed" || existing.status === "ignored" || existing.status === "duplicate") {
        logWebhook("event already terminal", requestId, parsed.providerEventId, parsed.event, existing.status);
        return { status: existing.status, reasonCode: "already_terminal", providerEventId: parsed.providerEventId };
      }
    }

    const creditResult = await this.deps.creditPort.creditTopupAtomically({
      providerEventId: parsed.providerEventId,
      playerId: player.playerId,
      amount: parsed.amount,
      correlationId: requestId
    });

    if (creditResult.alreadyCompleted) {
      logWebhook("replay preserved (no double credit)", requestId, parsed.providerEventId, parsed.event, "replayed");
      return { status: "replayed", reasonCode: "already_completed", providerEventId: parsed.providerEventId };
    }

    if (!creditResult.credited) {
      logWebhook("credit skipped on non-pending record", requestId, parsed.providerEventId, parsed.event, "failed");
      return { status: "failed", reasonCode: "record_not_creditable", providerEventId: parsed.providerEventId };
    }

    logWebhook("wallet credited", requestId, parsed.providerEventId, parsed.event, "credited");
    return { status: "credited", reasonCode: "credited", providerEventId: parsed.providerEventId };
  }

  private async processWithdraw(parsed: ParsedWithdraw, requestId: string): Promise<TeviWebhookProcessResult> {
    if (!this.deps.cashoutReconciliation) {
      return this.recordNonCrediting(
        parsed.providerEventId,
        parsed.event,
        "ignored",
        `event_not_in_scope:${parsed.event}`,
        requestId
      );
    }

    const player = await this.deps.playerLookup.findPlayerByProviderSubject(teviProviderName, parsed.teviSubject);
    if (!player) {
      return this.recordNonCrediting(parsed.providerEventId, parsed.event, "failed", "unknown_user", requestId);
    }

    const result = await this.deps.cashoutReconciliation.reconcileUserWithdraw({
      providerEventId: parsed.providerEventId,
      playerId: player.playerId,
      teviSubject: parsed.teviSubject,
      amount: parsed.amount,
      correlationId: requestId
    });

    logWebhook(`cashout ${result.status}`, requestId, parsed.providerEventId, parsed.event, result.reasonCode);
    return {
      status: result.status,
      reasonCode: result.reasonCode,
      providerEventId: parsed.providerEventId
    };
  }

  private async recordNonCrediting(
    providerEventId: string | null,
    event: string,
    status: "ignored" | "failed",
    reasonCode: string,
    requestId: string
  ): Promise<TeviWebhookProcessResult> {
    logWebhook(`event ${status}`, requestId, providerEventId, event, reasonCode);

    if (!providerEventId) {
      return { status, reasonCode, providerEventId: null };
    }

    await this.deps.idempotencyRepository.createOrGet({
      providerName: teviProviderName,
      providerEventId,
      normalizedIdempotencyKey: buildIdempotencyKey(event, providerEventId),
      providerMetadata: { event, reasonCode }
    });

    if (status === "ignored") {
      await this.deps.idempotencyRepository.markIgnored({ providerName: teviProviderName, providerEventId, failureReason: reasonCode });
    } else {
      await this.deps.idempotencyRepository.markFailed({ providerName: teviProviderName, providerEventId, failureReason: reasonCode });
    }

    return { status, reasonCode, providerEventId };
  }

  private async quarantineConflict(
    providerEventId: string,
    event: string,
    reasonCode: string,
    existing: ProviderTopUpIdempotencyRecord,
    requestId: string
  ): Promise<TeviWebhookProcessResult> {
    if (existing.status === "completed") {
      logWebhook("conflicting delivery against a completed credit (preserved)", requestId, providerEventId, event, reasonCode);
      return { status: "duplicate", reasonCode, providerEventId };
    }

    logWebhook("conflicting delivery quarantined", requestId, providerEventId, event, reasonCode);
    await this.deps.idempotencyRepository.markDuplicate({
      providerName: teviProviderName,
      providerEventId,
      failureReason: reasonCode,
      duplicateOfId: existing.id
    });
    return { status: "duplicate", reasonCode, providerEventId };
  }
}

function buildIdempotencyKey(event: string, providerEventId: string): string {
  return `tevi:${event}:${providerEventId}`;
}

function parseWebhook(payload: unknown): ParsedWebhook {
  if (typeof payload !== "object" || payload === null) {
    return { kind: "invalid", providerEventId: null, event: "unknown", reasonCode: "payload_not_object" };
  }

  const body = payload as Record<string, unknown>;
  const event = typeof body.event === "string" ? body.event : "unknown";
  const providerEventId = typeof body.id === "string" && body.id.trim().length > 0 ? body.id.trim() : null;

  if (event !== teviTopupEvent && event !== teviWithdrawEvent) {
    return { kind: "ignored", providerEventId, event, reasonCode: `event_not_in_scope:${event}` };
  }

  if (!providerEventId) {
    return { kind: "invalid", providerEventId: null, event, reasonCode: "missing_event_id" };
  }

  const data = typeof body.data === "object" && body.data !== null ? (body.data as Record<string, unknown>) : null;
  if (!data) {
    return { kind: "invalid", providerEventId, event, reasonCode: "missing_data" };
  }

  const metadata = typeof data.metadata === "object" && data.metadata !== null ? (data.metadata as Record<string, unknown>) : null;
  if (event === teviTopupEvent) {
    if (!metadata) {
      return { kind: "invalid", providerEventId, event, reasonCode: "missing_metadata" };
    }
    if (metadata.type !== "deposit") {
      return {
        kind: "ignored",
        providerEventId,
        event,
        reasonCode: `metadata_type_not_deposit:${stringifyType(metadata.type)}`
      };
    }
  } else if (!metadata) {
    // Sandbox/test user_withdraw payloads may omit metadata; event name identifies cashout.
  } else if (metadata.type !== undefined && metadata.type !== "refund") {
    return {
      kind: "ignored",
      providerEventId,
      event,
      reasonCode: `metadata_type_not_refund:${stringifyType(metadata.type)}`
    };
  }

  const subjectCandidates = [data.user, data.user_id, metadata?.user_id]
    .map(coerceSubject)
    .filter((subject): subject is string => subject !== null);
  const distinctSubjects = [...new Set(subjectCandidates)];
  const teviSubject = distinctSubjects[0];
  if (teviSubject === undefined) {
    return { kind: "invalid", providerEventId, event, reasonCode: "missing_user" };
  }
  if (distinctSubjects.length > 1) {
    return { kind: "invalid", providerEventId, event, reasonCode: "user_mismatch" };
  }

  const amount = data.amount;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    return { kind: "invalid", providerEventId, event, reasonCode: "invalid_amount" };
  }

  if (event === teviTopupEvent) {
    return { kind: "topup", providerEventId, event, teviSubject, amount };
  }

  return { kind: "withdraw", providerEventId, event, teviSubject, amount };
}

function coerceSubject(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function stringifyType(value: unknown): string {
  return typeof value === "string" ? value : typeof value;
}

function logWebhook(message: string, requestId: string, providerEventId: string | null, event: string, reasonCode: string): void {
  console.info(`[tevi-webhook] ${message}`, {
    requestId,
    event,
    providerEventId,
    reasonCode
  });
}

function logWebhookShape(requestId: string, providerEventId: string | null, event: string, reasonCode: string, payload: unknown): void {
  console.info("[tevi-webhook] payload shape on parse failure", {
    requestId,
    event,
    providerEventId,
    reasonCode,
    shape: describePayloadShape(payload)
  });
}

function describePayloadShape(value: unknown, depth = 3): unknown {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    if (depth <= 0) {
      return "array";
    }
    return value.length === 0 ? [] : [describePayloadShape(value[0], depth - 1), ...(value.length > 1 ? ["…"] : [])];
  }
  if (typeof value === "object") {
    if (depth <= 0) {
      return "object";
    }
    const shape: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      shape[key] = describePayloadShape((value as Record<string, unknown>)[key], depth - 1);
    }
    return shape;
  }
  return typeof value;
}
