import type { PlayerRecord } from "./player-identity.js";
import type {
  ProviderTopUpIdempotencyRecord,
  ProviderTopUpIdempotencyRepository
} from "./provider-top-up-idempotency-repository.js";

export const teviProviderName = "tevi";
export const teviTopupEvent = "user_topup";

// The webhook coordinator never trusts a provider-supplied balance, never auto-creates players, and credits
// 1 Tevi Star = 1 in-game credit (TEVI-FR-7). It verifies-before-effects (signature is checked in the route),
// normalizes the event + idempotency key, resolves the player, and performs idempotent atomic crediting.

export type TeviWebhookProcessStatus = "credited" | "replayed" | "ignored" | "failed" | "duplicate";

export interface TeviWebhookProcessResult {
  status: TeviWebhookProcessStatus;
  reasonCode: string;
  providerEventId: string | null;
}

export interface TeviWebhookServicePort {
  process(input: { payload: unknown; requestId: string }): Promise<TeviWebhookProcessResult>;
}

// Read-only player lookup the webhook path depends on (PlayerSessionRepository implements this).
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
  credited: boolean; // a new credit transaction was written and the record marked completed
  alreadyCompleted: boolean; // the idempotency record was already completed — prior result preserved, no mutation
  balanceAfter: number;
  transactionId: string | null;
}

// Atomic credit-on-completion: wallet credit + wallet_transactions row + idempotency completion commit together.
export interface TeviWebhookCreditPort {
  creditTopupAtomically(input: TeviWebhookCreditInput): Promise<TeviWebhookCreditResult>;
}

export interface TeviWebhookServiceDeps {
  idempotencyRepository: ProviderTopUpIdempotencyRepository;
  creditPort: TeviWebhookCreditPort;
  playerLookup: TeviWebhookPlayerLookup;
}

interface ParsedTopup {
  kind: "topup";
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

type ParsedWebhook = ParsedTopup | ParsedIgnored | ParsedInvalid;

export class TeviWebhookService implements TeviWebhookServicePort {
  public constructor(private readonly deps: TeviWebhookServiceDeps) {}

  public async process(input: { payload: unknown; requestId: string }): Promise<TeviWebhookProcessResult> {
    const parsed = parseWebhook(input.payload);

    if (parsed.kind === "ignored") {
      return this.recordNonCrediting(parsed.providerEventId, parsed.event, "ignored", parsed.reasonCode, input.requestId);
    }
    if (parsed.kind === "invalid") {
      // Token-safe shape diagnostics so a real payload that doesn't match the documented shape can be diagnosed
      // on the first live delivery (playbook §8) — key names + value TYPES only, never any values.
      logWebhookShape(input.requestId, parsed.providerEventId, parsed.event, parsed.reasonCode, input.payload);
      return this.recordNonCrediting(parsed.providerEventId, parsed.event, "failed", parsed.reasonCode, input.requestId);
    }

    // Resolve player BEFORE reserving so an unknown user never reserves a creditable record.
    const player = await this.deps.playerLookup.findPlayerByProviderSubject(teviProviderName, parsed.teviSubject);
    if (!player) {
      return this.recordNonCrediting(parsed.providerEventId, parsed.event, "failed", "unknown_user", input.requestId);
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

      // Same idempotency key but a DIFFERENT provider event id ⇒ conflicting delivery, quarantine without mutation.
      if (reservation.duplicateReason === "idempotency_key" && existing.providerEventId !== parsed.providerEventId) {
        return this.quarantineConflict(parsed.providerEventId, parsed.event, "idempotency_key_conflict", existing, input.requestId);
      }

      // Same provider event id but a DIFFERENT player or amount ⇒ conflicting payload, quarantine without mutation.
      const payloadMatches = existing.playerId === player.playerId && existing.pointAmount === parsed.amount;
      if (!payloadMatches) {
        return this.quarantineConflict(parsed.providerEventId, parsed.event, "conflicting_payload", existing, input.requestId);
      }

      // Matching payload that already reached a terminal non-credit state ⇒ preserve it, do not re-credit.
      if (existing.status === "failed" || existing.status === "ignored" || existing.status === "duplicate") {
        logWebhook("event already terminal", input.requestId, parsed.providerEventId, parsed.event, existing.status);
        return { status: existing.status, reasonCode: "already_terminal", providerEventId: parsed.providerEventId };
      }
      // status "completed" or "pending" with a matching payload falls through to the atomic credit path,
      // which is idempotent: it returns the prior result for "completed" and credits exactly once for "pending".
    }

    const creditResult = await this.deps.creditPort.creditTopupAtomically({
      providerEventId: parsed.providerEventId,
      playerId: player.playerId,
      amount: parsed.amount,
      correlationId: input.requestId
    });

    if (creditResult.alreadyCompleted) {
      logWebhook("replay preserved (no double credit)", input.requestId, parsed.providerEventId, parsed.event, "replayed");
      return { status: "replayed", reasonCode: "already_completed", providerEventId: parsed.providerEventId };
    }

    if (!creditResult.credited) {
      logWebhook("credit skipped on non-pending record", input.requestId, parsed.providerEventId, parsed.event, "failed");
      return { status: "failed", reasonCode: "record_not_creditable", providerEventId: parsed.providerEventId };
    }

    logWebhook("wallet credited", input.requestId, parsed.providerEventId, parsed.event, "credited");
    return { status: "credited", reasonCode: "credited", providerEventId: parsed.providerEventId };
  }

  private async recordNonCrediting(
    providerEventId: string | null,
    event: string,
    status: "ignored" | "failed",
    reasonCode: string,
    requestId: string
  ): Promise<TeviWebhookProcessResult> {
    logWebhook(`event ${status}`, requestId, providerEventId, event, reasonCode);

    // Without a provider event id there is no durable dedup key, so we cannot record idempotently — just report.
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
    // Never demote an already-completed credit: a conflicting redelivery of a credited event must NOT overwrite
    // the record's status to "duplicate" (the wallet credit + transaction row already committed). Report the
    // conflict against the existing event id without mutating the completed record.
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
  // Deterministic key from stable provider fields. The DB additionally enforces UNIQUE(provider, event_id)
  // and UNIQUE(provider, normalized_idempotency_key); for Tevi the event id is the documented dedup field.
  return `tevi:${event}:${providerEventId}`;
}

function parseWebhook(payload: unknown): ParsedWebhook {
  if (typeof payload !== "object" || payload === null) {
    return { kind: "invalid", providerEventId: null, event: "unknown", reasonCode: "payload_not_object" };
  }

  const body = payload as Record<string, unknown>;
  const event = typeof body.event === "string" ? body.event : "unknown";
  const providerEventId = typeof body.id === "string" && body.id.trim().length > 0 ? body.id.trim() : null;

  if (event !== teviTopupEvent) {
    // user_withdraw (cashout, Story 8.8) and every other catalogue event are out of scope — record ignored.
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
  if (!metadata) {
    return { kind: "invalid", providerEventId, event, reasonCode: "missing_metadata" };
  }

  if (metadata.type !== "deposit") {
    // user_withdraw carries type "refund"; a non-deposit user_topup is unexpected — do not credit.
    return { kind: "ignored", providerEventId, event, reasonCode: `metadata_type_not_deposit:${stringifyType(metadata.type)}` };
  }

  // Tevi's DOC example carries the user id at BOTH data.user (string) and data.metadata.user_id (number), but a
  // real delivery may include only one (or place it at data.user_id). Gather every plausible location, accept
  // whichever is present, and only flag user_mismatch when two PRESENT candidates actually disagree. The string
  // form is preferred for the subject (a JSON number can lose precision above 2^53). The earlier "both required"
  // cross-check rejected real payloads with reasonCode "missing_user" — see the first-live-event finding (8.6).
  const subjectCandidates = [data.user, data.user_id, metadata.user_id]
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

  return { kind: "topup", providerEventId, event, teviSubject, amount };
}

// Tevi sends the same user id as a quoted string (data.user) and an unquoted number (metadata.user_id).
// Normalize both to the string subject set by the Tevi auth adapter.
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
  // Token-safe: only key names / reason codes / internal ids. Never the secret, signature, or raw payload dump.
  console.info(`[tevi-webhook] ${message}`, {
    requestId,
    event,
    providerEventId,
    reasonCode
  });
}

function logWebhookShape(requestId: string, providerEventId: string | null, event: string, reasonCode: string, payload: unknown): void {
  // Emits key NAMES and value TYPES only (e.g. { data: { user: "string", metadata: { type: "string" } } }) so the
  // real provider payload structure can be diagnosed without leaking ids/secrets/values (playbook §8).
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
  // Primitive: report the TYPE only (string | number | boolean), never the value.
  return typeof value;
}
