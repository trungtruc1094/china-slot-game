import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { InMemoryPlayerSessionRepository } from "../../src/domain/player-identity.js";
import { SessionService, type Clock } from "../../src/domain/session-service.js";
import type { TeviAuthResult, TeviAuthVerifier } from "../../src/domain/tevi-auth-adapter.js";
import type { CashoutRequestResult } from "../../src/domain/cashout-request-service.js";
import type { ApiEnvelope } from "../../src/schemas/api-envelope.js";
import type { CashoutRequestServicePort } from "../../src/routes/tevi-cashout.routes.js";

class FixedClock implements Clock {
  public now(): Date {
    return new Date("2026-06-29T00:00:00.000Z");
  }
}

class FakeTeviVerifier implements TeviAuthVerifier {
  public async verify(token: string): Promise<TeviAuthResult> {
    if (token === "valid-token") {
      return {
        ok: true,
        context: {
          provider: "tevi",
          subject: "tevi-user-1",
          displayName: "Tevi Player",
          expiresAt: "2026-06-30T00:00:00.000Z"
        }
      };
    }

    return { ok: false, statusCode: 401, errorCode: "TEVI_TOKEN_INVALID", reasonCode: "TOKEN_VERIFICATION_FAILED" };
  }
}

class FakeCashoutService implements CashoutRequestServicePort {
  public calls: Parameters<CashoutRequestServicePort["requestCashout"]>[0][] = [];

  public constructor(private readonly result: CashoutRequestResult) {}

  public async requestCashout(request: Parameters<CashoutRequestServicePort["requestCashout"]>[0]): Promise<CashoutRequestResult> {
    this.calls.push(request);
    return this.result;
  }
}

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let cashoutService: FakeCashoutService;

const successResult: CashoutRequestResult = {
  ok: true,
  cashoutRequestId: "cashout_req_1",
  status: "dispatched",
  amount: 100,
  balanceAfter: 900,
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  walletTransactionId: "txn_1"
};

afterEach(async () => {
  if (!server?.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

async function startServer(result: CashoutRequestResult = successResult): Promise<void> {
  const sessionRepository = new InMemoryPlayerSessionRepository();
  cashoutService = new FakeCashoutService(result);
  server = createServer(createApp({
    clock: new FixedClock(),
    sessionService: new SessionService(sessionRepository, new FixedClock()),
    teviAuthVerifier: new FakeTeviVerifier(),
    cashoutService
  }));

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

describe("POST /api/v1/payments/cashout-requests", () => {
  it("returns a cashout envelope on success", async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/api/v1/payments/cashout-requests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer valid-token",
        "x-request-id": "req_cashout_1"
      },
      body: JSON.stringify({ amount: 100 })
    });

    expect(response.status).toBe(201);
    const body = await response.json() as ApiEnvelope<{
      cashout_request_id: string;
      status: string;
      amount: number;
      balance_after: number;
    }>;
    expect(body.data).toMatchObject({
      cashout_request_id: "cashout_req_1",
      status: "dispatched",
      amount: 100,
      balance_after: 900
    });
    expect(cashoutService.calls).toHaveLength(1);
    expect(cashoutService.calls[0]).toMatchObject({
      amount: 100,
      requestId: "req_cashout_1",
      teviAuth: { subject: "tevi-user-1" }
    });
  });

  it("maps insufficient balance to 409", async () => {
    await startServer({
      ok: false,
      code: "INSUFFICIENT_BALANCE",
      reasonCode: "WITHDRAWABLE_BALANCE_EXCEEDED",
      statusCode: 409
    });

    const response = await fetch(`${baseUrl}/api/v1/payments/cashout-requests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer valid-token",
        "x-request-id": "req_cashout_2"
      },
      body: JSON.stringify({ amount: 99999 })
    });

    expect(response.status).toBe(409);
    const body = await response.json() as ApiEnvelope<{
      cashout_request_id: string;
      status: string;
      amount: number;
      balance_after: number;
    }>;
    expect(body.error?.code).toBe("INSUFFICIENT_BALANCE");
  });

  it("rejects invalid amount with 400", async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/api/v1/payments/cashout-requests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer valid-token",
        "x-request-id": "req_cashout_3"
      },
      body: JSON.stringify({ amount: -5 })
    });

    expect(response.status).toBe(400);
    const body = await response.json() as ApiEnvelope<{
      cashout_request_id: string;
      status: string;
      amount: number;
      balance_after: number;
    }>;
    expect(body.error?.code).toBe("INVALID_CASHOUT_AMOUNT");
  });

  it("requires Tevi auth", async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/api/v1/payments/cashout-requests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_cashout_4"
      },
      body: JSON.stringify({ amount: 100 })
    });

    expect(response.status).toBe(401);
  });
});
