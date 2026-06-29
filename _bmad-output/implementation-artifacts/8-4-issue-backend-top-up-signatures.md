---
baseline_commit: ca84839
---

# Story 8.4: Issue Backend Top-Up Signatures

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want the game server to issue a Tevi top-up deposit token for my requested Star amount,
so that SDK top-up can be initiated without trusting client-side signing or amount validation.

## Acceptance Criteria

1. Given an authenticated Tevi player context and an integer Star amount, when the client calls `POST /api/v1/payments/top-up-signature`, then the backend validates identity, amount, configured deposit limits, channel/app settings, and Tevi credential availability.
2. The backend signs or requests the deposit token using environment-supplied Tevi credentials only.
3. The response returns `{ deposit_token }` inside the existing `{ data, error, requestId }` API envelope.
4. Safe issuance metadata is recorded, including amount, internal player ID, request ID, deposit-token fingerprint, status, and timestamp.
5. Missing or invalid credentials, invalid amount, deposit-limit violation, or unauthorized user fails without wallet mutation.
6. Full secrets, signatures, deposit tokens, access tokens, and refresh tokens are never logged in full.
7. The story ends with a Check Round for curl success and failure cases, required headers, logs, and database metadata.

## Tasks / Subtasks

- [x] Add Tevi payment/top-up runtime configuration (AC: 1, 2, 5, 6)
  - [x] Extend `apps/api/src/config/env.ts` with the minimum top-up signature configuration: Tevi payment enablement if needed, Tevi API base reuse or payment base if implementation proves it differs, `TEVI_API_KEY`, `TEVI_SECRET_KEY` or documented Tevi-approved equivalent, `TEVI_BILLING_CHANNEL_ID`/channel setting if required by the deposit token, and configurable deposit min/max limits.
  - [x] Validate HTTPS provider base URLs and fail safe outside development/test when top-up signatures are enabled but required credentials, app/channel settings, PostgreSQL persistence, or schema readiness are missing.
  - [x] Keep Story 8.2/8.3 auth and token-exchange config intact; do not make Tevi token exchange depend on payment credentials unless Tevi docs require it.
  - [x] Add env tests for disabled mode, sandbox/default-safe behavior, invalid URLs, missing payment credentials, invalid deposit limits, and production/staging fail-safe behavior.
- [x] Implement a backend-only Tevi payment/deposit-token service (AC: 1, 2, 3, 5, 6)
  - [x] Add a narrow domain service such as `apps/api/src/domain/tevi-payment-client.ts` and/or `apps/api/src/domain/topup-service.ts`.
  - [x] The service must validate authenticated internal `playerId`, Tevi user subject, integer Star amount, configured min/max deposit limits, configured `TEVI_APP_ID`, and billing/channel settings before issuing a deposit token.
  - [x] Use Tevi-approved signing or provider request behavior from sandbox docs. If the exact deposit-token algorithm/API is not available, stop and record the blocker instead of inventing a custom JWT or HMAC scheme.
  - [x] Use Node 24 built-in `fetch` for provider calls if a provider endpoint is used; do not add an HTTP client dependency without a concrete compatibility reason.
  - [x] Validate provider responses with `zod`; expected game-owned output is only safe metadata plus `deposit_token` to the authenticated client.
  - [x] Redact or fingerprint deposit tokens, API keys, secret keys, signatures, bearer tokens, provider response bodies, and Authorization headers in diagnostics.
- [x] Add persistent top-up signature issuance metadata (AC: 4, 5, 7)
  - [x] Add a PostgreSQL migration under `apps/api/db/migrations/` for a top-up signature issuance record if existing `provider_top_up_idempotency_records` cannot represent issuance cleanly.
  - [x] Required persisted fields or equivalents: issuance ID, provider name `tevi`, internal `player_id`, Tevi user ID/subject, integer Star amount, request ID, deposit-token fingerprint, status (`issued`, `failed`, or equivalent), safe failure reason/status code, created timestamp, and safe provider/channel metadata.
  - [x] Do not store full `deposit_token`, full provider payloads, API keys, secret keys, access tokens, refresh tokens, or webhook signatures.
  - [x] Keep webhook idempotency semantics separate. Existing `ProviderTopUpIdempotencyRepository` is currently event/idempotency-key oriented for webhook/replay handling; only extend it for issuance if the model remains clear and tests prove no webhook behavior regresses.
  - [x] Add PostgreSQL repository tests for create/read, failed issuance metadata, token fingerprint storage, restart reconstruction, and absence of wallet transactions.
- [x] Add the top-up signature route behind Tevi authentication (AC: 1, 3, 5, 6)
  - [x] Add a route such as `apps/api/src/routes/tevi-topup.routes.ts` mounted at `POST /api/v1/payments/top-up-signature`.
  - [x] Protect it with `createTeviAuthMiddleware` and the existing `JoseTeviAuthVerifier`; never accept raw `{ provider: "tevi", subject }` identity or client-supplied player IDs.
  - [x] Validate request body with `zod`: `{ amount }` must be a safe positive integer Star amount. Reject zero, negative, decimal, stringly-numeric ambiguity if not intentionally supported, NaN, Infinity, and amounts outside configured deposit limits.
  - [x] Return success as `{ data: { deposit_token }, error: null, requestId }` and failures through existing `ApiHttpError`/envelope behavior with stable codes such as `INVALID_TOP_UP_AMOUNT`, `TEVI_TOP_UP_LIMIT_EXCEEDED`, `TEVI_PAYMENT_CONFIG_MISSING`, `TEVI_TOP_UP_SIGNATURE_FAILED`, or `TEVI_AUTH_REQUIRED`.
  - [x] Log only safe fields: request ID, internal player ID, Tevi subject, amount, issuance status, failure reason code, and deposit-token fingerprint.
- [x] Compose production dependencies safely (AC: 1, 2, 4, 5)
  - [x] Wire the payment/top-up services in `apps/api/src/main.ts` and `apps/api/src/app.ts` only when Tevi auth and payment config are enabled and required dependencies exist.
  - [x] In PostgreSQL/production Tevi mode, require migrations and the issuance repository before the route is usable; no in-memory production fallback for money-path issuance.
  - [x] Development/test may use injected fake services for focused route tests, but production/staging must fail closed on missing provider credentials, missing channel/app settings, missing schema, or missing persistence.
- [x] Add focused automated tests (AC: 1-7)
  - [x] Unit-test env parsing and top-up amount validation.
  - [x] Unit-test payment client/service success, provider 401/403, provider 429/5xx, invalid JSON, malformed response, missing `deposit_token`, network failure, safe redaction, and token fingerprinting.
  - [x] Integration-test `POST /api/v1/payments/top-up-signature` with injected fake verifier/service/repository: success envelope, missing bearer token, invalid token, invalid amount, limit exceeded, missing config/service unavailable, provider failure, no token leakage in response/log-facing metadata, and request ID propagation.
  - [x] PostgreSQL-test issuance metadata persistence and confirm no wallet transaction is written by this story.
  - [x] Keep Story 8.3 tests green: `apps/api/test/integration/tevi-token-routes.test.ts`, `apps/api/test/integration/tevi-auth-routes.test.ts`, `apps/api/test/unit/tevi-token-service.test.ts`, `apps/api/test/unit/server-client.test.ts`, and `apps/api/test/unit/tevi-client.test.ts`.
- [x] Complete the Story 8.4 Check Round (AC: 7)
  - [x] Record exact commands for focused tests, migrations/checks, lint, typecheck, and full validation.
  - [x] Record curl success with placeholder bearer token only and example request body `{ "amount": 100 }`.
  - [x] Record curl failures for missing auth, invalid amount, deposit-limit violation, missing credentials/config, and provider failure.
  - [x] Record expected response envelopes and request IDs.
  - [x] Record safe logs and SQL showing issuance metadata with deposit-token fingerprint only.
  - [x] Search touched code, tests, logs, and story evidence for JWT-like strings, `Authorization`, `Bearer`, `deposit_token`, API key/secret terms, access/refresh token fields, signatures, and email addresses; confirm only placeholders, field names, or safe fingerprints appear.
  - [x] Confirm no SDK `topup()`, webhook wallet crediting, cashout, receipts, spin math, or wallet mutation behavior was added.

### Review Findings

- [x] [Review][Patch] Add fail-closed duplicate request handling for top-up signature issuance [apps/api/src/domain/topup-service.ts] — Fixed by rejecting repeated `request_id` attempts with `TEVI_TOP_UP_DUPLICATE_REQUEST` before calling the Tevi provider.

## Dev Notes

### Requirements Context

- Story source: `_bmad-output/planning-artifacts/epics.md` Story 8.4.
- Primary requirements: TEVI-FR-4, TEVI-FR-7, TEVI-NFR2, TEVI-NFR3, TEVI-NFR5, TEVI-NFR6.
- Tevi top-up flow from PRD addendum: Mini App requests `POST /api/v1/payments/top-up-signature` with `{ amount }`; backend returns `{ deposit_token }`; later Story 8.5 client calls `window.TeviJS.topup({ amount, deposit_token, channel_id, metadata }, cb)`.
- `channel_id` / `billing_channel_id` are inside the deposit token JWT according to the PRD addendum. This story owns backend issuance only; it does not own SDK invocation or UI pending states.
- Tevi API key/secret credentials are approved/provider-supplied secrets. They must come from environment or approved secret storage only and must never be committed, logged in full, returned in API responses, or copied into Check Round evidence.
- Tevi Stars use integer units: `1 Tevi Star = 1 in-game credit`. All top-up amounts must be safe integers.
- Production Tevi exposure remains blocked until Epic 9. This story is sandbox-first top-up signature issuance, but production/staging code paths still fail closed when money-path dependencies are missing.

### Existing Code to Reuse and Preserve

- `apps/api/src/domain/tevi-auth-adapter.ts` verifies RS256/JWKS Tevi JWTs, validates `app_id`, active/anonymous policy, expiry, and maps safe identity context. Reuse this verifier through middleware; do not decode or trust tokens in the top-up route.
- `apps/api/src/middleware/tevi-auth.ts` extracts bearer tokens case-insensitively, logs safe reason codes with `requestId`, and attaches `request.teviAuth`. Use this for the top-up signature route.
- `apps/api/src/routes/tevi-token.routes.ts` shows the current route style: `zod` request validation, injected services for tests, `{ data, error, requestId }` envelopes, safe token handling, and session binding after token exchange.
- `apps/api/src/routes/tevi-session.routes.ts` exposes protected Tevi session routes behind the existing verifier. Preserve its behavior.
- `apps/api/src/config/env.ts` currently supports Tevi auth and token exchange config: `TEVI_AUTH_ENABLED`, `TEVI_APP_ID`, `TEVI_JWKS_URL`, `TEVI_ALLOW_ANONYMOUS_USERS`, `TEVI_TOKEN_EXCHANGE_ENABLED`, and `TEVI_API_BASE`. Extend it carefully; do not replace Story 8.2/8.3 behavior.
- `apps/api/src/app.ts` mounts Tevi token routes only when services are injected and Tevi session routes only when the auth verifier exists. Follow the same dependency-injection pattern for top-up routes.
- `apps/api/src/main.ts` composes production dependencies, `JoseTeviAuthVerifier`, and `TeviTokenService`. Add payment/top-up composition there without weakening PostgreSQL startup fail-safe behavior.
- `apps/api/src/domain/provider-top-up-idempotency-repository.ts` and `apps/api/src/repositories/postgres/provider-top-up-idempotency-repository.ts` persist future-ready provider top-up event/idempotency records. They may be relevant to later webhook crediting, but their current semantics are provider event and idempotency-key based, not issuance based.
- `apps/api/db/migrations/0011_provider_top_up_idempotency.sql` created the existing top-up idempotency table. Add a new migration if Story 8.4 needs a distinct issuance table.
- `apps/api/test/integration/tevi-token-routes.test.ts` is the closest route-test pattern for safe token responses, fake verifier/service injection, request IDs, and no token leakage.
- `apps/api/test/postgres/provider-top-up-idempotency.test.ts` is the closest PostgreSQL money-path persistence test pattern.

### Current State of Files Likely to Be Modified

- `apps/api/src/config/env.ts`: add top-up/payment credential, channel, and deposit-limit config plus validation.
- `apps/api/src/domain/tevi-payment-client.ts`: expected new backend-only Tevi provider client or signer.
- `apps/api/src/domain/topup-service.ts`: expected new service to validate amount/identity/config, call the payment client, fingerprint deposit tokens, and record issuance metadata.
- `apps/api/src/domain/topup-signature-issuance-repository.ts`: likely new interface if issuance records are distinct from webhook idempotency records.
- `apps/api/src/repositories/postgres/topup-signature-issuance-repository.ts`: likely new PostgreSQL repository if a distinct issuance table is added.
- `apps/api/db/migrations/0012_*topup*_issuance*.sql`: expected new migration if storing issuance metadata in a new table.
- `apps/api/src/routes/tevi-topup.routes.ts`: expected new route for `POST /api/v1/payments/top-up-signature`.
- `apps/api/src/app.ts`: mount the top-up route with injected verifier/service/repository dependencies.
- `apps/api/src/main.ts` and `apps/api/src/composition/production-dependencies.ts`: compose production top-up dependencies and persistence.
- `apps/api/test/unit/env.test.ts`: extend env coverage.
- `apps/api/test/unit/tevi-payment-client.test.ts` and/or `apps/api/test/unit/topup-service.test.ts`: expected new service tests.
- `apps/api/test/integration/tevi-topup-routes.test.ts`: expected new route tests.
- `apps/api/test/postgres/topup-signature-issuance.test.ts`: expected new persistence tests if a new table is added.

### Architecture Compliance

- Backend remains authoritative for Tevi authentication mapping, amount validation, deposit-token issuance, persistence/audit metadata, and safe error mapping.
- Client never signs deposit tokens, verifies webhooks, mutates production balances, treats SDK top-up success as wallet credit, or chooses provider identity/player IDs.
- Route responses must use the game-owned `{ data, error, requestId }` envelope.
- Stable errors use safe `code`, `message`, and optional redacted `details`; never include full provider response bodies, tokens, credentials, or signatures.
- Production/staging Tevi money-path behavior requires PostgreSQL persistence, applied migrations, schema readiness, Tevi auth, payment credentials, and channel/app configuration.
- Host float, production compliance, self-exclusion, and full deposit-limit policy hardening are Epic 9. Story 8.4 still needs a configured min/max deposit-limit check so it does not issue arbitrary sandbox deposit tokens.
- Top-up signature issuance must not create, debit, credit, or adjust wallets. Wallet crediting is Story 8.6 after verified webhook processing commits.

### Security and Privacy Guardrails

- Do not log or persist full `deposit_token`, API key, secret key, signature, bearer token, access token, refresh token, runtime token, Authorization header, provider response body, Tevi email, webhook secret, or webhook signature.
- Fingerprint deposit tokens with a one-way hash such as SHA-256 and store/log only a short or full hash fingerprint, never the token itself.
- Do not put tokens or provider credentials in URLs, query strings, screenshots, debug overlays, story evidence, curl examples, test snapshots, or seed fixtures.
- Do not hand-roll cryptographic signing unless Tevi provides the exact algorithm and required claims. If Tevi requires a JWT deposit token, use an established library already present if appropriate (`jose`) and validate allowed algorithm/claims from documentation before implementation.
- If Tevi sandbox docs contradict the PRD addendum on deposit-token issuance shape, record the discrepancy and update PRD/architecture before coding around it.

### Library and Framework Guidance

- API package is ESM TypeScript on Node 24, Express 5.1.0, zod 4.2.0, `jose` 6.2.3, pg 8.22.x, TypeScript 6.0.3, and Vitest 4.1.9.
- Use built-in Node 24 `fetch` for Tevi provider calls unless implementation finds a concrete blocker.
- Use `zod` for request and provider-response validation.
- Use `node:crypto` hashing for deposit-token fingerprints.
- Do not introduce `jsonwebtoken`, axios, request libraries, or custom crypto helpers unless Tevi documentation creates a concrete need that existing dependencies cannot satisfy.

### Previous Story Intelligence

- Story 8.3 implemented Tevi token exchange and refresh with `TeviTokenService`, `POST /api/tevi/token`, `POST /api/tevi/token/refresh`, backend-held refresh tokens, safe `{ data, error, requestId }` envelopes, token redaction, and client startup wiring.
- Story 8.3 final validation passed with `npm run lint && npm run typecheck && npm test && npm run build`.
- Story 8.3 review emphasized: no raw token logging, no unauthenticated session metadata, provider outage vs re-auth distinction, SDK callback timeout handling, and no top-up/webhook/cashout/wallet mutation ahead of scheduled stories.
- Recent commits show the auth/token path is fresh and should be extended rather than rewritten:
  - `ca84839 feat(tevi): enhance token response handling with envelope parsing and sandbox compatibility`
  - `6ec49e5 feat: implement Tevi token service and routes for token exchange and refresh`
  - `d3de38c feat(tevi): finalize Story 8.2 with user authentication improvements and QA results`
  - `8e290e5 feat: implement Tevi authentication adapter and middleware`
  - `5f69b4f feat(tevi): Finalize Story 8.1 and enhance Tevi webhook challenge validation`

### External Technical Notes

- The Tevi PRD addendum is the current source of truth for top-up signature behavior. Public Tevi docs were not reliably available in prior story creation; if sandbox/private docs are available during implementation, reconcile them against the PRD before coding irreversible assumptions.
- Known Tevi context from the PRD: sandbox API base `https://developer-api.sbx.tevi.dev`, production API base `https://developer-api.flowstreamx.com`, SDK script `https://static.tevicdn.com/helper_tevi.js`, SDK top-up method `window.TeviJS.topup({ amount, deposit_token, channel_id, metadata }, cb)`, and missing `deposit_token` returns Tevi `403`.
- Story 8.1 sandbox metadata included `TEVI_APP_ID=AZX29173`, Tevi channel ID `2300210851`, app URL `https://chinareel.pleagamehub.com/`, and webhook URL `https://china-slot-api.onrender.com/api/webhooks/tevi`. Treat this as sandbox metadata, not production secrets.

### Testing Guidance

- Focused env/unit tests:
  - `npm --workspace @china-slot-game/api test -- test/unit/env.test.ts test/unit/tevi-payment-client.test.ts test/unit/topup-service.test.ts`
- Focused route/auth tests:
  - `npm --workspace @china-slot-game/api test -- test/integration/tevi-topup-routes.test.ts test/integration/tevi-token-routes.test.ts test/integration/tevi-auth-routes.test.ts`
- Focused PostgreSQL tests when issuance persistence is added:
  - `npm --workspace @china-slot-game/api test -- test/postgres/topup-signature-issuance.test.ts test/postgres/provider-top-up-idempotency.test.ts`
- Adjacent client/auth regression tests to keep green:
  - `npm --workspace @china-slot-game/api test -- test/unit/tevi-client.test.ts test/unit/server-client.test.ts test/unit/tevi-token-service.test.ts`
- Full story gate after implementation:
  - `npm run lint && npm run typecheck && npm test && npm run build`

### Check Round Evidence To Record

- Curl success with placeholders only, for example:
  - `curl -i -X POST http://127.0.0.1:3000/api/v1/payments/top-up-signature -H 'content-type: application/json' -H 'authorization: Bearer <TEVI_ACCESS_TOKEN>' -H 'x-request-id: req_tevi_topup_signature_success' --data '{"amount":100}'`
- Expected success envelope: `201` or `200` with `data.deposit_token` present, `error=null`, and matching `requestId`. Do not paste a real deposit token into story evidence; replace with `<DEPOSIT_TOKEN>` and record only its fingerprint in logs/SQL evidence.
- Curl failures for missing auth, invalid bearer token, `{ "amount": 0 }`, decimal amount, amount above configured max, missing payment config, and provider failure.
- Safe logs showing request ID, player ID, Tevi subject, amount, status/reason code, and deposit-token fingerprint only.
- SQL evidence for issuance metadata rows, including amount, internal player ID, request ID, fingerprint, status, timestamp, and no full token or secret fields.
- Evidence that `wallet_transactions` remains unchanged by top-up signature issuance.
- Boundary evidence that this story did not implement SDK `topup()`, webhook wallet crediting, cashout, receipts, spin math changes, or wallet mutation.

### Project Structure Notes

- Keep backend payment/provider code under `apps/api/src/domain`, `apps/api/src/routes`, `apps/api/src/repositories/postgres`, and composition files.
- Keep migrations under `apps/api/db/migrations/` using the existing `0000_name.sql` style with `-- migrate:up` and `-- migrate:down` sections.
- Do not put payment credentials, provider signing, or deposit-token generation under `js/` browser files.
- No client UI work is required for Story 8.4 beyond possibly documenting or preparing route contracts. Story 8.5 owns SDK top-up and pending UI.
- Keep local/demo static Phaser play unaffected.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 8 and Story 8.4 acceptance criteria.
- `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/tevi-integration-addendum.md` - Tevi top-up flow, FR-4, non-functional requirements, endpoint inventory, data requirements, and Check Round policy.
- `_bmad-output/planning-artifacts/architecture.md` - Tevi readiness boundary, `TeviPaymentClient`, `TopupService`, top-up route, persistence, transaction/retry rules, and production fail-safe requirements.
- `_bmad-output/planning-artifacts/ux-designs/ux-China Slot Game-2026-06-27/EXPERIENCE.md` - deposit states, amount validation, pending behavior owned by later stories, and no local-money fallback.
- `_bmad-output/project-context.md` - current frontend/backend structure and server-authoritative constraints.
- `_bmad-output/implementation-artifacts/8-3-exchange-and-refresh-tevi-tokens.md` - previous story implementation, files changed, validation commands, and review findings.
- `apps/api/src/domain/tevi-auth-adapter.ts` - existing RS256/JWKS verifier.
- `apps/api/src/middleware/tevi-auth.ts` - existing safe bearer middleware.
- `apps/api/src/routes/tevi-token.routes.ts` - route/envelope/token-redaction pattern.
- `apps/api/src/domain/provider-top-up-idempotency-repository.ts` - existing webhook-oriented top-up idempotency repository interface.
- `apps/api/src/repositories/postgres/provider-top-up-idempotency-repository.ts` - PostgreSQL idempotency persistence pattern.
- `apps/api/test/integration/tevi-token-routes.test.ts` - focused Tevi route test pattern.
- `apps/api/test/postgres/provider-top-up-idempotency.test.ts` - PostgreSQL top-up idempotency test pattern.

## Dev Agent Record

### Agent Model Used

GitHub Copilot

### Debug Log References

- Red/green env config: `npm --workspace @china-slot-game/api test -- test/unit/env.test.ts` failed before payment env parsing existed, then passed after adding `teviAuth.payment` config.
- Red/green service: `npm --workspace @china-slot-game/api test -- test/unit/topup-service.test.ts` failed before `topup-service.ts` existed, then passed with validation, fingerprinting, and issuance metadata recording.
- Red/green provider client: `npm --workspace @china-slot-game/api test -- test/unit/tevi-payment-client.test.ts` failed before `tevi-payment-client.ts` existed, then passed with provider request, zod response validation, and safe status mapping.
- Red/green route: `npm --workspace @china-slot-game/api test -- test/integration/tevi-topup-routes.test.ts` failed with 404 before mounting the route, then passed with authenticated route behavior and failure envelopes.
- Typecheck repair: `npm --workspace @china-slot-game/api run typecheck` caught widened test mock literals; fixed and reran successfully.
- Full gate: first `npm run lint && npm run typecheck && npm test && npm run build` run caught missing `0012` in migration runtime test; updated and reran successfully.
- Review patch validation: `npm --workspace @china-slot-game/api test -- test/unit/topup-service.test.ts test/integration/tevi-topup-routes.test.ts` and `npm --workspace @china-slot-game/api run typecheck` passed after adding fail-closed duplicate request handling.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Added opt-in Tevi payment runtime configuration with credentials/channel/deposit-limit validation and production/staging PostgreSQL fail-closed behavior.
- Implemented backend-only top-up issuance through a Tevi provider request client and `TopupService`; no custom deposit-token signing was invented because no exact Tevi signing algorithm was available in repo docs.
- Added top-up signature issuance persistence in a distinct PostgreSQL table storing safe metadata and deposit-token fingerprints only.
- Added authenticated `POST /api/v1/payments/top-up-signature` route using existing Tevi auth middleware and API envelope patterns.
- Wired production dependencies only when Tevi auth, payment config, and PostgreSQL issuance persistence are available; tests inject fakes for focused route coverage.
- Confirmed no SDK `topup()`, webhook crediting, cashout, spin math, receipts, or wallet mutation behavior was added.

### File List

- `apps/api/db/migrations/0012_topup_signature_issuance.sql`
- `apps/api/src/app.ts`
- `apps/api/src/composition/production-dependencies.ts`
- `apps/api/src/config/env.ts`
- `apps/api/src/domain/tevi-payment-client.ts`
- `apps/api/src/domain/topup-service.ts`
- `apps/api/src/main.ts`
- `apps/api/src/repositories/postgres/topup-signature-issuance-repository.ts`
- `apps/api/src/routes/tevi-topup.routes.ts`
- `apps/api/test/integration/tevi-topup-routes.test.ts`
- `apps/api/test/postgres/topup-signature-issuance.test.ts`
- `apps/api/test/unit/db-runtime.test.ts`
- `apps/api/test/unit/env.test.ts`
- `apps/api/test/unit/tevi-payment-client.test.ts`
- `apps/api/test/unit/topup-service.test.ts`

### Change Log

- 2026-06-29: Implemented Story 8.4 top-up signature issuance, persistence, authenticated route, production wiring, tests, and validation evidence.

### Check Round Evidence

- Focused env/unit tests: `npm --workspace @china-slot-game/api test -- test/unit/env.test.ts test/unit/tevi-payment-client.test.ts test/unit/topup-service.test.ts` passed.
- Focused route/auth regressions: `npm --workspace @china-slot-game/api test -- test/integration/tevi-topup-routes.test.ts test/integration/tevi-token-routes.test.ts test/integration/tevi-auth-routes.test.ts test/unit/tevi-token-service.test.ts test/unit/server-client.test.ts test/unit/tevi-client.test.ts` passed as part of the 109-test focused run.
- PostgreSQL issuance test command: `npm --workspace @china-slot-game/api test -- test/postgres/topup-signature-issuance.test.ts` was present and skipped because no `TEST_DATABASE_URL`/`DATABASE_URL` was configured; test covers issued metadata, failed metadata, fingerprint-only constraint, restart reconstruction, and zero `wallet_transactions`.
- Full validation: `npm run lint && npm run typecheck && npm test && npm run build` passed.
- Curl success example: `curl -i -X POST http://127.0.0.1:3000/api/v1/payments/top-up-signature -H 'content-type: application/json' -H 'authorization: Bearer <TEVI_ACCESS_TOKEN>' -H 'x-request-id: req_tevi_topup_signature_success' --data '{"amount":100}'`.
- Expected success envelope: HTTP `201`, `{ "data": { "deposit_token": "<DEPOSIT_TOKEN>" }, "error": null, "requestId": "req_tevi_topup_signature_success" }`.
- Curl missing auth: omit `authorization`; expected HTTP `401`, code `TEVI_AUTH_REQUIRED`, same request ID envelope.
- Curl invalid amount: `--data '{"amount":0}'` or `--data '{"amount":1.5}'`; expected HTTP `400`, code `INVALID_TOP_UP_AMOUNT`, same request ID envelope.
- Curl deposit-limit violation: request amount outside configured `TEVI_DEPOSIT_MIN_STARS`/`TEVI_DEPOSIT_MAX_STARS`; expected HTTP `400`, code `TEVI_TOP_UP_LIMIT_EXCEEDED`, reason `AMOUNT_BELOW_MIN` or `AMOUNT_ABOVE_MAX`.
- Curl missing config/provider failure: missing payment service/config maps to `TEVI_PAYMENT_CONFIG_MISSING`; provider 401/403/429/5xx/network failures map to `TEVI_TOP_UP_SIGNATURE_FAILED` with safe reason codes.
- Safe log shape: `[tevi-topup] deposit token issued` with request ID, internal player ID, Tevi subject, amount, status, and `depositTokenFingerprint`; no full deposit token or credential values.
- SQL evidence shape: `SELECT provider_name, player_id, tevi_subject, amount, request_id, deposit_token_fingerprint, status, failure_reason, provider_status_code, created_at FROM topup_signature_issuances ORDER BY created_at DESC;` returns fingerprint/status metadata only.
- Secrets/boundary scan: searched API source, tests, and story evidence for JWT-like strings, Authorization/Bearer, `deposit_token`, API/secret key terms, access/refresh token fields, signatures, email, `topup()`, `wallet_transactions`, and cashout references; matches were expected field names, placeholders/test fixtures, existing adjacent code, or explicit no-wallet-mutation assertions only.
