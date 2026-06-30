import { createHmac, timingSafeEqual } from "node:crypto";

// Tevi signs the COMPACT re-serialization of the parsed JSON body, verified against the Tevi webhook docs
// (docs.tevi.com/docs/webhook/verification, read 2026-06-30). Their official Python sample is:
//   hmac.new(secret.encode(), json.dumps(payload, separators=(",", ":")).encode(), sha256).hexdigest()
// JS equivalent: JSON.stringify(parsedBody) produces compact JSON (no spaces) and preserves the key order
// established by JSON.parse, which matches Python's order-preserving json.dumps for ASCII payloads.
//
// Known divergence risks (verify empirically on the first live delivery, see Story 8.6 Dev Notes):
//   (a) key ordering — parse->stringify usually matches Tevi's source/dict order;
//   (b) non-ASCII escaping — Python json.dumps defaults to ensure_ascii=True (\uXXXX) while JS does not. We
//       handle this by also trying an ensure_ascii-escaped serialization during verification (see below).
// The digest is bare HEX with NO "sha256=" prefix; comparison is constant-time via crypto.timingSafeEqual.

export function serializeForTeviSignature(parsedBody: unknown): string {
  return JSON.stringify(parsedBody ?? null);
}

// ensure_ascii variant: Python's json.dumps defaults to ensure_ascii=True and escapes every non-ASCII code
// unit to \uXXXX (chars above the BMP become two surrogate escapes), while JS JSON.stringify emits raw UTF-8.
// Escaping each non-ASCII UTF-16 code unit here reproduces Python's bytes, so a payload with an accented
// username no longer yields a false 401 when Tevi signs the ensure_ascii form.
export function serializeForTeviSignatureAscii(parsedBody: unknown): string {
  const raw = serializeForTeviSignature(parsedBody);
  let out = "";
  for (let index = 0; index < raw.length; index++) {
    const codeUnit = raw.charCodeAt(index);
    // Escape every non-ASCII UTF-16 code unit (> 0x7f) to \uXXXX, matching Python's ensure_ascii=True.
    out += codeUnit > 0x7f ? `\\u${codeUnit.toString(16).padStart(4, "0")}` : raw[index];
  }
  return out;
}

export function computeTeviWebhookSignature(secret: string, parsedBody: unknown): string {
  return createHmac("sha256", secret).update(serializeForTeviSignature(parsedBody)).digest("hex");
}

export type TeviSignatureVerification =
  | { ok: true }
  | { ok: false; reasonCode: "SIGNATURE_MISSING" | "SIGNATURE_INVALID" };

export function verifyTeviWebhookSignature(
  secret: string,
  parsedBody: unknown,
  providedSignature: string | undefined | null
): TeviSignatureVerification {
  if (typeof providedSignature !== "string" || providedSignature.trim().length === 0) {
    return { ok: false, reasonCode: "SIGNATURE_MISSING" };
  }

  // Buffer.from with a non-hex string silently drops invalid characters, so the per-candidate length check
  // guards timingSafeEqual (which throws on length mismatch) and rejects malformed signatures.
  const providedBuffer = Buffer.from(providedSignature.trim(), "hex");

  // Accept a match against the compact (raw UTF-8) serialization OR the ensure_ascii variant. The compact form
  // is Tevi's documented method for ASCII payloads and stays primary; the ascii form closes the non-ASCII gap.
  for (const serialize of [serializeForTeviSignature, serializeForTeviSignatureAscii]) {
    const expectedBuffer = createHmac("sha256", secret).update(serialize(parsedBody)).digest();
    if (providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer)) {
      return { ok: true };
    }
  }

  return { ok: false, reasonCode: "SIGNATURE_INVALID" };
}
