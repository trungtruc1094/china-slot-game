import type { PlayerRecord } from "../../src/domain/player-identity.js";
import type {
  ProviderTopUpCompletionInput,
  ProviderTopUpDuplicateInput,
  ProviderTopUpFailureInput,
  ProviderTopUpIdempotencyInput,
  ProviderTopUpIdempotencyRecord,
  ProviderTopUpIdempotencyRepository,
  ProviderTopUpReservationResult
} from "../../src/domain/provider-top-up-idempotency-repository.js";
import type {
  TeviWebhookCreditInput,
  TeviWebhookCreditPort,
  TeviWebhookCreditResult,
  TeviWebhookPlayerLookup
} from "../../src/domain/tevi-webhook-service.js";

// In-memory idempotency repo mirroring the Postgres uniqueness + status semantics for fast service/route tests.
export class FakeIdempotencyRepository implements ProviderTopUpIdempotencyRepository {
  public readonly byEvent = new Map<string, ProviderTopUpIdempotencyRecord>();
  private seq = 0;

  public async createOrGet(input: ProviderTopUpIdempotencyInput): Promise<ProviderTopUpReservationResult> {
    const byEvent = this.byEvent.get(input.providerEventId);
    if (byEvent) {
      return { record: byEvent, created: false, duplicateReason: "provider_event" };
    }
    const byKey = [...this.byEvent.values()].find((record) => record.normalizedIdempotencyKey === input.normalizedIdempotencyKey);
    if (byKey) {
      return { record: byKey, created: false, duplicateReason: "idempotency_key" };
    }
    const record: ProviderTopUpIdempotencyRecord = {
      id: `rec_${++this.seq}`,
      providerName: input.providerName,
      providerEventId: input.providerEventId,
      normalizedIdempotencyKey: input.normalizedIdempotencyKey,
      playerId: input.playerId ?? null,
      status: "pending",
      pointAmount: input.pointAmount ?? null,
      pointsMetadata: input.pointsMetadata ?? {},
      providerMetadata: input.providerMetadata ?? {},
      firstSeenAt: "2026-06-30T00:00:00.000Z",
      lastSeenAt: "2026-06-30T00:00:00.000Z",
      completedAt: null,
      failureReason: null
    };
    this.byEvent.set(record.providerEventId, record);
    return { record, created: true, duplicateReason: "none" };
  }

  public async getByProviderEvent(_providerName: string, providerEventId: string): Promise<ProviderTopUpIdempotencyRecord | null> {
    return this.byEvent.get(providerEventId) ?? null;
  }

  public async getByIdempotencyKey(): Promise<ProviderTopUpIdempotencyRecord | null> {
    return null;
  }

  public async markCompleted(input: ProviderTopUpCompletionInput): Promise<ProviderTopUpIdempotencyRecord> {
    const record = this.require(input.providerEventId);
    record.status = "completed";
    record.completedAt = "2026-06-30T00:00:01.000Z";
    record.failureReason = null;
    return record;
  }

  public async markFailed(input: ProviderTopUpFailureInput): Promise<ProviderTopUpIdempotencyRecord> {
    return this.markTerminal(input.providerEventId, "failed", input.failureReason);
  }

  public async markIgnored(input: ProviderTopUpFailureInput): Promise<ProviderTopUpIdempotencyRecord> {
    return this.markTerminal(input.providerEventId, "ignored", input.failureReason);
  }

  public async markDuplicate(input: ProviderTopUpDuplicateInput): Promise<ProviderTopUpIdempotencyRecord> {
    return this.markTerminal(input.providerEventId, "duplicate", input.failureReason);
  }

  private markTerminal(providerEventId: string, status: ProviderTopUpIdempotencyRecord["status"], reason: string): ProviderTopUpIdempotencyRecord {
    const record = this.require(providerEventId);
    record.status = status;
    record.failureReason = reason;
    return record;
  }

  private require(providerEventId: string): ProviderTopUpIdempotencyRecord {
    const record = this.byEvent.get(providerEventId);
    if (!record) {
      throw new Error(`record missing for ${providerEventId}`);
    }
    return record;
  }
}

// Credit port sharing the idempotency repo so it can complete the record like the atomic Postgres path.
export class FakeCreditPort implements TeviWebhookCreditPort {
  public credits: TeviWebhookCreditInput[] = [];

  public constructor(private readonly repository: FakeIdempotencyRepository) {}

  public async creditTopupAtomically(input: TeviWebhookCreditInput): Promise<TeviWebhookCreditResult> {
    const record = this.repository.byEvent.get(input.providerEventId);
    if (record?.status === "completed") {
      return { credited: false, alreadyCompleted: true, balanceAfter: 1000 + input.amount, transactionId: null };
    }
    if (record && record.status !== "pending") {
      return { credited: false, alreadyCompleted: false, balanceAfter: 1000, transactionId: null };
    }
    this.credits.push(input);
    await this.repository.markCompleted({ providerName: "tevi", providerEventId: input.providerEventId });
    return { credited: true, alreadyCompleted: false, balanceAfter: 1000 + input.amount, transactionId: "txn_fake" };
  }
}

export class FakePlayerLookup implements TeviWebhookPlayerLookup {
  public readonly bySubject = new Map<string, PlayerRecord>();

  public async findPlayerByProviderSubject(_provider: string, subject: string): Promise<PlayerRecord | null> {
    return this.bySubject.get(subject) ?? null;
  }
}

export function teviTopupPayload(overrides: { id?: string; user?: string; amount?: number } = {}): Record<string, unknown> {
  const user = overrides.user ?? "633505726";
  return {
    id: overrides.id ?? "evt_001",
    event: "user_topup",
    space_id: "space_1",
    created_at: "2026-06-30T00:00:00.000Z",
    data: {
      user,
      amount: overrides.amount ?? 1000,
      metadata: { app_id: "app_1", user_id: Number(user), type: "deposit" }
    }
  };
}
