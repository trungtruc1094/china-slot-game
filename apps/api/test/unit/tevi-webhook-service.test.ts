import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeviWebhookService } from "../../src/domain/tevi-webhook-service.js";
import {
  FakeCashoutReconciliationPort,
  FakeCreditPort,
  FakeIdempotencyRepository,
  FakePlayerLookup,
  createCashoutReconciliation,
  teviTopupPayload,
  teviWithdrawPayload
} from "../helpers/tevi-webhook-fakes.js";

let repository: FakeIdempotencyRepository;
let creditPort: FakeCreditPort;
let playerLookup: FakePlayerLookup;
let service: TeviWebhookService;

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  repository = new FakeIdempotencyRepository();
  creditPort = new FakeCreditPort(repository);
  playerLookup = new FakePlayerLookup();
  playerLookup.bySubject.set("633505726", { playerId: "player_known", provider: "tevi", subject: "633505726" });
  service = new TeviWebhookService({ idempotencyRepository: repository, creditPort, playerLookup });
});

describe("TeviWebhookService", () => {
  it("credits a valid user_topup exactly once", async () => {
    const result = await service.process({ payload: teviTopupPayload(), requestId: "req_1" });
    expect(result).toEqual({ status: "credited", reasonCode: "credited", providerEventId: "evt_001" });
    expect(creditPort.credits).toEqual([{ providerEventId: "evt_001", playerId: "player_known", amount: 1000, correlationId: "req_1" }]);
    expect(repository.byEvent.get("evt_001")?.status).toBe("completed");
  });

  it("preserves the prior result on replay without double crediting", async () => {
    await service.process({ payload: teviTopupPayload(), requestId: "req_1" });
    const replay = await service.process({ payload: teviTopupPayload(), requestId: "req_2" });
    expect(replay).toEqual({ status: "replayed", reasonCode: "already_completed", providerEventId: "evt_001" });
    expect(creditPort.credits).toHaveLength(1);
  });

  it("reports a conflicting redelivery of a credited event as duplicate without demoting the completed record", async () => {
    await service.process({ payload: teviTopupPayload(), requestId: "req_1" });
    const conflict = await service.process({ payload: teviTopupPayload({ amount: 5000 }), requestId: "req_2" });
    expect(conflict).toEqual({ status: "duplicate", reasonCode: "conflicting_payload", providerEventId: "evt_001" });
    expect(creditPort.credits).toHaveLength(1);
    // The original credit must be preserved — a conflicting redelivery never overwrites a completed record.
    expect(repository.byEvent.get("evt_001")?.status).toBe("completed");
  });

  it("fails safely for an unknown user without crediting or auto-creating", async () => {
    const result = await service.process({ payload: teviTopupPayload({ user: "999999" }), requestId: "req_1" });
    expect(result).toEqual({ status: "failed", reasonCode: "unknown_user", providerEventId: "evt_001" });
    expect(creditPort.credits).toHaveLength(0);
    expect(repository.byEvent.get("evt_001")?.status).toBe("failed");
  });

  it("ignores user_withdraw when cashout reconciliation is not wired", async () => {
    const result = await service.process({ payload: teviWithdrawPayload(), requestId: "req_1" });
    expect(result.status).toBe("ignored");
    expect(result.reasonCode).toBe("event_not_in_scope:user_withdraw");
    expect(creditPort.credits).toHaveLength(0);
  });

  it("reconciles user_withdraw when cashout reconciliation is wired", async () => {
    const cashoutPort = new FakeCashoutReconciliationPort();
    const reconcilingService = new TeviWebhookService({
      idempotencyRepository: repository,
      creditPort,
      playerLookup,
      cashoutReconciliation: createCashoutReconciliation(repository, cashoutPort)
    });

    const result = await reconcilingService.process({ payload: teviWithdrawPayload(), requestId: "req_withdraw" });
    expect(result).toEqual({ status: "reconciled", reasonCode: "cashout_reconciled", providerEventId: "evt_withdraw" });
    expect(cashoutPort.calls).toEqual([{
      providerEventId: "evt_withdraw",
      playerId: "player_known",
      teviSubject: "633505726",
      amount: 100,
      correlationId: "req_withdraw"
    }]);
    expect(repository.byEvent.get("evt_withdraw")?.status).toBe("completed");
    expect(creditPort.credits).toHaveLength(0);
  });

  it("fails on missing metadata", async () => {
    const payload = { id: "evt_bad", event: "user_topup", data: { user: "633505726", amount: 10 } };
    const result = await service.process({ payload, requestId: "req_1" });
    expect(result).toEqual({ status: "failed", reasonCode: "missing_metadata", providerEventId: "evt_bad" });
    expect(creditPort.credits).toHaveLength(0);
  });

  it("credits when only data.user carries the subject (metadata.user_id absent)", async () => {
    const payload = { id: "evt_data_user", event: "user_topup", data: { user: "633505726", amount: 250, metadata: { type: "deposit" } } };
    const result = await service.process({ payload, requestId: "req_1" });
    expect(result.status).toBe("credited");
    expect(creditPort.credits).toEqual([{ providerEventId: "evt_data_user", playerId: "player_known", amount: 250, correlationId: "req_1" }]);
  });

  it("credits when only metadata.user_id carries the subject (data.user absent)", async () => {
    const payload = { id: "evt_meta_user", event: "user_topup", data: { amount: 100, metadata: { user_id: 633505726, type: "deposit" } } };
    const result = await service.process({ payload, requestId: "req_1" });
    expect(result.status).toBe("credited");
    expect(creditPort.credits).toEqual([{ providerEventId: "evt_meta_user", playerId: "player_known", amount: 100, correlationId: "req_1" }]);
  });

  it("logs a token-safe payload shape (key names + types only) on a parse failure", async () => {
    const infoSpy = vi.spyOn(console, "info");
    const payload = { id: "evt_no_user", event: "user_topup", data: { amount: 10, metadata: { type: "deposit" } } };
    const result = await service.process({ payload, requestId: "req_1" });
    expect(result).toEqual({ status: "failed", reasonCode: "missing_user", providerEventId: "evt_no_user" });
    expect(infoSpy).toHaveBeenCalledWith(
      "[tevi-webhook] payload shape on parse failure",
      expect.objectContaining({
        reasonCode: "missing_user",
        shape: { id: "string", event: "string", data: { amount: "number", metadata: { type: "string" } } }
      })
    );
  });

  it("fails when data.user and metadata.user_id disagree", async () => {
    const payload = { id: "evt_mismatch", event: "user_topup", data: { user: "111", amount: 10, metadata: { user_id: 222, type: "deposit" } } };
    const result = await service.process({ payload, requestId: "req_1" });
    expect(result).toEqual({ status: "failed", reasonCode: "user_mismatch", providerEventId: "evt_mismatch" });
  });

  it("fails on a non-positive / non-integer amount", async () => {
    const result = await service.process({ payload: teviTopupPayload({ amount: 0 }), requestId: "req_1" });
    expect(result).toEqual({ status: "failed", reasonCode: "invalid_amount", providerEventId: "evt_001" });
  });
});
