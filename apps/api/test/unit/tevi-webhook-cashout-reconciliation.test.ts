import { describe, expect, it } from "vitest";
import {
  FakeCashoutReconciliationPort,
  FakeIdempotencyRepository,
  createCashoutReconciliation
} from "../helpers/tevi-webhook-fakes.js";

describe("TeviWebhookCashoutReconciliation", () => {
  it("marks a withdraw webhook idempotency record completed on reconcile", async () => {
    const repository = new FakeIdempotencyRepository();
    const cashoutPort = new FakeCashoutReconciliationPort();
    const reconciliation = createCashoutReconciliation(repository, cashoutPort);

    const result = await reconciliation.reconcileUserWithdraw({
      providerEventId: "evt_withdraw_1",
      playerId: "player_1",
      teviSubject: "633505726",
      amount: 2427,
      correlationId: "req_webhook_1"
    });

    expect(result).toEqual({
      status: "reconciled",
      reasonCode: "cashout_reconciled",
      cashoutRequestId: "cashout_test_1"
    });
    expect(repository.byEvent.get("evt_withdraw_1")?.status).toBe("completed");
  });

  it("replays a completed withdraw webhook without calling cashout reconciliation again", async () => {
    const repository = new FakeIdempotencyRepository();
    const cashoutPort = new FakeCashoutReconciliationPort();
    const reconciliation = createCashoutReconciliation(repository, cashoutPort);

    await reconciliation.reconcileUserWithdraw({
      providerEventId: "evt_withdraw_2",
      playerId: "player_1",
      teviSubject: "633505726",
      amount: 100,
      correlationId: "req_webhook_2"
    });
    cashoutPort.calls.length = 0;

    const replay = await reconciliation.reconcileUserWithdraw({
      providerEventId: "evt_withdraw_2",
      playerId: "player_1",
      teviSubject: "633505726",
      amount: 100,
      correlationId: "req_webhook_3"
    });

    expect(replay).toEqual({
      status: "replayed",
      reasonCode: "already_completed",
      cashoutRequestId: null
    });
    expect(cashoutPort.calls).toHaveLength(0);
  });
});
