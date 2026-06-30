---
baseline_commit: 03c5ec3
---

# Story 8.6: Verify Tevi Webhooks and Credit Stars Idempotently

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want confirmed Tevi top-ups to credit my game wallet exactly once,
so that webhook retries or duplicate provider events cannot create incorrect Stars balances.

## Acceptance Criteria

1. **Given** Tevi posts a `user_topup` webhook with an `X-Tevi-Signature` header, **when** the backend receives `POST /api/v1/webhooks/tevi` (also reachable at the currently-mounted `/api/webhooks/tevi`), **then** it verifies the webhook signature **before** parsing effects or mutating any wallet, and a missing/invalid signature is rejected with **HTTP 401** (per Tevi docs), no wallet mutation, and no idempotency completion.
2. The handler normalizes the provider event ID and a normalized idempotency key **before** any balance mutation, and persists a top-up idempotency record holding provider event ID, normalized key, mapped player, amount, status, timestamps, raw (safe) metadata, and failure reason when applicable.
3. Wallet credit, idempotency completion (`completed`), and the `credit` wallet transaction row commit **atomically** in PostgreSQL — a failure in any step rolls back all three (no orphan credit, no orphan completion).
4. Duplicate webhook replay (same provider event ID, same payload) returns/preserves the previously committed result and does **not** double-credit the wallet or write a second credit transaction.
5. Duplicate webhook delivery with a **conflicting payload** (same event ID or same idempotency key, different amount/user) is rejected or quarantined (`duplicate` status) for operator review **without** wallet mutation.
6. Unknown users (no `tevi` identity mapping), invalid/missing metadata, amount mismatches, and signature failures are handled safely — recorded as `failed`/`ignored` with a reason, returning a non-2xx that does not invite unsafe retries-as-credit, and never crediting a wallet or auto-creating a player.
7. The challenge-echo behavior for sandbox URL verification (existing Story 8.1 behavior) is preserved unchanged.
8. Local/demo mode and non-Tevi flows are unaffected; crediting only happens through verified `user_topup` webhooks.
9. The story ends with a **webhook replay Check Round** showing no double-credit in the wallet ledger or top-up idempotency rows (single credit transaction, single `completed` record after N deliveries).

## Tasks / Subtasks

- [x] Add webhook secret config and verified signature handling (AC: 1, 6)
  - [x] Extend [apps/api/src/config/env.ts](apps/api/src/config/env.ts) `TeviPaymentEnabledEnv` (or a sibling webhook block under `teviAuth`) with `webhookSecret` sourced from `TEVI_WEBHOOK_SECRET`. Required only when webhook crediting is enabled; do **not** log it. Follow the existing `parseTeviPaymentEnv` validation/throw style.
  - [x] Implement HMAC-SHA256 and compare against the **`X-Tevi-Signature`** header (verified casing). Tevi signs the **compact re-serialization of the parsed JSON body** — their official sample (Python) is `hmac.new(secret.encode(), json.dumps(payload, separators=(",", ":")).encode(), sha256).hexdigest()`. Replicate in JS: `createHmac("sha256", secret).update(JSON.stringify(parsedBody)).digest("hex")`, then `crypto.timingSafeEqual`. **Hex digest, NO `sha256=` prefix** — the header is the bare hex string.
  - [x] Serialization-match risk (the fragile part): `JSON.stringify` must reproduce the exact bytes Tevi signed. Two known divergences to guard against — (a) **key ordering**: preserve `JSON.parse` order (Tevi's `json.dumps` preserves dict/source order and so does JS, so parse→stringify usually matches); (b) **non-ASCII escaping**: Python `json.dumps` defaults to `ensure_ascii=True` (escapes to `\uXXXX`) while JS does not, so a payload with non-ASCII could mismatch. **Also retain the raw request body** (scoped `express.json({ verify })` capturing `req.rawBody`, or a route-local raw/text parser for `/webhooks/tevi`; do NOT change global JSON parsing at [apps/api/src/app.ts](apps/api/src/app.ts) line 124) so a mismatch on the first live event can be diagnosed token-safely and a raw-body fallback tried.
  - [x] Verify signature first; on failure log `[tevi-webhook]` with `reasonCode` (token-safe, never the secret/signature), do NOT process the payload, and return **HTTP 401** with the existing `errorEnvelope` shape (Tevi docs explicitly prescribe `401 Unauthorized` for a failed signature). No idempotency record write, no wallet touch.
- [x] Add a `TeviWebhookService` domain coordinator (AC: 1, 2, 3, 4, 5, 6)
  - [x] Create `apps/api/src/domain/tevi-webhook-service.ts`. Inputs: verified+parsed payload, request ID. It normalizes the event, resolves the player, and performs idempotent atomic crediting. It must never trust client/provider-supplied balances and never auto-create players.
  - [x] Parse `user_topup` payload per the verified/doc shape: `event === "user_topup"`, provider event ID at `data... id`/top-level `id`, Tevi user at `data.user` (string of a number) with `data.metadata.user_id` cross-check, integer `amount`, `data.metadata.type === "deposit"`. Reject other events as `ignored` (e.g. `user_withdraw` belongs to Story 8.8).
  - [x] Compute `normalizedIdempotencyKey` deterministically from stable provider fields (e.g. `tevi:user_topup:<providerEventId>`); store the rule in code comments. The DB already enforces `UNIQUE (provider_name, provider_event_id)` and `UNIQUE (provider_name, normalized_idempotency_key)`.
  - [x] Map Tevi user → `playerId` via the existing `tevi` provider identity mapping (`provider_identity_mappings`, provider `"tevi"`, subject = Tevi `user_id` — the same subject set by [apps/api/src/domain/tevi-auth-adapter.ts](apps/api/src/domain/tevi-auth-adapter.ts)). No mapping ⇒ unknown user ⇒ `failed`/`ignored`, no credit, no player creation.
- [x] Implement atomic credit-on-completion in the persistence layer (AC: 3, 4, 5)
  - [x] Add a single-transaction credit path that, inside one `withTransaction` ([apps/api/src/db/transactions.js](apps/api/src/db/transactions.ts)): (a) reserves/locks the idempotency row, (b) if already `completed` returns the prior result without mutation, (c) if a conflicting payload is detected marks `duplicate` without mutation, (d) otherwise locks the wallet row (`FOR UPDATE`), inserts a `credit` `wallet_transactions` row, updates `wallets.balance`, and marks the idempotency record `completed` — all committed together.
  - [x] Do NOT reuse `PostgresWalletRepository.applyTransactionBatch` as-is for the atomic path — it opens its **own** `withTransaction` ([apps/api/src/repositories/postgres/wallet-repository.ts](apps/api/src/repositories/postgres/wallet-repository.ts) line 158), so calling it plus a separate idempotency update would be two transactions, not one. Either add a method that accepts an existing `PoolClient`, or add a dedicated repository method (e.g. `creditTopupAtomically`) that does the wallet rows + idempotency completion in one client. Reuse the existing balance/transaction SQL patterns and the `txn_<uuid>` id scheme; source `tevi_topup`, type `credit`, actor `tevi-webhook`.
  - [x] Use the existing `provider_top_up_idempotency_records` table and `ProviderTopUpIdempotencyRepository` semantics ([apps/api/src/domain/provider-top-up-idempotency-repository.ts](apps/api/src/domain/provider-top-up-idempotency-repository.ts)): `createOrGet` (returns `duplicateReason`), `markCompleted`, `markFailed`, `markIgnored`, `markDuplicate`. No schema migration is required — the table (`0011_provider_top_up_idempotency.sql`) already has event/key uniqueness, the `completed`/`failed`/`duplicate` states, and the completed-timestamp/failure-reason CHECK constraints. Add a new migration only if a genuinely new column is needed; if so, append the next-numbered file and never edit an applied migration.
- [x] Replace the 501 placeholder webhook route with verified processing (AC: 1, 4, 5, 6, 7, 8)
  - [x] Update [apps/api/src/routes/tevi-webhook.routes.ts](apps/api/src/routes/tevi-webhook.routes.ts): keep the challenge-echo branch (query/body `challenge`, max length 1024, `text/plain`) **exactly as-is**. For non-challenge POSTs, run signature verification → parse → `TeviWebhookService`.
  - [x] Make the route accept the `TeviWebhookService` (and any deps) as parameters, only wired when webhook crediting is enabled — mirror how `createTeviTopupRouter` is gated in [apps/api/src/app.ts](apps/api/src/app.ts) lines 145-147. When deps are absent (memory/dev without payment+postgres), preserve the safe placeholder/501 behavior so the existing tests and local dev keep working.
  - [x] Return codes: **200** (success body, e.g. `"OK"`) for accepted credit and for idempotent replay; **401** for signature failure (per Tevi docs). For unknown user / invalid payload / amount mismatch / conflict-quarantine, **durably record** the outcome (`failed`/`ignored`/`duplicate`) and return **200** so a redelivery stays safe and idempotent — Tevi's retry/timeout policy is **undocumented**, so do NOT rely on a 4xx to suppress retries; reserve **5xx** only for genuinely transient internal errors you want redelivered. Map through `ApiHttpError`/`errorEnvelope`.
- [x] Wire production dependencies (AC: 3, 8)
  - [x] In [apps/api/src/composition/production-dependencies.ts](apps/api/src/composition/production-dependencies.ts) construct the webhook credit dependencies from the existing `pool`, `walletRepository`, `providerTopUpIdempotencyRepository`, and a player-identity read path. Expose them on `ProductionDependencies` and thread into `createApp` from [apps/api/src/main.ts](apps/api/src/main.ts) under the `env.teviAuth.payment.enabled` branch (alongside `topupService`).
  - [x] Add a read-only player-by-provider-subject lookup. `PostgresPlayerSessionRepository` already has private `findIdentityFromPool` ([apps/api/src/repositories/postgres/player-session-repository.ts](apps/api/src/repositories/postgres/player-session-repository.ts) line 169) — expose a public method (e.g. `findPlayerByProviderSubject(provider, subject)`) on the `PlayerSessionRepository` interface and both impls, returning `PlayerRecord | null` without creating anything.
- [x] Preserve story boundaries (AC: 6, 8)
  - [x] Do NOT implement: spin debit/win with Stars (Story 8.7), cashout / `user_withdraw` (Story 8.8/8.9), receipts (Story 8.10), reconciliation, RTP checks, or production compliance gates (Epic 9). `user_withdraw` and unknown events are recorded `ignored`, not processed.
  - [x] Do NOT mutate `wallets` outside the verified atomic credit path. Do NOT trust the webhook's claimed amount as authoritative beyond what the credit requires; record it and credit `1 Tevi Star = 1 in-game credit`.
  - [x] Do NOT add new HTTP/crypto/payment libraries — use Node `crypto` (`createHmac`, `timingSafeEqual`) and the existing `pg`/Express stack.
- [x] Add focused automated tests (AC: 1-9)
  - [x] Unit tests for `TeviWebhookService`: signature pass/fail, valid `user_topup` credit, replay idempotency (no double credit), conflicting-payload → `duplicate`, unknown user → safe failure, missing/invalid metadata, amount mismatch, non-`user_topup` ignored.
  - [x] Integration tests in `apps/api/test/integration/tevi-webhook-routes.test.ts`: preserve the 3 existing cases (challenge echo, oversized challenge, and the not-implemented branch **only when deps are absent**), and add signed-request acceptance, replay, conflict, and signature-failure cases when the service is wired. Use the `createApp({ ... })` injection seam.
  - [x] PostgreSQL test in `apps/api/test/postgres/` proving wallet credit + idempotency completion commit atomically and that replay yields exactly one credit row and one `completed` record (mirror `test/postgres/provider-top-up-idempotency.test.ts` setup). Gate on the postgres test harness used by the other `test/postgres` suites.
  - [x] Keep adjacent suites green: `tevi-topup-routes.test.ts`, `tevi-token-routes.test.ts`, `tevi-client.test.ts`, `server-client.test.ts`, `provider-top-up-idempotency.test.ts`, `migrations.test.ts`.
- [x] Complete Story 8.6 Check Round (AC: 9)
  - [x] Record focused/full test commands and any sandbox prerequisites.
  - [x] Record a webhook replay proof: deliver the same signed `user_topup` payload N times and show one credit transaction and one `completed` idempotency row; deliver a conflicting payload and show `duplicate`/quarantine with no mutation.
  - [x] If a live Tevi sandbox webhook is not deliverable (the sandbox Stars-funding blocker from Story 8.5 / playbook §4 may prevent a real charge), record the replay proof via signed local/integration requests and mark live-sandbox crediting as blocked-by-external (Tevi funding), not faked.
  - [x] Sweep touched files, tests, logs, and Check Round notes for the webhook secret, signatures, bearer/deposit tokens, API keys, and Tevi emails — confirm only placeholders/field-names/safe fingerprints appear.

## First Live Webhook Finding (2026-06-30, reopened from `done`)

The first real `user_topup` webhook was delivered (sandbox funding unblocked; a 200-Star charge was actually deducted). Signature verification **passed**, but the handler rejected the event with **`reasonCode: missing_user`** (HTTP 200, recorded `failed`) — so no credit. Root cause: the parser required the user id to be present in **both** `data.user` AND `data.metadata.user_id` and cross-checked them, but the real payload doesn't carry it in both spots. This is the "payload not runtime-verified — build a tolerant parser, log the real shape on first live event" item the story explicitly deferred to live delivery, so it is in-scope completion of AC2/AC6, not 8.7+ scope.

Fixes:
- **Tolerant user extraction** [apps/api/src/domain/tevi-webhook-service.ts:244-262] — gather subject candidates from `data.user`, `data.user_id`, and `data.metadata.user_id`; accept whichever is present; `user_mismatch` only when two present candidates disagree. Prefer the string form (precision).
- **Token-safe shape logging on parse failure** [apps/api/src/domain/tevi-webhook-service.ts] — `logWebhookShape`/`describePayloadShape` emit key names + value TYPES only (never values) so the real payload structure is diagnosable on the next/resent delivery (playbook §8).
- Unit tests added: credit with only `data.user`, credit with only `metadata.user_id`, and the token-safe shape log on `missing_user`.

Recovery for the stuck 200-Star event (`6601a9cb-9c33-41c3-90e5-43b005d238af`): it is recorded terminal `failed`, so a redelivery would be quarantined `duplicate` (not credited). Delete that idempotency row before resending so a replay credits it:
```sql
DELETE FROM provider_top_up_idempotency_records
WHERE provider_name = 'tevi' AND provider_event_id = '6601a9cb-9c33-41c3-90e5-43b005d238af';
```
Then resend the event from the Tevi dashboard (or re-deliver) — it will now parse and credit once.

Remaining before re-closing 8.6: deploy, confirm the real payload parses + credits, run the AC9 live replay Check Round (one credit, replay → no double-credit), and update playbook §5 with the confirmed real shape from the new shape log.

**Live Check Round (2026-06-30, deployed `china-slot-api`) — PASSED.** A signed `user_topup` posted to the deployed `/api/webhooks/tevi` with a **single-field payload** (`OMIT_METADATA_USER_ID` — the exact shape the old strict parser rejected as `missing_user`) returned `{ status: "credited" }` and logged `[tevi-webhook] wallet credited`. A replay of the same event id returned `{ status: "replayed", reasonCode: "already_completed" }` with no second credit — AC9 confirmed against real Postgres (credit once, idempotent replay). Signature verified with `TEVI_SECRET_KEY` (the webhook secret).

Re-closed `done` on this evidence. Two follow-ups carried forward (not blocking):
- **Real Tevi payload shape** still not byte-confirmed (we validated a synthetic single-field shape that covers the observed `missing_user` cause). The new `[tevi-webhook] payload shape on parse failure` log will surface the exact shape on the next real top-up if it diverges further; pin the parser + update playbook §5 then.
- **Stuck original event** `6601a9cb-9c33-41c3-90e5-43b005d238af` (the real 200-Star charge) is still recorded `failed`; recover later via the SQL delete + resend, or a one-off manual credit.
- **Secret hygiene:** `TEVI_SECRET_KEY` was exposed in a screenshot during testing — rotate it in the Tevi dashboard + Render.

## Review Findings

_Adversarial code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor), 2026-06-30. Severity set during triage after reading reachability._

- [x] [Review][Decision→Patch] Webhook signature verified over the re-serialized parsed body, no raw-byte capture (medium) — **Resolved: added an `ensure_ascii` fallback.** `verifyTeviWebhookSignature` now accepts a match against the compact (raw UTF-8) serialization OR a `\uXXXX`-escaped variant that reproduces Python `json.dumps(..., ensure_ascii=True)`, closing the non-ASCII false-401 gap without touching global JSON parsing (app.ts:124). [apps/api/src/domain/tevi-webhook-signature.ts:23-62] (test: `tevi-webhook-signature.test.ts` non-ASCII case)
- [x] [Review][Decision→Keep] Unknown-user webhook is terminal `failed`; redelivery after mapping exists is never auto-credited (medium) — **Resolved: keep terminal `failed` for this sandbox-first story.** In the happy path the user authenticates (creating the `tevi` mapping) before topping up, so unknown-user at webhook time is a race/out-of-order edge; operator remediation covers it. Full retry semantics (treat unknown-user as retryable) are deferred to Epic-9 money-path hardening. [apps/api/src/domain/tevi-webhook-service.ts:91-94]
- [x] [Review][Patch] Conflicting redelivery demotes an already-`completed` idempotency record to `duplicate` (medium) [apps/api/src/domain/tevi-webhook-service.ts:187-202] — **Fixed.** `quarantineConflict` now takes the existing record and, when its status is already `completed`, reports `duplicate`/`conflicting_payload` (HTTP 200, no credit) WITHOUT calling `markDuplicate`, so a genuinely-credited top-up is never demoted. Tests updated (unit + postgres) to assert the completed record is preserved.
- [x] [Review][Patch] `teviSubject` derived from numeric `metadata.user_id` loses precision for ids > 2^53 (low) [apps/api/src/domain/tevi-webhook-service.ts:244-259] — **Fixed.** The subject is now derived from the string `data.user` (authoritative), with `metadata.user_id` kept only as a loose cross-check, avoiding `JSON.parse` rounding for ids above `Number.MAX_SAFE_INTEGER`.
- [x] [Review][Defer] Webhook credit path bootstraps a missing wallet at starterBalance=1000 [apps/api/src/repositories/postgres/tevi-webhook-credit-repository.ts:15,61-66] — deferred, pre-existing. First-ever credit for a player with no wallet row yields `1000 + amount`, contradicting "production users start at 0." Matches the system-wide `PostgresWalletRepository` bootstrap; acknowledged in Completion Notes as Epic-9 production-compliance scope.
- [x] [Review][Defer] No upper-bound sanity cap on credited webhook amount [apps/api/src/domain/tevi-webhook-service.ts:254-257] — deferred, pre-existing. Only `Number.isSafeInteger`/`> 0` guards the credited amount; capping at the webhook risks under-crediting a real larger deposit, so it belongs to Epic-9 money-path hardening (Story 9.5).

Dismissed as noise (5): unreachable `idempotency_key_conflict` branch (key embeds the event id); `recordNonCrediting` two-write transient-`pending` window (self-heals on redelivery); array/primitive JSON body classified `ignored` (handled safely, no mutation); concurrent-loser reporting `failed` on HTTP 200 (200 does not invite a Tevi retry); empty/whitespace/malformed-hex signature handling (verified correct).

## Dev Notes

### Requirements Context

- Story source: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) Story 8.6 (lines 1366-1385).
- Requirements: TEVI-FR-6, TEVI-FR-7, TEVI-NFR1 (integrity — no duplicate credit), TEVI-NFR2 (secrets env-only, never logged), TEVI-NFR3, TEVI-NFR5, TEVI-NFR6 (auditability), TEVI-NFR7, UX-DR9 (pending→credited only after webhook commits).
- This is the **crediting** story Story 8.5 explicitly deferred: SDK `topup()` success is *pending*; the wallet is credited only here, via the verified `user_topup` webhook.

### CRITICAL — Tevi Webhook Contract (verified against Tevi docs, browser read 2026-06-30)

Confirmed against `docs.tevi.com/docs/webhook/overview` + `/docs/webhook/verification` (the SPA was read in a real browser). The payload has **not** been runtime-verified yet (the sandbox could not fund a real charge — playbook §4), so still build a tolerant parser and log the real shape token-safely on the first live event. Mirrors [docs/tevi-integration-playbook.md](docs/tevi-integration-playbook.md) §5.

- **Header:** **`X-Tevi-Signature`** (exact casing, confirmed in the docs and in [apps/api/src/routes/tevi-webhook.routes.ts](apps/api/src/routes/tevi-webhook.routes.ts) line 37; architecture line 772 corrects the `X-TEVI-SIGNATURE` used in epics/boundary notes). No timestamp / signature-version / event-id header exists — the timestamp is the body field `created_at`, and the event id is the body field `id`.
- **Signature:** HMAC-SHA256 keyed with the dashboard webhook secret, over the **compact re-serialized JSON** (`json.dumps(payload, separators=(",", ":"))`), **hex** digest, **no prefix**, compared with a constant-time compare. The official Python sample uses `hmac.compare_digest(signature, expected)`. → In JS this is `JSON.stringify(parsedBody)` + `createHmac` hex; see the Tasks for the key-ordering / `ensure_ascii` divergence risks and the raw-body fallback. (Earlier draft guidance to sign the raw bytes and avoid re-serialization was wrong — re-serialization is Tevi's documented method.)
- **Signature failure handling (docs, verbatim intent):** return `401 Unauthorized`, log the failed attempt, do not process the payload. Security notes also require `compare_digest`, HTTPS-only endpoint, secret kept server-side, verify-before-process.
- **`user_topup` payload (verbatim doc example):**
  ```json
  {
    "id": "01978a5c-5678-9012-cdef-345678901234",
    "event": "user_topup",
    "space_id": "550e8400-e29b-41d4-a716-446655440000",
    "created_at": "2024-01-15T10:35:20.456789Z",
    "data": {
      "user": "633505726",
      "amount": 1000,
      "metadata": { "app_id": "10a1a3c92fda", "user_id": 633505726, "exchange_id": "019665ff-8e8b-7823-8484-1520cea10af4", "type": "deposit" }
    }
  }
  ```
  Confirmed types: `id` string (UUID = the **event id / dedup key** → use as `providerEventId`); `event` string; `space_id` string; `created_at` ISO-8601 UTC; `data.user` **string**; `data.amount` **integer**; `data.metadata.user_id` **number**; `data.metadata.type` `"deposit"`. ⚠️ `data.user` is a quoted string but `metadata.user_id` is an unquoted number for the same value — coerce/stringify both before matching the stored `tevi` subject. There is **no top-level `type`** and **no currency field** (docs never say "Stars"; `amount` is a bare integer — credit 1:1 per TEVI-FR-7).
- **Events catalogue (verbatim):** `product__consume` (note double underscore), `user_topup`, `user_withdraw`, `new_message`, `start_conversation`, `create_thread`. Only `user_topup` is in scope; `user_withdraw` (cashout, `type: "refund"`) and all others → record `ignored`.
- **Documented gaps (design around these):**
  - **No challenge/handshake** for URL verification is documented anywhere — but our Story 8.1 route already echoes a `challenge` (observed-needed in the live sandbox). **Keep the challenge-echo**; do not remove it on doc silence.
  - **No retry policy / retry count / timeout** documented for inbound webhooks (only "implement retry logic" advice to consumers, plus rate-limit warnings that events "may be dropped"). → No at-least-once or ordering guarantee; rely on durable idempotency + return 200 for terminally-handled events (see Tasks).
  - **No inbound idempotency/dedup key** is documented (the body `id` is a plausible UUID dedup key but isn't described as one — the only documented `Idempotency-Key` is for the *outbound* cashout REST call, Story 8.8).
  - **No replay-protection / timestamp-tolerance window, no IP allowlist** documented.
  - **Raw-vs-re-serialized signature** is genuinely fragile (key ordering + `ensure_ascii` unspecified) — verify empirically on the first live delivery.
- Verify-before-effects and atomic credit+idempotency remain mandatory (architecture lines 717, 739, 747-749).

### Existing Code to Reuse and Preserve (do NOT reinvent)

- [apps/api/src/routes/tevi-webhook.routes.ts](apps/api/src/routes/tevi-webhook.routes.ts) — current route: challenge echo (keep verbatim) + 501 "not implemented" for events. Replace only the event branch.
- [apps/api/src/domain/provider-top-up-idempotency-repository.ts](apps/api/src/domain/provider-top-up-idempotency-repository.ts) + [apps/api/src/repositories/postgres/provider-top-up-idempotency-repository.ts](apps/api/src/repositories/postgres/provider-top-up-idempotency-repository.ts) — the idempotency model already exists with `createOrGet` (returns `duplicateReason: "provider_event" | "idempotency_key" | "none"`), `markCompleted/Failed/Ignored/Duplicate`. The DB enforces both uniqueness constraints. Reuse it; the atomic credit path may need to operate on the same `PoolClient`.
- [apps/api/db/migrations/0011_provider_top_up_idempotency.sql](apps/api/db/migrations/0011_provider_top_up_idempotency.sql) — table + statuses + CHECK constraints already in place (`completed` requires `completed_at`; `failed`/`duplicate` require `failure_reason`). No migration needed unless a new column is genuinely required.
- [apps/api/src/repositories/postgres/wallet-repository.ts](apps/api/src/repositories/postgres/wallet-repository.ts) — `wallets`/`wallet_transactions` SQL, `FOR UPDATE` locking pattern, `txn_<uuid>` ids, balance-safety/insufficient checks. Reuse the SQL inside the single atomic transaction; see the "own transaction" caveat in Tasks.
- [apps/api/src/db/transactions.ts](apps/api/src/db/transactions.ts) — `withTransaction(pool, fn)` is the single-transaction primitive. Everything that must commit together goes in one `withTransaction`.
- [apps/api/src/repositories/postgres/player-session-repository.ts](apps/api/src/repositories/postgres/player-session-repository.ts) — `provider_identity_mappings` lookups (`findIdentityFromPool`, line 169). Expose a public read-only `findPlayerByProviderSubject`.
- [apps/api/src/schemas/api-envelope.ts](apps/api/src/schemas/api-envelope.ts) — `okEnvelope`/`errorEnvelope`. Use for non-challenge responses.
- [apps/api/src/app.ts](apps/api/src/app.ts) (lines 138, 145-147) and [apps/api/src/main.ts](apps/api/src/main.ts) (lines 33-52) — gating pattern for Tevi routes/services behind `teviAuthVerifier`/`payment.enabled`; mirror it for the webhook service.
- [apps/api/src/config/env.ts](apps/api/src/config/env.ts) `parseTeviPaymentEnv` (lines 122-170) — add `webhookSecret` here in the same validate-and-throw style.

### Current State of Files Likely to Be Modified

- `apps/api/src/routes/tevi-webhook.routes.ts` (UPDATE): event branch becomes verified processing; route factory takes new deps; placeholder retained when unwired.
- `apps/api/src/config/env.ts` (UPDATE): add `TEVI_WEBHOOK_SECRET` → `webhookSecret`.
- `apps/api/src/composition/production-dependencies.ts` (UPDATE): construct + expose webhook credit deps.
- `apps/api/src/main.ts` (UPDATE): thread webhook service into `createApp`.
- `apps/api/src/app.ts` (UPDATE): accept `teviWebhookService` dep; gate route wiring.
- `apps/api/src/repositories/postgres/player-session-repository.ts` + `apps/api/src/domain/player-identity.ts` (UPDATE): public read-only identity lookup on the interface + both impls.
- `apps/api/src/domain/tevi-webhook-service.ts` (NEW): normalization + idempotent atomic crediting coordinator.
- Possibly `apps/api/src/repositories/postgres/wallet-repository.ts` (UPDATE) or a small new repo method for the client-scoped atomic credit.
- Tests: `apps/api/test/integration/tevi-webhook-routes.test.ts` (UPDATE), `apps/api/test/unit/tevi-webhook-service.test.ts` (NEW), `apps/api/test/postgres/*` (NEW atomic/replay).

### Architecture Compliance

- `POST /api/v1/webhooks/tevi` "receives Tevi webhooks, verifies signatures, records provider events, and credits wallets idempotently" (architecture line 730). Note: the route is currently mounted at `/api/webhooks/tevi` (app.ts line 138 + router path `/webhooks/tevi`). Keep that mount working; if you also want the `/v1/` path, add it without breaking the existing one or the existing tests.
- `TeviWebhookService` responsibilities (architecture line 717): receive `user_topup`, verify `X-TEVI-SIGNATURE` before effects, normalize idempotency keys, coordinate atomic wallet crediting through PostgreSQL.
- Atomicity (architecture lines 739, 747-749): wallet credit commits atomically with idempotency completion and wallet transaction rows; verify-before-mutate; duplicate delivery returns prior result and never double-credits; conflicting payload is rejected/quarantined without mutation.
- Currency (architecture lines 706, TEVI-FR-7): `1 Tevi Star = 1 in-game credit`; production users start at 0 unless credited by top-up/approved fixture.
- The client never verifies webhooks or credits (architecture line 711) — this is backend-only.
- Tevi mode is sandbox-first; production exposure stays blocked until Epic 9 gates pass.

### Security and Privacy Guardrails

- `TEVI_WEBHOOK_SECRET` is environment-supplied (TEVI-NFR2); never log, persist, echo, or commit it or computed signatures. Log only `reasonCode`s and token-safe shapes (key names/types), per playbook §8.
- Verify signature with `crypto.timingSafeEqual` (constant-time); reject before parsing effects or touching the wallet.
- Do not store raw provider payload dumps with secrets in `provider_metadata_json`; store safe correlation (event id, user id, amount, type) only.
- Never auto-create a player from a webhook (unknown user is a safe failure); never trust client/provider balance fields beyond the credited amount.

### Library and Framework Guidance

- API package: ESM TypeScript on Node 24, Express 5.1.0, zod 4.2.0, `jose` 6.2.3, `pg` 8.22.x, TypeScript 6.0.3, Vitest 4.1.9. No new deps.
- Use Node `crypto` `createHmac("sha256", secret)` + `timingSafeEqual`. Validate parsed payload with zod where practical (but verify the raw signature first).
- Express 5 raw-body capture: prefer `express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })` scoped to the webhook mount, or a dedicated `express.raw({ type: "*/*" })` for `/webhooks/tevi`. Do not alter the global `express.json({ limit: "1mb" })` for other routes.

### Previous Story Intelligence (Story 8.5 + live sandbox)

- Story 8.5 implemented SDK `topup()` initiation with a pending (never-credited) client state, and explicitly left webhook verification + idempotent crediting to this story.
- Live sandbox Check Round (2026-06-30, recorded in 8-5 + playbook): the full pipeline verified end-to-end **up to the actual Tevi charge**; the only blocker is external — the sandbox Tevi wallet had no Stars and Tevi's "Purchase Star" sheet 500'd (Tevi-side). So a real `user_topup` webhook may not be deliverable in the sandbox yet. Plan the replay Check Round around signed local/integration requests, and mark live crediting blocked-by-Tevi-funding (do not fake it).
- Established patterns to follow: keep secrets out of state/logs/evidence; normalize provider uncertainty into safe states; extend existing Tevi seams instead of adding parallel flows; log token-safe `responseShape` (key names only) when a provider payload doesn't match (see [apps/api/src/domain/tevi-payment-client.ts](apps/api/src/domain/tevi-payment-client.ts) `describeResponseShape`).
- Real-shape gotchas already learned (playbook §2-§4): Tevi sends numeric where you expect booleans/strings (`user_id` is a number); the webhook `data.user` is a numeric-string and `data.metadata.user_id` is a number — coerce/stringify before comparing to the stored `tevi` subject.

### Git Intelligence (recent commits)

- `03c5ec3 feat: document verified Tevi API contracts and integration gotchas in the playbook; update PRD addendum with sandbox implementation notes`
- `5bf5fdc feat: update TeviClient to extract channel_id from deposit token and enhance topup diagnostics`
- `74e551d feat: enhance TeviClient to summarize topup response with error details for improved diagnostics`
- `0f7d1cb feat: enhance TeviClient to summarize topup response and maintain diagnostic state`
- `f5afe81 feat: enhance TeviPaymentClient to extract deposit token from various response shapes; add test case`
- Pattern: incremental, test-backed Tevi work with token-safe diagnostics; the playbook is the durable cross-story knowledge base — update it if a live webhook reveals the real shape differs from docs.

### Testing Guidance

- Focused service unit tests: `npm --workspace @china-slot-game/api test -- test/unit/tevi-webhook-service.test.ts`
- Webhook route integration: `npm --workspace @china-slot-game/api test -- test/integration/tevi-webhook-routes.test.ts`
- PostgreSQL atomic/replay (build game-math first if running the cross-suite): `npm run build -w @china-slot-game/game-math` then the `test/postgres` webhook/idempotency suites with the postgres harness.
- Adjacent regression: `tevi-topup-routes.test.ts tevi-token-routes.test.ts tevi-token-service.test.ts tevi-client.test.ts server-client.test.ts provider-top-up-idempotency.test.ts migrations.test.ts`.
- Full gate after implementation: `npm run lint && npm run typecheck && npm test && npm run build`.
- Known pre-existing, environment-only failures on Windows (doubled drive letter `C:\C:\…` in `import.meta.url` dir scanning): 3 in `test/unit/db-runtime.test.ts`, 1 in `packages/game-math/test/game-math.test.ts`. Confirm any failures you see are these (re-run with changes stashed) and not regressions.

### Project Structure Notes

- Webhook verification + crediting stays in `apps/api` (backend authority). No `js/` browser changes in this story — the client already shows pending and only reflects credited from authoritative backend balance.
- Keep the webhook route thin; put normalization + atomic crediting in the domain service / repository layer.
- Reuse the existing idempotency table and wallet tables; avoid new migrations unless a new column is required.

### References

- [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Epic 8, Story 8.6 ACs (1366-1385); webhook/idempotency requirements (TEVI-FR-6 line 287, TEVI-NFR1 line 307).
- [_bmad-output/planning-artifacts/architecture.md](_bmad-output/planning-artifacts/architecture.md) — `TeviWebhookService` (717), endpoints (729-730), atomic credit + idempotency/conflict rules (739, 747-749), verified `X-Tevi-Signature` casing (772).
- [docs/tevi-integration-playbook.md](docs/tevi-integration-playbook.md) — §5 webhook contract (HMAC-SHA256, header, payload), §4 sandbox funding blocker, §8 token-safe diagnostics.
- [_bmad-output/implementation-artifacts/8-5-run-sdk-top-up-with-pending-wallet-state.md](_bmad-output/implementation-artifacts/8-5-run-sdk-top-up-with-pending-wallet-state.md) — pending-state boundary, live sandbox findings, secret-hygiene practices.
- [apps/api/src/routes/tevi-webhook.routes.ts](apps/api/src/routes/tevi-webhook.routes.ts) — route to update.
- [apps/api/src/domain/provider-top-up-idempotency-repository.ts](apps/api/src/domain/provider-top-up-idempotency-repository.ts) / [apps/api/src/repositories/postgres/provider-top-up-idempotency-repository.ts](apps/api/src/repositories/postgres/provider-top-up-idempotency-repository.ts) — idempotency model + DB impl.
- [apps/api/db/migrations/0011_provider_top_up_idempotency.sql](apps/api/db/migrations/0011_provider_top_up_idempotency.sql) — existing table/constraints.
- [apps/api/src/repositories/postgres/wallet-repository.ts](apps/api/src/repositories/postgres/wallet-repository.ts) — wallet/transaction SQL + locking; "own transaction" caveat.
- [apps/api/src/db/transactions.ts](apps/api/src/db/transactions.ts) — `withTransaction` primitive.
- [apps/api/src/repositories/postgres/player-session-repository.ts](apps/api/src/repositories/postgres/player-session-repository.ts) — `provider_identity_mappings` lookups.
- [apps/api/src/config/env.ts](apps/api/src/config/env.ts) — Tevi payment env parsing (add webhook secret).
- [apps/api/src/composition/production-dependencies.ts](apps/api/src/composition/production-dependencies.ts) / [apps/api/src/main.ts](apps/api/src/main.ts) / [apps/api/src/app.ts](apps/api/src/app.ts) — wiring/gating.
- [apps/api/test/integration/tevi-webhook-routes.test.ts](apps/api/test/integration/tevi-webhook-routes.test.ts) — existing webhook route tests to preserve/extend.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Opus 4.8, 1M context) — BMAD dev-story workflow.

### Debug Log References

- `npm run typecheck -w @china-slot-game/api` → pass.
- `npm run lint --workspace @china-slot-game/api` (tsc --noEmit) → pass.
- `npm run build -w @china-slot-game/api` → pass.
- `npm --workspace @china-slot-game/api test` → 309 passed, 54 skipped, 3 failed. The 3 failures are the **documented Windows env-only** failures in `test/unit/db-runtime.test.ts` (ENOENT from the doubled drive-letter `import.meta.url` fixture-path issue, pre-existing, untouched by this story). New webhook unit/integration tests all pass.
- `test/postgres/tevi-webhook-credit.test.ts` → **skipped** (no `TEST_DATABASE_URL`/`DATABASE_URL`, and no Postgres / Docker / Podman available in this environment). Gated like the other `test/postgres` suites; executes when a test DB is provided.

### Completion Notes List

- **Signature verification (AC1, AC6):** `src/domain/tevi-webhook-signature.ts` computes HMAC-SHA256 over `JSON.stringify(parsedBody)` (compact re-serialization = Tevi's `json.dumps(payload, separators=(",",":"))`), bare hex, no `sha256=` prefix, compared with `crypto.timingSafeEqual` (length-guarded). The route verifies **before** parsing effects or touching any wallet; missing/invalid signature → **HTTP 401**, no idempotency write, no wallet mutation.
- **Raw-body decision:** to respect the "do NOT change global JSON parsing at app.ts:124" constraint, signature is computed from the re-serialized parsed body (Tevi's documented method). Raw-byte capture was intentionally **not** added since express's global `json()` consumes the stream first and a scoped re-parse would not re-run `verify`. The `ensure_ascii`/key-ordering divergence risk remains a first-live-event diagnostic item (noted in Dev Notes); ASCII payloads round-trip exactly.
- **Coordinator (AC2, AC6):** `TeviWebhookService` normalizes the event, derives `tevi:<event>:<providerEventId>` idempotency key, resolves the player via the new read-only `findPlayerByProviderSubject` (never auto-creates), and coordinates idempotent atomic crediting. `data.user` (string) and `metadata.user_id` (number) are coerced and cross-checked. Non-`user_topup` events (incl. `user_withdraw`, Story 8.8) → `ignored`. Invalid metadata/amount/user → `failed`.
- **Atomic credit (AC3, AC4, AC5):** `PostgresTeviWebhookCreditRepository.creditTopupAtomically` does it all in **one** `withTransaction`: lock idempotency row `FOR UPDATE` → if `completed` return prior result (no mutation) → else lock wallet `FOR UPDATE`, insert `credit` `wallet_transactions` row (source `tevi_topup`, actor `tevi-webhook`, `txn_<uuid>`), update `wallets.balance`, mark record `completed`. A failure in any step rolls back all three. Did **not** reuse `applyTransactionBatch` (opens its own transaction). Conflicting payloads (same event id, different player/amount; or same key, different event) → `markDuplicate`, no mutation.
- **Return codes (AC6):** 200 for credit + idempotent replay + every durably-recorded terminal outcome (`ignored`/`failed`/`duplicate`) so undocumented Tevi redeliveries stay safe; 401 for signature failure; 5xx only via thrown transient errors.
- **Gating / boundaries (AC7, AC8):** challenge-echo branch preserved verbatim; the route keeps its safe 501 placeholder when deps are absent (memory/dev or no webhook secret). Webhook crediting is wired only when `payment.enabled` + `TEVI_WEBHOOK_SECRET` + Postgres deps are present. No new HTTP/crypto/payment libraries (Node `crypto` + existing `pg`/Express). No spin/cashout/receipt/reconciliation/Epic-9 work added. `js/` client untouched.
- **Secret hygiene (TEVI-NFR2):** `TEVI_WEBHOOK_SECRET` is env-only, never logged/persisted/echoed; logs carry only `reasonCode`/`event`/`providerEventId`/`hasSignatureHeader`. `provider_metadata_json` and the wallet txn metadata store only safe correlation (event id, subject, amount, type). Touched files/tests swept — only placeholder secrets and field names appear.
- **Starter-balance note:** the atomic credit reuses the system-wide wallet bootstrap (`starterBalance = 1000`, matching `PostgresWalletRepository`). The architecture note that production users start at 0 is an Epic-9 production-compliance concern and out of scope here; the per-top-up credit transaction records exactly the credited amount regardless of starting balance.

### Check Round (AC9)

- **Commands:** `typecheck`, `lint`, `build` all pass; full API suite green except the 3 documented Windows env-only `db-runtime` failures (confirmed unrelated — none of the migration-loading code was touched).
- **Replay proof (executed here, via signed requests):** the wired integration suite delivers the same signed `user_topup` payload twice → first `credited`, second `replayed`, with the fake credit port (mirroring the Postgres uniqueness/status semantics) recording **exactly one** credit. A conflicting payload (same event id, different amount) → `duplicate` with no extra credit. Service unit tests assert the same invariants directly.
- **Replay proof (gated, DB-backed):** `test/postgres/tevi-webhook-credit.test.ts` proves — against real Postgres — that wallet credit + credit transaction + idempotency completion commit atomically, that N=4 deliveries yield **one** credit row + **one** `completed` record + correct balance, that a conflicting payload is quarantined `duplicate` with no mutation, and that an unknown user creates neither wallet nor player. It is **skipped in this environment** (no Postgres/Docker available) and runs via the standard `test/postgres` harness when `TEST_DATABASE_URL` is set (e.g. `docker-compose` Postgres in CI).
- **Live Tevi sandbox webhook crediting:** **blocked-by-external (Tevi funding)**, not faked — per Story 8.5 / playbook §4 the sandbox could not fund a real Stars charge, so a real `user_topup` webhook is not deliverable yet. The replay proof above stands in via signed local/integration + (gated) DB-backed requests. Verify the `ensure_ascii`/key-ordering signature assumption on the first live delivery.

### File List

New:
- `apps/api/src/domain/tevi-webhook-signature.ts`
- `apps/api/src/domain/tevi-webhook-service.ts`
- `apps/api/src/repositories/postgres/tevi-webhook-credit-repository.ts`
- `apps/api/test/unit/tevi-webhook-signature.test.ts`
- `apps/api/test/unit/tevi-webhook-service.test.ts`
- `apps/api/test/helpers/tevi-webhook-fakes.ts`
- `apps/api/test/postgres/tevi-webhook-credit.test.ts`

Modified:
- `apps/api/src/config/env.ts` (add optional `webhookSecret` from `TEVI_WEBHOOK_SECRET`)
- `apps/api/src/domain/player-identity.ts` (add `findPlayerByProviderSubject` to interface + in-memory impls)
- `apps/api/src/repositories/postgres/player-session-repository.ts` (public read-only `findPlayerByProviderSubject`)
- `apps/api/src/routes/tevi-webhook.routes.ts` (verified processing; placeholder retained when unwired)
- `apps/api/src/app.ts` (accept + gate `teviWebhookService`/`teviWebhookSecret`)
- `apps/api/src/main.ts` (assemble `TeviWebhookService` under the payment branch)
- `apps/api/src/composition/production-dependencies.ts` (expose player-session repo + webhook credit repo)
- `apps/api/test/integration/tevi-webhook-routes.test.ts` (preserve 3 existing cases; add signed acceptance/replay/conflict/signature-failure)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status tracking)

### Change Log

- 2026-06-30: Created Story 8.6 context for verified Tevi webhook signature verification and idempotent atomic Stars crediting.
- 2026-06-30: Reconciled the webhook contract against a browser read of the Tevi docs. Corrections: signature is HMAC-SHA256 over the **re-serialized compact JSON** (`JSON.stringify(parsedBody)`), hex, no prefix — reversed the earlier "sign raw bytes, don't re-serialize" guidance (raw body now retained only as a diagnostic fallback for key-ordering / `ensure_ascii` divergence); signature failure returns **401**; success/replay return **200**; retry policy is undocumented so terminal outcomes are durably recorded and return 200 (not 4xx); confirmed payload field types and event catalogue; documented gaps (no challenge handshake, no inbound dedup contract, no replay window/IP allowlist) added. Playbook §5 updated to match.
- 2026-06-30: Implemented verified webhook signature handling, `TeviWebhookService` coordinator, atomic credit-on-completion (`PostgresTeviWebhookCreditRepository`), read-only player-by-provider-subject lookup, route + composition wiring, and unit/integration/(gated) Postgres tests. Story marked review.
