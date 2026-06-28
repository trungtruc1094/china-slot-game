---
baseline_commit: d3de38c
---

# Story 8.3: Exchange and Refresh Tevi Tokens

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want the Mini App and backend to exchange and refresh Tevi tokens safely,
so that my authenticated game session can continue without exposing secrets or forcing unnecessary relogin.

## Acceptance Criteria

1. Given `window.TeviJS.getUserInfo({ is_popup, app_id }, cb)` returns `data.userInfo.user_app_token`, when Tevi mode starts authentication, then the client obtains that runtime token through `js/teviClient.js` without logging or persisting it outside approved runtime memory.
2. The backend exchanges the Tevi runtime token through Tevi `GET /api/v1/auth/token?app_id=...` with `Authorization: Bearer <TEVI_TOKEN>` using environment-supplied Tevi API configuration, not hard-coded credentials.
3. Access-token and refresh-token metadata is handled only through approved secure runtime handling; full Tevi runtime tokens, access tokens, refresh tokens, API keys, secret keys, Authorization headers, and provider responses containing secrets are never committed, returned to unsafe clients, written to story evidence, or logged in full.
4. Access tokens refresh before expiry where possible, using the Tevi refresh token only in backend-controlled runtime storage and preserving the existing internal Tevi auth/session route contract.
5. Token exchange or refresh failure returns a recoverable re-authentication state for the client, with stable game-owned `{ data, error, requestId }` envelopes and safe error codes.
6. Existing protected Tevi routes continue to authenticate through the Story 8.2 RS256/JWKS verifier and stable internal `player_id` mapping; this story does not create parallel player/session/wallet identity stores.
7. The implementation preserves Story 8.1 and 8.2 boundaries: no top-up signature issuance, SDK top-up execution, webhook wallet crediting, cashout, receipts, compliance gates, spin math, or wallet mutation behavior is implemented in this story.
8. The story ends with a Check Round including curl examples, expected response shape, local protected route behavior, recoverable client re-auth state, and `requestId` log correlation without full token material.

## Tasks / Subtasks

- [x] Add Tevi token exchange runtime configuration (AC: 2, 3, 5)
  - [x] Extend `apps/api/src/config/env.ts` and `ApiEnv` with only the configuration needed for token exchange/refresh: `TEVI_API_BASE` and any non-secret token-flow toggles needed by implementation.
  - [x] Keep `TEVI_APP_ID`, `TEVI_JWKS_URL`, and `TEVI_ALLOW_ANONYMOUS_USERS` behavior from Story 8.2 intact.
  - [x] Treat `TEVI_API_BASE` as HTTPS-only and default sandbox explicitly if the existing Tevi sandbox defaults are used; production/staging must fail safe when Tevi token exchange is enabled but required Tevi config is missing.
  - [x] Do not add `TEVI_API_KEY`, `TEVI_SECRET_KEY`, top-up signing secrets, webhook secrets, or cashout provider credentials unless a concrete Tevi token-exchange requirement proves they are required; later stories own money-path credentials.
- [x] Implement a backend Tevi token exchange client/service (AC: 2, 3, 4, 5)
  - [x] Add a backend-only service such as `apps/api/src/domain/tevi-token-service.ts` that calls `${TEVI_API_BASE}/api/v1/auth/token?app_id=${TEVI_APP_ID}` with `Authorization: Bearer <runtime token>`.
  - [x] Use Node/undici `fetch` available in Node 24 unless implementation discovers a compatibility blocker; do not add an HTTP client dependency without a concrete reason.
  - [x] Validate the provider response shape with `zod` before using it. Expected fields from PRD: `access_token` and `refresh_token`; include expiry metadata only if Tevi returns it or it can be derived safely from verified JWT claims.
  - [x] Store token values only in backend-controlled runtime memory for the authenticated request/session path. If persistence appears necessary, stop and update PRD/architecture first because token storage introduces secret-at-rest requirements not defined for Story 8.3.
  - [x] Redact or fingerprint token material in any diagnostics. Safe logs may include `requestId`, status, Tevi endpoint path, and reason code; they must not include raw tokens, Authorization headers, provider response bodies, email, API keys, or secrets.
- [x] Add game-owned token exchange/refresh routes or route extensions (AC: 2, 4, 5, 6)
  - [x] Add a narrow route such as `POST /api/tevi/token` or an equivalent route under the existing Tevi auth boundary. Keep game-owned responses in `{ data, error, requestId }` envelopes.
  - [x] Require a runtime Tevi token from the client only long enough to perform the provider token exchange. Do not accept raw `{ provider: "tevi", subject }` identity as proof of auth.
  - [x] After exchange, continue using `JoseTeviAuthVerifier` and `createTeviAuthMiddleware` for protected game routes where an access token is used as a bearer token.
  - [x] Return only safe session/auth metadata to the browser, such as internal session status, token expiry, and re-auth hints. Do not return refresh tokens to the browser unless Tevi documentation explicitly requires browser ownership and the PRD/architecture are updated.
  - [x] Map provider/network/refresh failures to stable recoverable codes such as `TEVI_TOKEN_EXCHANGE_FAILED`, `TEVI_TOKEN_REFRESH_FAILED`, or `TEVI_REAUTH_REQUIRED`, with safe details.
- [x] Extend `js/teviClient.js` for runtime auth token acquisition (AC: 1, 3, 5)
  - [x] Add a method such as `getUserAppToken(options)` or `authenticate(options)` that calls `window.TeviJS.getUserInfo({ is_popup, app_id }, cb)` in Tevi mode.
  - [x] Normalize callback success, cancellation, SDK unavailable, missing `user_app_token`, wrong response shape, and thrown SDK errors into recoverable client states.
  - [x] Do not write Tevi runtime tokens, access tokens, refresh tokens, or Authorization headers to debug overlays, URL query strings, localStorage, sessionStorage, console logs, DOM attributes, or story evidence.
  - [x] Preserve current Story 8.1 behavior: SDK script loading, back/close/layout affordances, debug overlay metadata, local demo separation, and no Tevi SDK load in local mode.
- [x] Connect Tevi client auth to backend session startup without breaking existing local/demo flow (AC: 1, 5, 6)
  - [x] Update `js/serverClient.js` or the narrow startup seam in `js/slotGame.js` so Tevi mode can use the Tevi token exchange/auth route and then create or resume the existing internal Tevi session.
  - [x] Preserve `serverClient.startSession()` in-flight request caching; eager page load and quick Spin clicks must not create duplicate sessions.
  - [x] Keep generic `/api/sessions` guest/demo behavior unchanged for non-Tevi modes.
  - [x] In Tevi re-auth required states, disable value-bearing spin actions and surface a recoverable state rather than falling back to local demo money.
- [x] Add focused automated tests (AC: 1-7)
  - [x] Unit-test the token exchange client/service with mocked fetch responses for success, provider 401/403, non-JSON body, missing token fields, refresh failure, network failure, timeout or abort if implemented, and redacted diagnostics.
  - [x] Unit-test `loadEnv()` for token-exchange configuration defaults, HTTPS validation, production/staging fail-safe behavior, and explicit disabled behavior.
  - [x] Integration-test the game-owned token route with injected fake Tevi token service: success envelope, exchange failure, refresh failure/re-auth state, no raw tokens in response, and `requestId` propagation.
  - [x] Extend `apps/api/test/unit/tevi-client.test.ts` for `window.TeviJS.getUserInfo()` success, cancellation, SDK unavailable, missing `user_app_token`, and proof that debug state does not contain token values.
  - [x] Add or update browser/client tests for Tevi session startup to prove `startSession()` request coalescing still works and non-Tevi production mode still uses existing guest identity behavior.
  - [x] Keep Story 8.2 tests green: `apps/api/test/unit/tevi-auth-adapter.test.ts` and `apps/api/test/integration/tevi-auth-routes.test.ts`.
- [x] Complete the Story 8.3 Check Round (AC: 8)
  - [x] Record exact commands for lint, typecheck, focused tests, and full validation.
  - [x] Record curl examples for token exchange success, invalid runtime token, provider failure, refresh/re-auth failure, and local protected route behavior. Use placeholders for token values; never paste real tokens.
  - [x] Record expected response envelopes and request IDs.
  - [x] Record safe logs showing request ID correlation and reason codes without token material.
  - [x] Record manual or test evidence that Tevi mode reaches a recoverable re-authentication state and does not fall back to local/demo balances.

### Review Findings

- [x] [Review][Patch] Refresh path is specified but not implemented [apps/api/src/domain/tevi-token-service.ts:117]
- [x] [Review][Patch] Tevi SDK token request can hang indefinitely [js/teviClient.js:91]
- [x] [Review][Patch] Provider outage statuses are reported as user re-authentication [apps/api/src/domain/tevi-token-service.ts:67]
- [x] [Review][Patch] Token route can return authenticated metadata without verifier/session binding [apps/api/src/routes/tevi-token.routes.ts:36]
- [x] [Review][Required] After implementation, search touched code, tests, logs, and story evidence for JWT-like strings, Authorization headers, `access_token`, `refresh_token`, `user_app_token`, API keys, secrets, and email addresses; confirm no full secret/token material was committed or recorded.
- [x] [Review][Required] Confirm this story did not implement top-up signatures, SDK top-up, webhook wallet crediting, cashout, receipts, production compliance gates, spin math, or wallet mutation behavior ahead of scheduled stories.

## Dev Notes

### Requirements Context

- Story source: `_bmad-output/planning-artifacts/epics.md` Story 8.3.
- Primary requirements: TEVI-FR-3, TEVI-NFR2, TEVI-NFR3, TEVI-NFR5, UX-DR10.
- Tevi token flow from PRD addendum: `window.TeviJS.getUserInfo({ is_popup, app_id }, cb)` returns `data.userInfo.user_app_token`; token exchange uses Tevi `GET /api/v1/auth/token?app_id=...` with `Authorization: Bearer <TEVI_TOKEN>` and returns `access_token` plus `refresh_token`.
- Access token TTL is documented as 24 hours; refresh token TTL is documented as 24 weeks.
- Tevi JWT claims include `user_id`, `user_name`, `user_email`, `user_is_active`, `user_anonymous`, `user_avatar`, and `app_id`. Only verified safe identity from Story 8.2 should map to internal gameplay state.
- Token exchange/refresh failures must surface as re-authentication required, not local demo fallback or anonymous Tevi identity.
- Production Tevi exposure remains blocked until Epic 9. Story 8.3 is sandbox token continuity only.

### Existing Code to Reuse and Preserve

- `apps/api/src/domain/tevi-auth-adapter.ts` implements Story 8.2 RS256/JWKS verification with `jose`, `app_id` checks, active/anonymous policy checks, safe error mapping, and internal `TeviAuthContext`. Reuse this for access-token verification; do not create a weaker token decoder.
- `apps/api/src/middleware/tevi-auth.ts` extracts bearer tokens case-insensitively, logs safe reason codes with `requestId`, and attaches `request.teviAuth`. Preserve this behavior.
- `apps/api/src/routes/tevi-session.routes.ts` exposes `POST /api/tevi/session` and `GET /api/tevi/me` behind Tevi auth. Token exchange should feed this boundary, not bypass it.
- `apps/api/src/config/env.ts` currently has Tevi auth config only: `TEVI_AUTH_ENABLED`, `TEVI_APP_ID`, `TEVI_JWKS_URL`, and `TEVI_ALLOW_ANONYMOUS_USERS`. Extend it carefully rather than replacing Story 8.2 behavior.
- `apps/api/src/main.ts` constructs `JoseTeviAuthVerifier` when Tevi auth is enabled and otherwise leaves Tevi routes unwired. Token exchange configuration must fit this production/local composition without forcing money-path credentials.
- `js/teviClient.js` currently loads `https://static.tevicdn.com/helper_tevi.js`, resolves sandbox metadata, detects `window.TeviJS`, initializes back/close/layout affordances, and renders a metadata-only debug overlay. Add auth helpers here; keep debug output token-free.
- `js/serverClient.js` owns backend session/spin calls and caches an in-flight `startSession()` request. Preserve this cache when adding Tevi auth/session startup.
- `js/slotGame.js` initializes `serverClient` and `teviClient`, sets Tevi initial balance to `0`, and starts the backend session during game creation. Keep existing Phaser reel animation, controls, popups, and state transitions intact.
- `apps/api/test/unit/tevi-client.test.ts`, `apps/api/test/unit/server-client.test.ts`, `apps/api/test/unit/tevi-auth-adapter.test.ts`, and `apps/api/test/integration/tevi-auth-routes.test.ts` are the closest existing test patterns.

### Current State of Files Likely to be Modified

- `apps/api/src/config/env.ts`: add token-exchange configuration and validation. Existing tests in `apps/api/test/unit/env.test.ts` should be extended.
- `apps/api/src/domain/tevi-auth-adapter.ts`: likely unchanged except possibly shared types. Avoid weakening validation.
- Expected new backend domain file: `apps/api/src/domain/tevi-token-service.ts` or equivalent.
- Expected new backend route file: `apps/api/src/routes/tevi-token.routes.ts` or equivalent.
- `apps/api/src/app.ts`: register the token route only when the required token service/dependencies are present, matching current conditional Tevi route style.
- `apps/api/src/main.ts`: compose production token exchange service only when Tevi auth/token exchange is enabled.
- `js/teviClient.js`: add `getUserInfo()`/auth token helper methods.
- `js/serverClient.js` and/or `js/slotGame.js`: wire Tevi token acquisition/exchange into startup while preserving non-Tevi session behavior.
- `apps/api/test/unit/tevi-client.test.ts` and `apps/api/test/unit/server-client.test.ts`: extend browser-side coverage.
- `apps/api/test/unit/tevi-token-service.test.ts` and `apps/api/test/integration/tevi-token-routes.test.ts`: expected new focused tests.

### Architecture Compliance

- Backend treats Tevi runtime tokens, access tokens, and refresh tokens as untrusted until verified or exchanged through documented Tevi APIs.
- Game-owned routes continue to use REST JSON and `{ data, error, requestId }` envelopes.
- Stable error objects use `code`, `message`, and `details`; do not leak provider response bodies or token strings in details.
- Use TypeScript kebab-case files, strict types, zod response validation, and existing domain/route/middleware boundaries.
- Production/staging Tevi mode must fail safe when required token exchange configuration is missing. Do not silently fall back to guest identity or in-memory production state.
- The client remains non-authoritative: it obtains a runtime token and displays recoverable auth state, but it does not verify JWTs, sign tokens, mutate Stars balances, or calculate payouts.

### Security and Privacy Guardrails

- Do not log full `user_app_token`, `access_token`, `refresh_token`, bearer token, Authorization header, JWT signature, Tevi email, API key, secret key, deposit token, webhook signature, or provider response body.
- Do not persist refresh tokens unless architecture is updated with encryption/rotation/retention requirements. Story 8.3 should prefer backend runtime/session-scoped handling.
- Do not place tokens in query strings, debug overlays, DOM attributes, localStorage, sessionStorage, screenshots, story notes, or curl examples.
- Do not trust client-provided `app_id`; the backend uses configured `TEVI_APP_ID` for token exchange and verifies `app_id` in returned access tokens through Story 8.2 auth.
- Safe client state labels include `sdk-unavailable`, `token-exchange-pending`, `authenticated`, `re-authentication-required`, and `backend-unavailable`.
- If Tevi docs require browser ownership of refresh tokens, stop and update PRD/architecture before implementation; that is a security model change.

### Library and Framework Guidance

- API package is ESM TypeScript on Node 24, Express 5, zod 4.2.0, and `jose` 6.2.3.
- Current npm latest for `jose` checked during story creation is `6.2.3`; no upgrade is needed for this story.
- Use built-in Node 24 `fetch` for Tevi token exchange unless implementation finds a concrete blocker.
- Continue using `jose` for JWT verification; do not introduce `jsonwebtoken` or custom crypto verification.

### Previous Story Intelligence

- Story 8.2 added `JoseTeviAuthVerifier`, Tevi auth middleware, `POST /api/tevi/session`, `GET /api/tevi/me`, raw Tevi identity blocking on generic `/api/sessions` when Tevi auth is wired, and focused auth tests.
- Story 8.2 final validation passed with `npm run lint && npm run typecheck && npm test && npm run build`.
- Story 8.2 review patched several security edges: explicit `user_anonymous` claim requirement, safe expiry conversion, explicit `TEVI_AUTH_ENABLED=false`, case-insensitive bearer parsing, JWKS failure coverage, `nbf` handling, missing-token logging, and missing `app_id` as invalid token.
- Preserve these review fixes. Do not reintroduce raw token logging, lenient token parsing, raw Tevi identity sessions, or generic-session Tevi bypasses.
- Story 8.1 sandbox evidence included `TEVI_APP_ID=AZX29173`, Tevi channel ID `2300210851`, app URL `https://chinareel.pleagamehub.com/`, and webhook URL `https://china-slot-api.onrender.com/api/webhooks/tevi`. Treat these as sandbox metadata, not production secrets. Note the canonical webhook route for later stories is `POST /api/v1/webhooks/tevi`; do not alter webhook behavior in Story 8.3.

### Git Intelligence

- Recent commits show the Tevi auth path is fresh and should be extended rather than rewritten:
  - `d3de38c feat(tevi): finalize Story 8.2 with user authentication improvements and QA results`
  - `8e290e5 feat: implement Tevi authentication adapter and middleware`
  - `5f69b4f feat(tevi): Finalize Story 8.1 and enhance Tevi webhook challenge validation`
  - `88a9706 feat(tevi): Enhance debug overlay and metadata handling for sandbox environment`
  - `3f3b6af feat(tevi): Add debug panel for mobile sandbox evidence and enhance runtime configuration`

### External Technical Notes

- Tevi PRD addendum is the source of truth for token exchange because public Tevi auth docs were not reliably available during prior story creation.
- Tevi endpoint inventory uses sandbox API base `https://developer-api.sbx.tevi.dev` and production API base `https://developer-api.flowstreamx.com`.
- Tevi access token TTL is documented as 24 hours and refresh token TTL as 24 weeks. If live sandbox responses provide different fields or semantics, record the discrepancy and update story notes/architecture before coding around it.
- Tevi webhook signature and top-up/cashout APIs are later-story concerns; avoid pulling them into this token story.

### Testing Guidance

- Focused backend unit tests:
  - `npm --workspace @china-slot-game/api test -- test/unit/env.test.ts test/unit/tevi-token-service.test.ts`
- Focused backend integration tests:
  - `npm --workspace @china-slot-game/api test -- test/integration/tevi-token-routes.test.ts test/integration/tevi-auth-routes.test.ts`
- Focused browser/client tests:
  - `npm --workspace @china-slot-game/api test -- test/unit/tevi-client.test.ts test/unit/server-client.test.ts`
- Existing adjacent tests to keep green:
  - `npm --workspace @china-slot-game/api test -- test/unit/tevi-auth-adapter.test.ts test/integration/tevi-webhook-routes.test.ts`
- Full story gate after implementation:
  - `npm run lint && npm run typecheck && npm test && npm run build`

### Check Round Evidence To Record

- Curl for game-owned token exchange route with placeholder bearer value only, for example `Authorization: Bearer <TEVI_RUNTIME_TOKEN>`.
- Curl for exchange failure returning a stable envelope and `requestId`.
- Curl or test evidence for refresh/re-auth failure returning a recoverable state.
- Curl for local protected route behavior after token exchange, using either a local signed fixture token or sandbox token redacted to placeholder form.
- Safe logs showing `requestId`, endpoint/action, and reason code without token material.
- Client manual/test evidence: SDK unavailable, `getUserInfo()` canceled, missing `user_app_token`, exchange pending, authenticated, and re-authentication required states.
- Search evidence that no full token/secret material appears in code, tests, logs, story notes, debug overlay text, or curl examples.

### Project Structure Notes

- Keep backend token exchange code under `apps/api/src/domain`, `apps/api/src/routes`, and composition files. Do not place backend secrets or provider calls under `js/`.
- Keep browser-side Tevi SDK code in `js/teviClient.js`; do not let `js/serverClient.js` know Tevi SDK details beyond an injected auth/session helper if possible.
- Keep the current static Phaser client playable in local/demo and non-Tevi production modes.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 8 and Story 8.3 acceptance criteria.
- `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/tevi-integration-addendum.md` - Tevi token exchange/refresh flow, TTLs, SDK method, endpoint inventory, and Check Round policy.
- `_bmad-output/planning-artifacts/architecture.md` - Tevi readiness boundary, TeviAuthAdapter, client adapter rules, production fail-safe rules, and API envelope requirements.
- `_bmad-output/planning-artifacts/ux-designs/ux-China Slot Game-2026-06-27/EXPERIENCE.md` - re-authentication state, SDK unavailable behavior, Tevi unavailable behavior, and no local-money fallback.
- `_bmad-output/project-context.md` - current frontend/backend structure and server-authoritative constraints.
- `_bmad-output/implementation-artifacts/8-2-authenticate-tevi-users-and-map-player-identity.md` - previous story implementation, files changed, validation commands, and review findings.
- `apps/api/src/domain/tevi-auth-adapter.ts` - existing RS256/JWKS verification boundary.
- `apps/api/src/middleware/tevi-auth.ts` - existing safe bearer middleware and rejection logging.
- `apps/api/src/routes/tevi-session.routes.ts` - existing protected Tevi session route.
- `js/teviClient.js` - current Tevi SDK loader and Mini App helper client.
- `js/serverClient.js` - current backend session/spin adapter and `startSession()` request coalescing.

## Dev Agent Record

### Agent Model Used

GitHub Copilot

### Debug Log References

- Focused backend red/green validation: `npm --workspace @china-slot-game/api test -- test/unit/env.test.ts`, `test/unit/tevi-token-service.test.ts`, and `test/integration/tevi-token-routes.test.ts`.
- Focused browser/client validation: `npm --workspace @china-slot-game/api test -- test/unit/tevi-client.test.ts test/unit/server-client.test.ts`.
- Combined focused regression: `npm --workspace @china-slot-game/api test -- test/unit/tevi-client.test.ts test/unit/server-client.test.ts test/unit/env.test.ts test/unit/tevi-token-service.test.ts test/integration/tevi-token-routes.test.ts test/integration/tevi-auth-routes.test.ts`.
- Static validation: `npm run typecheck`, `npm run lint`.
- Full validation: `npm run lint && npm run typecheck && npm test && npm run build`.
- Sensitivity scan: workspace search for `Authorization`, `Bearer`, `access_token`, `refresh_token`, `user_app_token`, JWT-like strings, API key/secret terms, and email terms; hits were expected placeholder/test field names or prior planning text, with no real token or credential material recorded.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Added `TEVI_API_BASE` and `TEVI_TOKEN_EXCHANGE_ENABLED` env handling with local/test sandbox default, HTTPS validation, explicit disable support, and production fail-safe when token exchange is enabled without an API base.
- Implemented backend-only Tevi token exchange and refresh service using built-in `fetch`, the documented Tevi auth token endpoint, `zod` response validation, safe reason-code diagnostics, runtime-only token handling, and recoverable refresh/re-auth failure mapping.
- Added `POST /api/tevi/token` and `POST /api/tevi/token/refresh` routes returning safe `{ data, error, requestId }` envelopes; they exchange or refresh tokens, verify the resulting access token through the existing Tevi verifier, bind it to the internal session, and do not return provider tokens to the browser.
- Extended `js/teviClient.js` with `getUserAppToken()` for `window.TeviJS.getUserInfo({ is_popup, app_id }, cb)` and normalized SDK unavailable, cancellation, missing-token, and SDK failure states without storing token material in debug state.
- Wired Tevi session startup through `js/serverClient.js` and `js/slotGame.js` so Tevi mode calls `/api/tevi/token`, preserves `startSession()` in-flight coalescing, avoids guest fallback on re-auth states, and keeps local/demo session behavior unchanged.
- Added focused unit/integration coverage for env parsing, token service success/failure/redaction, token route envelopes and session creation, browser SDK token acquisition, Tevi startup coalescing, re-auth retry behavior, and Story 8.2 Tevi auth route regression.
- Check Round: success curl placeholder `curl -i -X POST http://127.0.0.1:3000/api/tevi/token -H 'content-type: application/json' -H 'x-request-id: req_tevi_token_success' --data '{"runtimeToken":"<TEVI_RUNTIME_TOKEN>"}'` returns `201` with `data.status="authenticated"`, `data.reauthRequired=false`, safe `data.accessTokenExpiresAt`, internal `data.session`, `error=null`, and `requestId`.
- Check Round: refresh curl placeholder `curl -i -X POST http://127.0.0.1:3000/api/tevi/token/refresh -H 'content-type: application/json' -H 'x-request-id: req_tevi_refresh_success' --data '{"sessionId":"<INTERNAL_SESSION_ID>"}'` returns `200` with `data.status="authenticated"`, `data.reauthRequired=false`, refreshed safe `data.accessTokenExpiresAt`, resumed internal `data.session`, `error=null`, and `requestId`.
- Check Round: invalid or provider-rejected runtime or refresh token placeholder returns `401` with `data=null`, `error.code="TEVI_TOKEN_EXCHANGE_FAILED"` or `"TEVI_TOKEN_REFRESH_FAILED"`, `error.details.reasonCode`, `error.details.reauthRequired=true`, and request ID correlation.
- Check Round: protected local route behavior remains verifier-owned via `POST /api/tevi/session` and `GET /api/tevi/me`; existing auth route regression tests pass and generic `/api/sessions` still rejects raw Tevi identity when Tevi auth is wired.
- Check Round: safe log evidence is `console.warn("[tevi-token] token operation failed", { requestId, endpointPath: "/api/v1/auth/token", reasonCode, providerStatus })` and exchanged-access-token rejection logs include only request ID and reason code.
- Check Round: client tests prove SDK unavailable/cancel/missing-token states return `re-authentication-required`, Tevi startup does not fall back to demo/guest money, and token values are absent from debug state.
- Boundary review completed: no top-up signatures, SDK top-up execution, webhook wallet crediting, cashout, receipts, compliance gates, spin math, or wallet mutation behavior was added.

### File List

- `_bmad-output/implementation-artifacts/8-3-exchange-and-refresh-tevi-tokens.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/src/app.ts`
- `apps/api/src/config/env.ts`
- `apps/api/src/domain/tevi-token-service.ts`
- `apps/api/src/main.ts`
- `apps/api/src/routes/tevi-token.routes.ts`
- `apps/api/test/integration/tevi-token-routes.test.ts`
- `apps/api/test/unit/env.test.ts`
- `apps/api/test/unit/server-client.test.ts`
- `apps/api/test/unit/tevi-client.test.ts`
- `apps/api/test/unit/tevi-token-service.test.ts`
- `js/serverClient.js`
- `js/slotGame.js`
- `js/teviClient.js`

### Change Log

- 2026-06-28: Implemented Tevi token exchange/refresh continuity path, client runtime token acquisition, internal session startup wiring, focused tests, Check Round evidence, and validation for Story 8.3.