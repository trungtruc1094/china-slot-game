import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeTeviWebhookSignature,
  serializeForTeviSignature,
  verifyTeviWebhookSignature
} from "../../src/domain/tevi-webhook-signature.js";

const secret = "whsec_test_placeholder_secret";

const payload = {
  id: "01978a5c-5678-9012-cdef-345678901234",
  event: "user_topup",
  space_id: "550e8400-e29b-41d4-a716-446655440000",
  created_at: "2024-01-15T10:35:20.456789Z",
  data: {
    user: "633505726",
    amount: 1000,
    metadata: { app_id: "10a1a3c92fda", user_id: 633505726, exchange_id: "019665ff-8e8b-7823-8484-1520cea10af4", type: "deposit" }
  }
};

describe("tevi webhook signature", () => {
  it("serializes to compact JSON with no spaces (matches json.dumps separators=(',',':'))", () => {
    const serialized = serializeForTeviSignature(payload);
    expect(serialized).not.toMatch(/", "|": /);
    expect(serialized).toBe(JSON.stringify(payload));
  });

  it("produces the same hex digest as the Tevi Python sample (re-serialized compact JSON, hex, no prefix)", () => {
    const expected = createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
    const computed = computeTeviWebhookSignature(secret, payload);
    expect(computed).toBe(expected);
    expect(computed).not.toMatch(/^sha256=/);
    expect(computed).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifies a correct bare-hex signature", () => {
    const signature = computeTeviWebhookSignature(secret, payload);
    expect(verifyTeviWebhookSignature(secret, payload, signature)).toEqual({ ok: true });
  });

  it("rejects a missing signature", () => {
    expect(verifyTeviWebhookSignature(secret, payload, undefined)).toEqual({ ok: false, reasonCode: "SIGNATURE_MISSING" });
    expect(verifyTeviWebhookSignature(secret, payload, "")).toEqual({ ok: false, reasonCode: "SIGNATURE_MISSING" });
  });

  it("rejects a wrong-key signature", () => {
    const signature = computeTeviWebhookSignature("a-different-secret", payload);
    expect(verifyTeviWebhookSignature(secret, payload, signature)).toEqual({ ok: false, reasonCode: "SIGNATURE_INVALID" });
  });

  it("rejects a tampered payload", () => {
    const signature = computeTeviWebhookSignature(secret, payload);
    const tampered = { ...payload, data: { ...payload.data, amount: 999999 } };
    expect(verifyTeviWebhookSignature(secret, tampered, signature)).toEqual({ ok: false, reasonCode: "SIGNATURE_INVALID" });
  });

  it("rejects a malformed (non-hex / wrong-length) signature without throwing", () => {
    expect(verifyTeviWebhookSignature(secret, payload, "not-hex-zzzz")).toEqual({ ok: false, reasonCode: "SIGNATURE_INVALID" });
    expect(verifyTeviWebhookSignature(secret, payload, "ab")).toEqual({ ok: false, reasonCode: "SIGNATURE_INVALID" });
  });

  it("rejects a sha256= prefixed signature (Tevi uses bare hex)", () => {
    const signature = computeTeviWebhookSignature(secret, payload);
    expect(verifyTeviWebhookSignature(secret, payload, `sha256=${signature}`)).toEqual({ ok: false, reasonCode: "SIGNATURE_INVALID" });
  });

  it("verifies a non-ASCII payload signed the Python ensure_ascii=True way (uXXXX-escaped)", () => {
    // Simulate Tevi signing json.dumps(payload, separators=(",", ":")) with ensure_ascii=True: every non-ASCII
    // code unit is escaped before HMAC. JS JSON.stringify emits the raw character, so without the ensure_ascii
    // fallback this legitimately-signed event would be rejected with a false 401.
    const nonAsciiPayload = { ...payload, data: { ...payload.data, metadata: { ...payload.data.metadata, name: "José \u{1f600}" } } };
    const raw = JSON.stringify(nonAsciiPayload);
    let asciiSerialized = "";
    for (let i = 0; i < raw.length; i++) {
      const code = raw.charCodeAt(i);
      asciiSerialized += code > 0x7f ? `\\u${code.toString(16).padStart(4, "0")}` : raw[i];
    }
    const pythonStyleSignature = createHmac("sha256", secret).update(asciiSerialized).digest("hex");

    expect(verifyTeviWebhookSignature(secret, nonAsciiPayload, pythonStyleSignature)).toEqual({ ok: true });
  });
});
