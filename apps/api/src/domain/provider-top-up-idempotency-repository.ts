export type ProviderTopUpIdempotencyStatus = "pending" | "completed" | "failed" | "ignored" | "duplicate";

export interface ProviderTopUpIdempotencyInput {
  providerName: string;
  providerEventId: string;
  normalizedIdempotencyKey: string;
  playerId?: string | null;
  pointAmount?: number | null;
  pointsMetadata?: Record<string, unknown>;
  providerMetadata?: Record<string, unknown>;
}

export interface ProviderTopUpCompletionInput {
  providerName: string;
  providerEventId: string;
  pointsMetadata?: Record<string, unknown>;
  providerMetadata?: Record<string, unknown>;
}

export interface ProviderTopUpFailureInput {
  providerName: string;
  providerEventId: string;
  failureReason: string;
  providerMetadata?: Record<string, unknown>;
}

export interface ProviderTopUpDuplicateInput {
  providerName: string;
  providerEventId: string;
  failureReason: string;
  duplicateOfId?: string | null;
  providerMetadata?: Record<string, unknown>;
}

export interface ProviderTopUpIdempotencyRecord {
  id: string;
  providerName: string;
  providerEventId: string;
  normalizedIdempotencyKey: string;
  playerId: string | null;
  status: ProviderTopUpIdempotencyStatus;
  pointAmount: number | null;
  pointsMetadata: Record<string, unknown>;
  providerMetadata: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  completedAt: string | null;
  failureReason: string | null;
}

export interface ProviderTopUpReservationResult {
  record: ProviderTopUpIdempotencyRecord;
  created: boolean;
  duplicateReason: "none" | "provider_event" | "idempotency_key";
}

export interface ProviderTopUpIdempotencyRepository {
  createOrGet(input: ProviderTopUpIdempotencyInput): Promise<ProviderTopUpReservationResult>;
  getByProviderEvent(providerName: string, providerEventId: string): Promise<ProviderTopUpIdempotencyRecord | null>;
  getByIdempotencyKey(providerName: string, normalizedIdempotencyKey: string): Promise<ProviderTopUpIdempotencyRecord | null>;
  markCompleted(input: ProviderTopUpCompletionInput): Promise<ProviderTopUpIdempotencyRecord>;
  markFailed(input: ProviderTopUpFailureInput): Promise<ProviderTopUpIdempotencyRecord>;
  markIgnored(input: ProviderTopUpFailureInput): Promise<ProviderTopUpIdempotencyRecord>;
  markDuplicate(input: ProviderTopUpDuplicateInput): Promise<ProviderTopUpIdempotencyRecord>;
}
