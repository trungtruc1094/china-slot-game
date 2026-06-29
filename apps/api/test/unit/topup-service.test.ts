import { describe, expect, it, vi } from "vitest";
import { TopupService, fingerprintDepositToken, type TopupSignatureIssuanceRepository, type TeviPaymentClientPort } from "../../src/domain/topup-service.js";

const authContext = {
  provider: "tevi" as const,
  subject: "tevi-user-1",
  displayName: "Tevi Player",
  expiresAt: "2026-06-30T00:00:00.000Z"
};

const config = {
  appId: "AZX29173",
  billingChannelId: "2300210851",
  depositMinStars: 10,
  depositMaxStars: 1000
};

class MemoryIssuanceRepository implements TopupSignatureIssuanceRepository {
  public records: Parameters<TopupSignatureIssuanceRepository["create"]>[0][] = [];

  public async findByRequestId(requestId: string) {
    return this.records
      .filter((record) => record.requestId === requestId)
      .map((record, index) => ({
        ...record,
        id: `topup_sig_${index + 1}`,
        createdAt: record.createdAt.toISOString()
      }));
  }

  public async create(record: Parameters<TopupSignatureIssuanceRepository["create"]>[0]) {
    this.records.push(record);
    return {
      ...record,
      id: `topup_sig_${this.records.length}`,
      createdAt: record.createdAt.toISOString()
    };
  }
}

describe("TopupService", () => {
  it("issues a deposit token through the provider and records safe metadata", async () => {
    const paymentClient: TeviPaymentClientPort = {
      issueDepositToken: vi.fn(async () => ({ ok: true as const, depositToken: "provider.deposit.token" }))
    };
    const repository = new MemoryIssuanceRepository();
    const service = new TopupService(config, paymentClient, repository, { now: () => new Date("2026-06-29T00:00:00.000Z") });

    await expect(service.issueSignature({
      playerId: "player_123",
      teviAuth: authContext,
      amount: 100,
      requestId: "req_success"
    })).resolves.toEqual({
      ok: true,
      depositToken: "provider.deposit.token",
      tokenFingerprint: fingerprintDepositToken("provider.deposit.token")
    });
    expect(paymentClient.issueDepositToken).toHaveBeenCalledWith({
      appId: "AZX29173",
      billingChannelId: "2300210851",
      playerId: "player_123",
      teviSubject: "tevi-user-1",
      amount: 100,
      requestId: "req_success"
    });
    expect(repository.records).toEqual([{ 
      providerName: "tevi",
      playerId: "player_123",
      teviSubject: "tevi-user-1",
      amount: 100,
      requestId: "req_success",
      depositTokenFingerprint: fingerprintDepositToken("provider.deposit.token"),
      status: "issued",
      failureReason: null,
      providerStatusCode: null,
      providerMetadata: { appId: "AZX29173", billingChannelId: "2300210851" },
      createdAt: new Date("2026-06-29T00:00:00.000Z")
    }]);
  });

  it.each([0, -1, 1.25, Number.NaN, Number.POSITIVE_INFINITY, 9])("rejects invalid amount %s before provider calls", async (amount) => {
    const paymentClient: TeviPaymentClientPort = {
      issueDepositToken: vi.fn()
    };
    const repository = new MemoryIssuanceRepository();
    const service = new TopupService(config, paymentClient, repository);

    await expect(service.issueSignature({ playerId: "player_123", teviAuth: authContext, amount, requestId: "req_invalid" })).resolves.toMatchObject({
      ok: false,
      code: amount === 9 ? "TEVI_TOP_UP_LIMIT_EXCEEDED" : "INVALID_TOP_UP_AMOUNT",
      statusCode: 400
    });
    expect(paymentClient.issueDepositToken).not.toHaveBeenCalled();
    expect(repository.records).toHaveLength(1);
    expect(repository.records[0]).toMatchObject({ status: "failed", depositTokenFingerprint: null });
  });

  it("rejects amounts above the configured maximum", async () => {
    const paymentClient: TeviPaymentClientPort = {
      issueDepositToken: vi.fn()
    };
    const repository = new MemoryIssuanceRepository();
    const service = new TopupService(config, paymentClient, repository);

    await expect(service.issueSignature({ playerId: "player_123", teviAuth: authContext, amount: 1001, requestId: "req_limit" })).resolves.toMatchObject({
      ok: false,
      code: "TEVI_TOP_UP_LIMIT_EXCEEDED",
      reasonCode: "AMOUNT_ABOVE_MAX",
      statusCode: 400
    });
    expect(paymentClient.issueDepositToken).not.toHaveBeenCalled();
  });

  it("rejects missing player identity without wallet mutation or provider calls", async () => {
    const paymentClient: TeviPaymentClientPort = {
      issueDepositToken: vi.fn()
    };
    const repository = new MemoryIssuanceRepository();
    const service = new TopupService(config, paymentClient, repository);

    await expect(service.issueSignature({ playerId: "", teviAuth: authContext, amount: 100, requestId: "req_no_player" })).resolves.toMatchObject({
      ok: false,
      code: "TEVI_AUTH_REQUIRED",
      statusCode: 401
    });
    expect(paymentClient.issueDepositToken).not.toHaveBeenCalled();
  });

  it("fails closed on duplicate request IDs before provider calls", async () => {
    const paymentClient: TeviPaymentClientPort = {
      issueDepositToken: vi.fn(async () => ({ ok: true as const, depositToken: "provider.deposit.token" }))
    };
    const repository = new MemoryIssuanceRepository();
    const service = new TopupService(config, paymentClient, repository, { now: () => new Date("2026-06-29T00:00:00.000Z") });

    await expect(service.issueSignature({ playerId: "player_123", teviAuth: authContext, amount: 100, requestId: "req_duplicate" })).resolves.toMatchObject({
      ok: true
    });
    await expect(service.issueSignature({ playerId: "player_123", teviAuth: authContext, amount: 100, requestId: "req_duplicate" })).resolves.toEqual({
      ok: false,
      code: "TEVI_TOP_UP_DUPLICATE_REQUEST",
      reasonCode: "REQUEST_ID_ALREADY_USED",
      statusCode: 409
    });
    expect(paymentClient.issueDepositToken).toHaveBeenCalledTimes(1);
    expect(repository.records).toHaveLength(1);
  });

  it("records failed provider issuance with safe failure metadata", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const paymentClient: TeviPaymentClientPort = {
      issueDepositToken: vi.fn(async () => ({
        ok: false as const,
        code: "TEVI_TOP_UP_SIGNATURE_FAILED" as const,
        reasonCode: "PROVIDER_REJECTED",
        statusCode: 401,
        providerStatusCode: 403
      }))
    };
    const repository = new MemoryIssuanceRepository();
    const service = new TopupService(config, paymentClient, repository);

    await expect(service.issueSignature({ playerId: "player_123", teviAuth: authContext, amount: 100, requestId: "req_provider_failed" })).resolves.toMatchObject({
      ok: false,
      code: "TEVI_TOP_UP_SIGNATURE_FAILED",
      reasonCode: "PROVIDER_REJECTED",
      statusCode: 401
    });
    expect(repository.records[0]).toMatchObject({
      status: "failed",
      depositTokenFingerprint: null,
      failureReason: "PROVIDER_REJECTED",
      providerStatusCode: 403
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("provider.deposit.token");
    warnSpy.mockRestore();
  });
});
