---
baseline_commit: 77c8c2d
---

# Story 8.5: Run SDK Top-Up With Pending Wallet State

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to top up Stars through the Tevi sandbox SDK,
so that I can initiate a funded wallet flow while the game waits for authoritative webhook crediting.

## Acceptance Criteria

1. Given Tevi sandbox mode, an authenticated player, and a backend-issued `deposit_token`, when the player selects a valid Star top-up amount, then `js/teviClient.js` calls `window.TeviJS.topup({ amount, deposit_token, channel_id, metadata }, cb)`.
2. A successful SDK callback changes the top-up to pending, not credited.
3. Credited, failed, canceled, and retry states are visible and recoverable in the client.
4. Missing `deposit_token` surfaces the Tevi `403` failure in the verification flow.
5. The client does not mutate the authoritative wallet balance from SDK callback alone.
6. Local/demo mode remains unaffected by Tevi SDK top-up behavior.
7. The story ends with a manual sandbox-card Check Round covering SDK callback, pending UI state, failure state, and webhook follow-through.

## Tasks / Subtasks

- [ ] Extend the Tevi browser SDK adapter for top-up execution (AC: 1, 2, 4, 5, 6)
  - [ ] Add a method on `js/teviClient.js` such as `topup(options)` or `runTopup(options)` that wraps `window.TeviJS.topup()` only when explicit Tevi mode and SDK method availability are present.
  - [ ] Call the SDK with exactly the backend-issued `deposit_token`, integer `amount`, configured `channel_id`, and safe metadata. Metadata may include safe correlation such as request ID or local top-up attempt ID; it must not include bearer tokens, API keys, secret keys, full deposit-token copies outside the required SDK field, refresh tokens, Tevi emails, or provider payload dumps.
  - [ ] Normalize SDK outcomes into safe client states: `sdk-confirmation-open` if needed, `webhook-pending` on success, `canceled` on Tevi/user cancellation, `failed` for provider/SDK errors, `retryable-failure` for timeout or unavailable SDK where retry is safe.
  - [ ] Add timeout handling so a missing SDK callback becomes a recoverable failure state, following the existing `getUserAppToken()` timeout pattern.
  - [ ] Preserve local/demo behavior: if Tevi mode is disabled, no SDK script or top-up call is attempted and local visual play stays unchanged.
- [ ] Add top-up signature request support to the browser backend client (AC: 1, 3, 4, 5)
  - [ ] Extend `js/serverClient.js` with a focused method such as `requestTopupSignature(amount)` that uses the existing API base URL, request ID generation, and `{ data, error, requestId }` envelope handling.
  - [ ] Send `POST /api/v1/payments/top-up-signature` with `{ amount }` only after Tevi authentication/session setup is available.
  - [ ] Include an authenticated Tevi bearer path consistent with the current Story 8.3 token/session flow. Do not fall back to guest identity or client-supplied player IDs for Tevi top-up.
  - [ ] Treat missing `data.deposit_token` as a safe failed state and do not call the SDK without it except in the explicit manual Check Round that proves Tevi returns/handles the missing-token `403` failure.
  - [ ] Do not store full `deposit_token` in localStorage, debug panels, logs, screenshots, tests, or Check Round evidence. Passing it directly to `window.TeviJS.topup()` is the only intended browser use.
- [ ] Add Deposit UI/client state integration without wallet crediting (AC: 2, 3, 5, 6)
  - [ ] Add or extend the in-game Deposit entry point using the UX spine: presets, custom integer Stars input, disabled CTA for invalid amount, `Preparing Tevi deposit.`, external SDK confirmation, `Waiting for Tevi confirmation.`, `Deposit canceled.`, safe failure, and retry affordance.
  - [ ] Use `Stars` language consistently in Tevi mode. Do not use coins/credits/cash copy for Tevi-backed wallet values.
  - [ ] Debounce the Deposit CTA so duplicate taps do not create concurrent signature requests or SDK calls.
  - [ ] On SDK success, show a pending top-up state and reference/correlation ID when available. Do not update `PlayerCoin`, HUD balance, server balance cache, wallet transaction state, or spin eligibility from SDK success alone.
  - [ ] If a later balance refresh endpoint or placeholder credited-state detection already exists, show credited only after authoritative backend state says the wallet has been credited. If it does not exist yet, document webhook follow-through as manual/blocked until Story 8.6 implements crediting.
  - [ ] Keep pending state recoverable after modal close where practical, at minimum in local client state for the current page session. Do not persist secrets to recover it.
- [ ] Preserve story boundaries and fail-safe behavior (AC: 2, 5, 6)
  - [ ] Do not implement `POST /api/v1/webhooks/tevi` crediting, webhook signature verification, wallet mutation, cashout, receipts, spin math, or provider reconciliation in this story.
  - [ ] Do not treat `res.call === "ok"`, any SDK callback, or any browser-side provider result as proof of wallet credit.
  - [ ] Do not introduce new payment/provider libraries for browser top-up. Use the existing Tevi SDK adapter and the existing backend route from Story 8.4.
  - [ ] Ensure backend-unavailable and re-auth-required states block value-bearing top-up instead of silently using local/demo money.
- [ ] Add focused automated tests (AC: 1-6)
  - [ ] Extend `apps/api/test/unit/tevi-client.test.ts` for SDK `topup()` success, cancellation, missing method, SDK unavailable, timeout, thrown SDK error, no secret/token leakage in state/debug output, and Tevi-mode-only behavior.
  - [ ] Extend `apps/api/test/unit/server-client.test.ts` for top-up signature request envelope parsing, request ID propagation, authenticated Tevi path, missing `deposit_token`, backend error mapping, no guest fallback in Tevi top-up, and no balance mutation on SDK success.
  - [ ] Add or extend browser/client UI tests at the nearest existing test seam for Deposit modal state if a testable seam exists. Cover valid/invalid amount, submit debounce, pending state, canceled state, retryable failure, and no local/demo behavior regression.
  - [ ] Keep adjacent Tevi/backend route tests green: `apps/api/test/integration/tevi-topup-routes.test.ts`, `apps/api/test/integration/tevi-token-routes.test.ts`, `apps/api/test/unit/tevi-token-service.test.ts`, `apps/api/test/unit/tevi-client.test.ts`, and `apps/api/test/unit/server-client.test.ts`.
- [ ] Complete Story 8.5 Check Round (AC: 4, 7)
  - [ ] Record focused test commands, full validation command, and any manual sandbox prerequisites.
  - [ ] Record manual Mini App sandbox flow with placeholder/safe evidence only: amount selection, backend token request, SDK confirmation using sandbox card `4242 4242 4242 4242`, expiry `12/30`, CVV `123`, SDK callback shape/status, and pending UI state.
  - [ ] Record cancellation, SDK failure/timeout, backend missing/invalid token, and explicit missing-`deposit_token` `403` verification behavior.
  - [ ] Record webhook follow-through expectation: pending remains pending until Story 8.6 or a sandbox webhook credit path confirms authoritative credit. If webhook crediting is not implemented yet, mark credited-state evidence as blocked by Story 8.6 rather than faking it.
  - [ ] Search touched code, tests, screenshots/evidence notes, and logs for full deposit tokens, bearer/access/refresh/runtime tokens, `Authorization` header values, API keys, secret keys, webhook signatures, Tevi emails, and provider payload dumps. Confirm only placeholders, field names, or safe fingerprints/correlation IDs appear.

## Dev Notes

### Requirements Context

- Story source: `_bmad-output/planning-artifacts/epics.md` Story 8.5.
- Primary requirements: TEVI-FR-5, TEVI-FR-7, TEVI-NFR1, TEVI-NFR2, TEVI-NFR3, UX-DR8, UX-DR9, UX-DR10.
- Tevi top-up flow from the PRD addendum: Mini App requests backend `POST /api/v1/payments/top-up-signature` with `{ amount }`; backend returns `{ deposit_token }`; client calls SDK `topup({ amount, deposit_token, channel_id })`; Tevi displays confirmation; confirmation fires `user_topup` webhook; wallet credit happens only after webhook handling.
- Locked currency rule: `1 Tevi Star = 1 in-game credit`; Tevi mode labels balance, bet, win, jackpot, free-spin totals, top-up states, and receipts as Stars.
- Top-up states from UX: empty amount, preset selected, custom valid amount, invalid amount, deposit limit blocked, signature pending, SDK confirmation open, SDK canceled, webhook pending, credited, retryable failure, terminal failure.
- This story is sandbox-first SDK initiation and client pending-state work. Story 8.6 owns webhook verification and idempotent wallet crediting.

### Existing Code to Reuse and Preserve

- `js/teviClient.js` already resolves Tevi runtime config, loads `https://static.tevicdn.com/helper_tevi.js` only in explicit Tevi mode, detects `window.TeviJS`, exposes Mini App helpers, and wraps `getUserInfo()` with timeout/cancel/missing-token normalization. Extend this adapter; do not create a second browser SDK wrapper.
- `js/serverClient.js` already owns API base URL resolution, request ID generation, `{ data, error, requestId }` parsing, production/demo mode separation, Tevi token exchange via `POST /api/tevi/token`, and backend spin retry state. Extend this client for top-up signature requests instead of making ad hoc fetch calls from UI code.
- `apps/api/src/routes/tevi-topup.routes.ts` already exposes authenticated `POST /api/v1/payments/top-up-signature`, validates positive integer amount, uses existing Tevi auth middleware, creates/resumes a session, calls `TopupService`, and returns `{ data: { deposit_token }, error: null, requestId }` on success.
- `apps/api/src/domain/topup-service.ts` already validates integer Star amount and configured limits, rejects duplicate request IDs, fingerprints deposit tokens, stores safe issuance metadata, and never mutates wallets.
- `apps/api/test/unit/tevi-client.test.ts` uses Node `vm` to load `js/runtime-config.js` and `js/teviClient.js`; follow that pattern for SDK top-up adapter tests.
- `apps/api/test/unit/server-client.test.ts` uses Node `vm` to load `js/serverClient.js`; follow that pattern for top-up signature client tests and for proving Tevi top-up does not create guest-session fallback behavior.
- `index.html` already loads `js/runtime-config.js`, then `js/teviClient.js`, then `js/slotGame.js`. Preserve this order.

### Current State of Files Likely to Be Modified

- `js/teviClient.js`: add SDK `topup()` wrapper, top-up result normalization, timeout/cancellation handling, and possibly safe status helpers.
- `js/serverClient.js`: add authenticated top-up signature request method and safe failure mapping. If bearer-token handling is not available outside the current token exchange flow, add the narrowest in-memory token/session capability needed for this story without exposing secrets.
- `js/slotGame.js` and/or `js/slot_classes.js`: likely Deposit entry point, modal state, pending/retry display, Stars labels, and HUD/wallet state integration if no existing modal seam is sufficient.
- `js/runtime-config.js`: only update if Tevi top-up needs additional non-secret public config such as preset/min/max display values. Do not place provider credentials or tokens here.
- `apps/api/test/unit/tevi-client.test.ts`: extend adapter tests.
- `apps/api/test/unit/server-client.test.ts`: extend browser API client tests.
- Add focused UI tests only at an existing practical seam; avoid creating a broad browser test harness unless necessary to verify the changed client state.

### Architecture Compliance

- Client responsibilities: capture deposit amount intent, request a backend-issued token, invoke Tevi SDK confirmation, display pending/failure/retry states, and refresh/display authoritative backend state when available.
- Backend responsibilities already in place from Story 8.4: Tevi auth, amount validation, deposit-token issuance, safe issuance persistence, and envelope responses.
- Backend responsibilities not in this story: webhook verification, idempotent wallet crediting, wallet ledger writes, cashout, receipt sending, reconciliation, and production compliance gates.
- The client must never sign deposit tokens, verify webhooks, compute payouts, mutate production balances, or treat SDK top-up success as wallet credit before webhook processing commits.
- Tevi mode remains sandbox-first. Production Tevi exposure remains blocked until Epic 9 gates pass.
- Local/demo mode remains for visual development only and must not silently mimic Tevi deposits or grant production Stars.

### Security and Privacy Guardrails

- Never log, persist, display, screenshot, or commit full `deposit_token`, API keys, secret keys, Authorization header values, bearer/access/refresh/runtime tokens, webhook secrets, webhook signatures, provider response bodies, or Tevi email addresses.
- The SDK call necessarily receives `deposit_token`; keep that token in memory only for the call and do not include it in debug state, pending state, localStorage, modal copy, analytics, test snapshots, or Check Round notes.
- Browser metadata may include safe IDs such as `requestId`, a local attempt ID, app/channel IDs, and type `deposit`, but must not include secrets or raw provider payloads.
- Missing, invalid, expired, or unavailable Tevi auth must block top-up and produce a recoverable re-auth state; do not issue guest top-up requests.
- Duplicate CTA taps must not create duplicate top-up signature requests or SDK calls.

### Library and Framework Guidance

- Browser code in `js/` is plain JavaScript using IIFEs and globals. Keep that style; do not introduce bundling or a framework for this story.
- API/package tests use Vitest 4.1.9 and Node VM loading for browser scripts.
- API package is ESM TypeScript on Node 24, Express 5.1.0, zod 4.2.0, `jose` 6.2.3, pg 8.22.x, TypeScript 6.0.3, and Vitest 4.1.9.
- The fetched Tevi helper script identifies version `1.1.0` and maps `topup` to action `action.user.billy.topup`; wrapper behavior should use `window.TeviJS.topup(options, callback)` and tolerate callback response variants safely.
- Do not add `axios`, `jsonwebtoken`, new payment SDKs, or browser storage libraries.

### Previous Story Intelligence

- Story 8.4 implemented backend-only top-up signature issuance and explicitly left SDK `topup()`, webhook wallet crediting, cashout, receipts, spin math, and wallet mutation for later stories.
- Story 8.4 final validation passed with `npm run lint && npm run typecheck && npm test && npm run build`.
- Story 8.4 review added fail-closed duplicate request handling in `TopupService`; client code should still debounce duplicate submissions so it does not rely only on backend rejection.
- Recent commits relevant to this story:
  - `77c8c2d test: update migration tests to include all applied migration versions`
  - `e88345d feat: implement Tevi payment client and top-up service`
  - `ca84839 feat(tevi): enhance token response handling with envelope parsing and sandbox compatibility`
  - `6ec49e5 feat: implement Tevi token service and routes for token exchange and refresh`
  - `d3de38c feat(tevi): finalize Story 8.2 with user authentication improvements and QA results`
- Established pattern: keep secrets out of debug state and story evidence, normalize provider/SDK uncertainty into recoverable states, and extend the existing Tevi auth/token/client seams rather than adding parallel flows.

### Testing Guidance

- Focused browser adapter tests:
  - `npm --workspace @china-slot-game/api test -- test/unit/tevi-client.test.ts`
- Focused browser backend client tests:
  - `npm --workspace @china-slot-game/api test -- test/unit/server-client.test.ts`
- Adjacent Tevi/backend regression tests:
  - `npm --workspace @china-slot-game/api test -- test/integration/tevi-topup-routes.test.ts test/integration/tevi-token-routes.test.ts test/unit/tevi-token-service.test.ts test/unit/tevi-client.test.ts test/unit/server-client.test.ts`
- Syntax check for touched browser files when changed:
  - `node --check js/teviClient.js`
  - `node --check js/serverClient.js`
  - `node --check js/slotGame.js` if touched
  - `node --check js/slot_classes.js` if touched
- Full story gate after implementation:
  - `npm run lint && npm run typecheck && npm test && npm run build`

### Check Round Evidence To Record

- Manual Mini App sandbox setup: Tevi mode enabled, SDK loaded, app ID/channel ID visible only as non-secret config, authenticated player, and backend top-up signature route reachable.
- Successful flow: select a valid amount, observe `Preparing Tevi deposit.`, receive a backend token without exposing it, invoke Tevi SDK confirmation, use sandbox card `4242 4242 4242 4242` / `12/30` / `123`, receive an SDK success callback, and show `Waiting for Tevi confirmation.` without changing authoritative wallet balance.
- Failure flow: user cancellation returns `Deposit canceled.` and leaves wallet unchanged.
- Failure flow: SDK unavailable/missing method/timeout/backend failure shows retryable or terminal safe state, with no local/demo money fallback.
- Missing-token flow: deliberately omit `deposit_token` only in a controlled manual verification path and record that Tevi returns or surfaces the expected `403` failure. Do not ship normal code that calls top-up without a token.
- Webhook follow-through: if Story 8.6 is not yet implemented, record that pending cannot become credited from this story alone. If sandbox webhook crediting exists by implementation time, show credited only from authoritative backend balance/ledger state.
- Evidence hygiene: use placeholders such as `<DEPOSIT_TOKEN>`, `<TEVI_ACCESS_TOKEN>`, and `<REQUEST_ID>`; never paste real tokens, secrets, signatures, provider payloads, or Tevi emails.

### Project Structure Notes

- Keep Tevi browser SDK calls in `js/teviClient.js`.
- Keep game-owned API calls in `js/serverClient.js`.
- Keep UI/game state integration in existing Phaser/browser files (`js/slotGame.js`, `js/slot_classes.js`) using the current style and lifecycle.
- Keep backend top-up signature issuance in `apps/api`; do not duplicate signing or provider calls in `js/`.
- Keep PostgreSQL webhook/idempotent wallet crediting for Story 8.6.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 8 and Story 8.5 acceptance criteria.
- `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/tevi-integration-addendum.md` - Tevi top-up flow, FR-5, SDK method shape, Stars currency decisions, and sandbox card.
- `_bmad-output/planning-artifacts/architecture.md` - Tevi readiness boundary, client responsibilities, backend boundaries, transaction/retry rules, and production gates.
- `_bmad-output/planning-artifacts/ux-designs/ux-China Slot Game-2026-06-27/EXPERIENCE.md` - Deposit modal states, pending/canceled/credited/failure UX, local demo separation, and Check Round expectations.
- `_bmad-output/project-context.md` - static Phaser client structure and server-authoritative constraints.
- `_bmad-output/implementation-artifacts/8-4-issue-backend-top-up-signatures.md` - previous story implementation, guardrails, validation commands, and review finding.
- `js/teviClient.js` - existing Tevi SDK adapter to extend.
- `js/serverClient.js` - existing browser API client to extend.
- `apps/api/src/routes/tevi-topup.routes.ts` - existing top-up signature route contract.
- `apps/api/src/domain/topup-service.ts` - backend issuance service behavior and no-wallet-mutation boundary.
- `apps/api/test/unit/tevi-client.test.ts` - browser Tevi adapter test pattern.
- `apps/api/test/unit/server-client.test.ts` - browser server client test pattern.
- `https://static.tevicdn.com/helper_tevi.js` - Tevi helper script; observed version `1.1.0`, `topup(options, callback)` maps to `action.user.billy.topup`.

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List

### Change Log

- 2026-06-29: Created Story 8.5 context for SDK top-up pending wallet state.