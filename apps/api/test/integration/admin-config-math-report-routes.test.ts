import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculateRtpReport } from "@china-slot-game/game-math";
import { createApp } from "../../src/app.js";
import { InMemoryGameConfigurationRepository } from "../../src/domain/game-configuration-repository.js";
import type { Clock } from "../../src/domain/session-service.js";
import type { ApiEnvelope } from "../../src/schemas/api-envelope.js";
import { simpleConfig } from "../fixtures/simple-config.js";

class MutableClock implements Clock {
  public current = new Date("2026-06-18T08:00:00.000Z");
  public now(): Date {
    return this.current;
  }
}

let server: ReturnType<typeof createServer>;
let baseUrl: string;

beforeEach(async () => {
  const clock = new MutableClock();
  const configRepository = new InMemoryGameConfigurationRepository(clock);
  server = createServer(createApp({ clock, configRepository }));
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
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

function adminHeaders(role = "operator", actor = "operator-1"): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-admin-role": role,
    "x-admin-actor": actor,
    "x-request-id": "req_admin_math_report_test"
  };
}

async function createDraft(id: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/admin/configs/drafts`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ id, config: simpleConfig })
  });
  expect(response.status).toBe(201);
}

describe("admin config math report routes", () => {
  it("calculates and stores the canonical math package report for a draft", async () => {
    await createDraft("draft-report-api");
    const expectedReport = calculateRtpReport(simpleConfig, {
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 }
    });

    const attachedResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-report-api/math-report`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ wager: { lineBet: 1, selectedWays: 1, totalWager: 1 } })
    });
    const fetchedResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-report-api/math-report`, {
      headers: adminHeaders("viewer", "viewer-1")
    });
    const attachedBody = await attachedResponse.json() as ApiEnvelope<{ mathReport: Record<string, unknown> }>;
    const fetchedBody = await fetchedResponse.json() as ApiEnvelope<{ mathReport: Record<string, unknown> }>;

    expect(attachedResponse.status).toBe(201);
    expect(attachedBody.data?.mathReport).toMatchObject({
      id: "math_report_1",
      draftId: "draft-report-api",
      configId: simpleConfig.id,
      configVersionId: simpleConfig.versionId,
      createdBy: "operator-1",
      report: expectedReport
    });
    expect(fetchedResponse.status).toBe(200);
    expect(fetchedBody.data?.mathReport).toEqual(attachedBody.data?.mathReport);
  });

  it("keeps attached reports immutable", async () => {
    await createDraft("draft-report-immutable");
    const request = {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ wager: { lineBet: 1, selectedWays: 1, totalWager: 1 } })
    };
    const firstResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-report-immutable/math-report`, request);
    const secondResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-report-immutable/math-report`, request);

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(409);
    await expect(secondResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "MATH_REPORT_IMMUTABLE" }
    });
  });

  it("rejects invalid math report request payloads and unauthorized attachment", async () => {
    await createDraft("draft-report-invalid");
    const invalidResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-report-invalid/math-report`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ wager: { lineBet: 0, selectedWays: 1, totalWager: 1 } })
    });
    const unauthorizedResponse = await fetch(`${baseUrl}/api/admin/configs/drafts/draft-report-invalid/math-report`, {
      method: "POST",
      headers: adminHeaders("viewer", "viewer-1"),
      body: JSON.stringify({ wager: { lineBet: 1, selectedWays: 1, totalWager: 1 } })
    });

    expect(invalidResponse.status).toBe(400);
    expect(unauthorizedResponse.status).toBe(403);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "INVALID_MATH_REPORT_REQUEST" }
    });
    await expect(unauthorizedResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "ADMIN_UNAUTHORIZED" }
    });
  });
});
