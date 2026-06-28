import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

let server: ReturnType<typeof createServer>;
let baseUrl: string;

beforeEach(async () => {
  server = createServer(createApp());
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

describe("Tevi webhook registration route", () => {
  it("echoes the Tevi challenge parameter for sandbox URL verification", async () => {
    const response = await fetch(`${baseUrl}/api/webhooks/tevi?challenge=tevi_sandbox_challenge`, {
      method: "POST",
      headers: { "x-request-id": "req_tevi_challenge" }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    await expect(response.text()).resolves.toBe("tevi_sandbox_challenge");
  });

  it("rejects non-challenge webhook posts until signature verification is implemented", async () => {
    const response = await fetch(`${baseUrl}/api/webhooks/tevi`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_tevi_placeholder"
      },
      body: JSON.stringify({ type: "topup", eventId: "evt_story_8_1_placeholder" })
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: "TEVI_WEBHOOK_PROCESSING_NOT_IMPLEMENTED",
        message: "Tevi webhook event processing requires signature verification in a later story.",
        details: {
          expectedHeader: "X-Tevi-Signature"
        }
      },
      requestId: "req_tevi_placeholder"
    });
  });
});