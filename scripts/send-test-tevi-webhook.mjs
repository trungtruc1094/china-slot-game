#!/usr/bin/env node
/**
 * Post a signed Tevi `user_topup` webhook to the China Slot API.
 *
 * macOS / Linux (zsh/bash):
 *   EVENT_ID="test-1" TEVI_SECRET_KEY="..." USER_ID="633505726" node scripts/send-test-tevi-webhook.mjs
 *
 * Windows PowerShell:
 *   $env:EVENT_ID="test-1"; $env:TEVI_SECRET_KEY="..."; node scripts/send-test-tevi-webhook.mjs
 *
 * Env:
 *   EVENT_ID            (required) provider event id / dedup key
 *   TEVI_SECRET_KEY     (required) webhook signing secret (same as Tevi secret key)
 *   TEVI_WEBHOOK_SECRET optional override; defaults to TEVI_SECRET_KEY
 *   WEBHOOK_URL         default https://china-slot-api.onrender.com/api/webhooks/tevi
 *   USER_ID             Tevi user subject string (default 633505726)
 *   AMOUNT              Stars to credit (default 1000)
 *   OMIT_METADATA_USER_ID set to 1 to omit metadata.user_id (single-field user shape)
 *   REQUEST_ID          optional x-request-id header (default req_manual_webhook_<EVENT_ID>)
 */

import { createHmac, randomUUID } from "node:crypto";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function compactJson(body) {
  return JSON.stringify(body);
}

function sign(secret, parsedBody) {
  return createHmac("sha256", secret).update(compactJson(parsedBody)).digest("hex");
}

function buildPayload() {
  const eventId = required("EVENT_ID");
  const user = process.env.USER_ID?.trim() || "633505726";
  const amount = Number(process.env.AMOUNT ?? "1000");
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    console.error("AMOUNT must be a positive integer");
    process.exit(1);
  }

  const omitMetadataUserId = ["1", "true", "yes"].includes(
    (process.env.OMIT_METADATA_USER_ID ?? "").trim().toLowerCase()
  );

  const metadata = {
    app_id: process.env.TEVI_APP_ID?.trim() || "AZX29173",
    type: "deposit"
  };
  if (!omitMetadataUserId) {
    metadata.user_id = Number(user);
  }

  return {
    id: eventId,
    event: "user_topup",
    space_id: process.env.SPACE_ID?.trim() || randomUUID(),
    created_at: new Date().toISOString(),
    data: {
      user,
      amount,
      metadata
    }
  };
}

const webhookUrl =
  process.env.WEBHOOK_URL?.trim() || "https://china-slot-api.onrender.com/api/webhooks/tevi";
const secret = process.env.TEVI_WEBHOOK_SECRET?.trim() || required("TEVI_SECRET_KEY");
const payload = buildPayload();
const body = compactJson(payload);
const signature = sign(secret, payload);
const requestId = process.env.REQUEST_ID?.trim() || `req_manual_webhook_${payload.id}`;

console.log("POST", webhookUrl);
console.log("event id:", payload.id);
console.log("user:", payload.data.user, "amount:", payload.data.amount);
console.log("omit metadata.user_id:", !("user_id" in payload.data.metadata));

const response = await fetch(webhookUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-request-id": requestId,
    "X-Tevi-Signature": signature
  },
  body
});

const text = await response.text();
let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  parsed = text;
}

console.log("status:", response.status);
console.log(JSON.stringify(parsed, null, 2));

if (!response.ok) {
  process.exit(1);
}
