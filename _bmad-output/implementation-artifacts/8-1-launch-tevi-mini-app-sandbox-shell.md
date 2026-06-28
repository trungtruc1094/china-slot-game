---
baseline_commit: 0f87ed45a0f61861fe1f46dd4abf4bbeec6dbd38
---

# Story 8.1: Launch Tevi Mini App Sandbox Shell

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want the game to launch inside Tevi sandbox as a Mini App,
so that I can enter the existing slot experience through the Tevi H5 runtime without reward-bearing demo behavior leaking into production mode.

## Acceptance Criteria

1. Given Tevi sandbox mode is enabled with configured `TEVI_APP_ID`, sandbox `app_url`, sandbox `webhook_url`, and active channel metadata, when the player opens the registered Tevi Mini App URL, then the existing Phaser client loads successfully inside the Tevi H5/Mini App context.
2. The page loads `https://static.tevicdn.com/helper_tevi.js` only in Tevi mode.
3. `js/teviClient.js` detects `window.TeviJS` when available and exposes safe Mini App helpers to the game.
4. Tevi SDK back/close/layout affordances are initialized where available without breaking local browser mode.
5. Local/demo mode remains available only for non-reward visual development.
6. Production Tevi mode cannot seed real players with the existing `defaultCoins:100000` demo balance.
7. The implementation preserves the existing Phaser reel animation, controls, popups, and state transitions.
8. The story ends with a Check Round showing sandbox app launch, SDK presence, app URL registration, webhook URL registration, active channel configuration, and local/demo mode separation.

## Tasks / Subtasks

- [x] Add Tevi runtime configuration and mode detection (AC: 1, 2, 5, 6)
  - [x] Extend `js/runtime-config.js` with Tevi sandbox configuration globals such as app ID, channel ID, app URL, webhook URL, environment, and an explicit Tevi mode flag.
  - [x] Preserve the existing `CHINA_SLOT_API_BASE_URL` behavior and existing `?mode=demo`/production behavior used by `js/serverClient.js`.
  - [x] Ensure Tevi mode is explicit; normal local browser/demo play must not load Tevi SDK or require Tevi globals.
  - [x] Document or encode that `defaultCoins:100000` is local/demo-only and never the starting balance for production Tevi players.
- [x] Add the browser Tevi adapter (AC: 2, 3, 4)
  - [x] Create `js/teviClient.js` beside `js/serverClient.js` as a classic-browser global adapter, not an ES module.
  - [x] Implement SDK script loading for `https://static.tevicdn.com/helper_tevi.js` only when Tevi mode is active.
  - [x] Expose a `window.ChinaSlotTeviClient` API that can report mode/environment, SDK availability, configured app/channel metadata, and safe helper methods.
  - [x] Wrap only safe Mini App affordances in this story: SDK detection, `showBackButton`, `showCloseButton`, `loadConfig`, and safe close/quit helpers where present.
  - [x] Do not implement auth token exchange, top-up signatures, SDK `topup()`, webhooks, wallet crediting, cashout, receipts, or provider API calls in this story.
- [x] Wire the adapter into the existing static client shell (AC: 1, 2, 4, 7)
  - [x] Add `js/teviClient.js` to `index.html` after `js/runtime-config.js` and before `js/slotGame.js` so the Phaser scene can detect it.
  - [x] Initialize Tevi Mini App layout/back/close affordances from `js/slotGame.js` or an adjacent browser seam without changing reel animation, spin sequencing, popups, or state-machine behavior.
  - [x] Keep Tevi initialization failure non-fatal for local browser mode and SDK-unavailable sandbox fallback.
- [x] Preserve production/demo wallet separation (AC: 5, 6)
  - [x] In Tevi production/sandbox reward-bearing mode, require backend session balance before enabling value-bearing play; do not display or apply `slotConfig.defaultCoins` as a real Tevi balance.
  - [x] Keep existing local visual demo available and distinguishable through explicit mode/config; demo mode may still use `slotConfig.defaultCoins` for non-reward local development.
  - [x] Avoid changing canonical math, backend spin contracts, PostgreSQL persistence, or wallet mutation semantics.
- [x] Add focused browser adapter tests (AC: 2, 3, 4, 5, 6, 7)
  - [x] Add or extend VM-based tests in `apps/api/test/unit/` using the existing `server-client.test.ts` pattern.
  - [x] Test Tevi SDK script is requested only in Tevi mode.
  - [x] Test SDK-unavailable behavior returns a safe unavailable state and does not throw in local browser mode.
  - [x] Test safe helper wrappers call `window.TeviJS.showBackButton`, `showCloseButton`, and `loadConfig` only when available.
  - [x] Test Tevi mode does not rely on demo identity/balance seeding and preserves backend-authoritative balance startup expectations.
- [ ] Complete the Story 8.1 Check Round (AC: 8)
  - [ ] Record sandbox `app_url`, `webhook_url`, required webhook scopes, and active channel evidence in the story Dev Agent Record or a verification playbook note.
  - [ ] Record browser console/manual evidence that `window.TeviJS` is detected inside Tevi sandbox and unavailable safely outside it.
  - [x] Record local/demo separation evidence showing Tevi SDK is not loaded in normal local demo mode and Tevi mode does not grant `defaultCoins:100000` as a real balance.

## Dev Notes

### Requirements Context

- Story source: `_bmad-output/planning-artifacts/epics.md` Story 8.1.
- Primary requirements: TEVI-FR-1, TEVI-FR-7, TEVI-NFR2, TEVI-NFR5, UX-DR7, UX-DR8, UX-DR13.
- Tevi Mini App shell is sandbox-first. Production Tevi exposure remains blocked until Epic 9 compliance, jurisdiction, age/KYC where available, responsible-gaming, deposit-limit, self-exclusion, host-float, security, API approval, and cutover gates are complete.
- Tevi Stars are integer units end to end for the Tevi path. Story 8.1 only prepares the launch shell and runtime separation; it must not create any wallet credit, top-up, or cashout behavior.
- Production Tevi users start at `0` Stars unless credited by Tevi top-up or an approved sandbox/admin fixture. The existing `slotConfig.defaultCoins: 100000` is demo/local-only.

### Existing Code to Reuse and Preserve

- `index.html` currently loads the static Phaser client in this order: `js/phaser.js`, `js/runtime-config.js`, then game scripts including `js/serverClient.js` before `js/slotGame.js`. Add the Tevi adapter into this classic script flow; do not convert the app to modules or a framework.
- `js/runtime-config.js` currently sets `window.CHINA_SLOT_API_BASE_URL` with a Render API default. Extend it carefully with Tevi globals; do not remove or rename the API base global.
- `js/serverClient.js` is the existing production/demo backend seam. It defaults to production unless `mode=demo`, `CHINA_SLOT_MODE='demo'`, or explicit options select demo. It owns safe backend retry state and backend result normalization. Do not duplicate spin, session, payout, or balance authority in `js/teviClient.js`.
- `js/slotGame.js` creates `this.serverClient`, starts backend session balance through `initializeBackendSessionBalance()`, requests backend spins through `requestBackendSpin()`, and preserves local visual demo mode when not in production. Tevi shell initialization must be adjacent and non-invasive.
- `js/slotConfig3x5.js` contains `defaultCoins: 100000`; this must remain usable for local visual demo only and must not become a Tevi sandbox/production funded balance.
- `apps/api/test/unit/server-client.test.ts` already loads browser JS through `vm.runInContext` and asserts plain global-object contracts. Reuse this pattern for `teviClient.js` tests instead of introducing a browser test runner.

### Architecture Compliance

- Keep the static Phaser client as presentation/runtime shell. Client responsibilities remain rendering, controls, popups, animation, safe SDK affordances, and backend API calls through dedicated adapters.
- The client must never sign deposit tokens, verify webhooks, compute production payouts, mutate production balances, or treat SDK success as wallet credit.
- `js/teviClient.js` should be a thin adapter around `window.TeviJS` and runtime configuration. Backend boundaries such as `TeviAuthAdapter`, `TopupService`, `TeviWebhookService`, `CashoutRequestService`, and receipt services are later stories.
- Tevi mode startup must be fail-safe with respect to missing SDK/configuration: show or expose unavailable state; do not silently switch into reward-bearing local money.
- Do not add new external npm dependencies for this story unless absolutely necessary. The Tevi helper is a browser script loaded from Tevi CDN in Tevi mode.

### Latest Tevi SDK Notes

- The fetched Tevi helper script currently reports version `1.1.0` and exposes `getUserInfo`, `topup`, `executeLink`, `quitGame`, `showCloseButton`, `showBackButton`, `loadConfig`, `createPost`, `downloadMedia`, and callback registration helpers.
- The adapter should feature-detect methods instead of assuming they exist. Missing methods should return a safe unavailable result or no-op status, not throw during local browser loading.
- The SDK script URL from the PRD/architecture is `https://static.tevicdn.com/helper_tevi.js`; keep this centralized in config or adapter constants so later auth/top-up stories reuse the same source.

### UX and Copy Guardrails

- UX source: `_bmad-output/planning-artifacts/ux-designs/ux-China Slot Game-2026-06-27/EXPERIENCE.md`.
- Primary form factor is a mobile Tevi/Telegram Mini App shell with the existing Phaser/H5 game surface.
- Story 8.1 only needs launch and shell affordances, but the visible state language must use `Stars` for Tevi value labels where touched. Avoid `coins`, `cash`, `money`, `credits`, or fiat wording for Tevi-backed values.
- Local demo mode must hide Tevi payment affordances or clearly keep them non-production. No silent fallback to local demo money when SDK/backend readiness fails.
- Back/close affordances should leave the game in a recoverable state and must not imply payment cancellation after future committed payment work.

### Previous Story and Git Intelligence

- Epic 7 is complete. Story 7.9 verified PostgreSQL migrations, schema readiness, production dependency composition, restart recovery, admin/search records, and future provider top-up idempotency in PostgreSQL before Tevi integration.
- Story 7.9 explicitly preserved the no-cashout/no-Tevi-processing boundary. Story 8.1 is the first story that starts Tevi integration, but it still must not implement top-up processing, wallet crediting, cashout, redemption, crypto, currency conversion, or real-money semantics.
- Recent commits show Tevi planning artifacts and UX designs were added on branch `feat/tevi-integration`; code implementation for Tevi has not started yet. There are no existing `apps/api/src/**/*tevi*.ts` or `js/teviClient.js` files at story creation time.

### Expected File Changes

- Expected new files:
  - `js/teviClient.js`
  - `apps/api/test/unit/tevi-client.test.ts` or equivalent focused VM test file
- Expected modified files:
  - `index.html`
  - `js/runtime-config.js`
  - `js/slotGame.js` only if needed for Tevi shell initialization or demo-balance separation
  - `_bmad-output/implementation-artifacts/8-1-launch-tevi-mini-app-sandbox-shell.md`
  - `_bmad-output/implementation-artifacts/sprint-status.yaml`
- Avoid modifying canonical game math, backend spin services, PostgreSQL migrations, wallet repositories, or Tevi money-path backend APIs in this story.

### Testing Guidance

- Focused test command:
  - `npm --workspace @china-slot-game/api test -- test/unit/tevi-client.test.ts test/unit/server-client.test.ts`
- If `slotGame.js` production/demo balance behavior changes, include the existing server-client unit tests because that file contains current slot-game method tests.
- Full story gate after implementation:
  - `npm run lint && npm run typecheck && npm test && npm run build`
- Manual Check Round is required because Tevi sandbox registration, active channel, SDK presence, app URL, and webhook URL cannot be proven by unit tests alone.

### Check Round Evidence To Record

- Sandbox app URL registered in Tevi developer portal.
- Sandbox webhook URL registered in Tevi developer portal, with required webhook scopes noted for later top-up webhook stories.
- Active channel ID/configuration present and matching runtime config.
- Mini App launch opens the existing Phaser game without breaking reel animation, controls, popups, or state transitions.
- Browser console or manual observation shows `window.TeviJS` presence inside Tevi sandbox and safe unavailable state outside Tevi.
- Local/demo mode does not load Tevi helper script and can still run visual demo.
- Tevi reward-bearing mode does not grant `defaultCoins:100000` as real player balance.

### Project Structure Notes

- This repo intentionally keeps the current client as static browser scripts under `js/`; do not introduce React/Vite/Next for this story.
- Keep classic-script globals consistent with existing style: `window.ChinaSlotServerClient` is the model for `window.ChinaSlotTeviClient`.
- Browser-facing code should remain compatible with direct static hosting from `index.html`.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 8 and Story 8.1 acceptance criteria.
- `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/tevi-integration-addendum.md` - Tevi SDK, platform rules, Stars wallet decisions, and sandbox requirements.
- `_bmad-output/planning-artifacts/architecture.md` - Tevi readiness boundary, adapter placement, and production/demo separation.
- `_bmad-output/planning-artifacts/ux-designs/ux-China Slot Game-2026-06-27/EXPERIENCE.md` - Mini App shell, wallet language, platform behavior, and Check Round expectations.
- `_bmad-output/project-context.md` - current client/backend structure and known constraints.
- `_bmad-output/implementation-artifacts/7-9-verify-persistence-recovery-admin-search-and-quality-gates.md` - completed persistence gate and no-Tevi-processing boundary from prior epic.

## Dev Agent Record

### Agent Model Used

GitHub Copilot

### Debug Log References

- `python3 _bmad/scripts/resolve_customization.py --skill .agents/skills/bmad-dev-story --key workflow` failed because active Python lacks `tomllib`; manual workflow fallback was executed.
- `git rev-parse HEAD` -> `0f87ed45a0f61861fe1f46dd4abf4bbeec6dbd38`.
- `git diff --check -- _bmad-output/implementation-artifacts/8-1-launch-tevi-mini-app-sandbox-shell.md _bmad-output/implementation-artifacts/sprint-status.yaml` passed after in-progress bookkeeping.
- RED: `npm --workspace @china-slot-game/api test -- test/unit/tevi-client.test.ts` failed before `js/teviClient.js` existed.
- RED: `npm --workspace @china-slot-game/api test -- test/unit/tevi-client.test.ts test/unit/server-client.test.ts` failed before static shell and `slotGame.js` Tevi wiring existed.
- GREEN: `npm --workspace @china-slot-game/api test -- test/unit/tevi-client.test.ts test/unit/server-client.test.ts` passed with 25 tests.
- `node --check js/runtime-config.js && node --check js/teviClient.js && node --check js/slotGame.js` passed.
- RED: `npm --workspace @china-slot-game/api test -- test/integration/tevi-webhook-routes.test.ts` failed with 404 before `POST /api/webhooks/tevi` existed.
- GREEN: `npm --workspace @china-slot-game/api test -- test/integration/tevi-webhook-routes.test.ts` passed with 2 tests.
- `npm --workspace @china-slot-game/api run typecheck` passed after adding the Tevi webhook registration route.
- `npm --workspace @china-slot-game/api test -- test/integration/tevi-webhook-routes.test.ts test/unit/tevi-client.test.ts test/unit/server-client.test.ts` passed with 27 tests.
- Tevi webhook docs review completed against `https://docs.tevi.com/docs/webhook/overview` and `https://docs.tevi.com/docs/webhook/verification`; route tightened so non-challenge events fail closed until `X-Tevi-Signature` verification is implemented.
- RED: `npm --workspace @china-slot-game/api test -- test/integration/tevi-webhook-routes.test.ts` failed after revising the non-challenge event expectation from `202` to `501`.
- GREEN: `npm --workspace @china-slot-game/api test -- test/integration/tevi-webhook-routes.test.ts` passed after fail-closed route update.
- `npm --workspace @china-slot-game/api run typecheck` passed after the Tevi docs correction.
- `npm --workspace @china-slot-game/api test -- test/integration/tevi-webhook-routes.test.ts test/unit/tevi-client.test.ts test/unit/server-client.test.ts` passed with 27 tests after the Tevi docs correction.
- Production API webhook challenge check: `curl -i -X POST "https://china-slot-api.onrender.com/api/webhooks/tevi?challenge=tevi_test"` returned HTTP 200 `text/plain` body `tevi_test` with response request ID `req_b93337c8-8079-47ce-930d-1105f4b22a13`.
- RED: `npm --workspace @china-slot-game/api test -- test/integration/tevi-webhook-routes.test.ts` failed before safe webhook request logs existed.
- GREEN: `npm --workspace @china-slot-game/api test -- test/integration/tevi-webhook-routes.test.ts` passed after adding safe structured logs.
- `npm --workspace @china-slot-game/api run typecheck` passed after adding safe webhook request logs.
- `npm --workspace @china-slot-game/api test -- test/integration/tevi-webhook-routes.test.ts test/unit/tevi-client.test.ts test/unit/server-client.test.ts` passed with 27 tests after adding safe webhook request logs.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Implemented explicit Tevi runtime config with app/channel/app URL/webhook URL/environment fields while preserving `CHINA_SLOT_API_BASE_URL` and existing backend mode behavior.
- Added `window.ChinaSlotTeviClient` as a classic browser adapter that conditionally loads `https://static.tevicdn.com/helper_tevi.js`, detects `window.TeviJS`, exposes metadata/state, and wraps only safe Mini App helpers for this story.
- Wired the adapter into the static shell and initialized Tevi back/close/loadConfig affordances non-fatally from `slotGame.js`.
- Preserved local visual demo balance while making production/Tevi reward-bearing startup begin at `0` until backend session balance is available, preventing `defaultCoins:100000` from becoming a real Tevi balance.
- Added VM-based unit coverage for Tevi SDK conditional loading, SDK-unavailable behavior, safe helper wrappers, script ordering, metadata reporting, and backend-authoritative balance startup expectations.
- Added `POST /api/webhooks/tevi` as a Story 8.1 registration-only endpoint. It echoes Tevi `challenge` values for sandbox URL verification and rejects non-challenge event payloads with `501 TEVI_WEBHOOK_PROCESSING_NOT_IMPLEMENTED` until later stories add `X-Tevi-Signature` verification and money-path processing.
- Added safe structured webhook logs for challenge verification and rejected event payloads so Render can show that Tevi reached the API. Logs include request ID, challenge source/length, event name, and signature-header presence; they do not log payloads, challenge values, signatures, or secrets.
- Check Round status: local/demo separation is verified by automated tests. Sandbox app/channel evidence provided: `TEVI_APP_ID=AZX29173`, app URL `https://chinareel.pleagamehub.com/`, Tevi channel ID `2300210851`, channel URL `https://sbx.tevi.dev/@chinaslotgame`. Production API challenge evidence confirms `https://china-slot-api.onrender.com/api/webhooks/tevi` is deployed and echoes Tevi challenge values. Remaining external evidence: Tevi portal save/verification with required webhook scopes and in-sandbox `window.TeviJS` console/manual evidence.

### File List

- `_bmad-output/implementation-artifacts/8-1-launch-tevi-mini-app-sandbox-shell.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/src/app.ts`
- `apps/api/src/routes/tevi-webhook.routes.ts`
- `apps/api/test/integration/tevi-webhook-routes.test.ts`
- `apps/api/test/unit/server-client.test.ts`
- `apps/api/test/unit/tevi-client.test.ts`
- `index.html`
- `js/runtime-config.js`
- `js/slotGame.js`
- `js/teviClient.js`

### Change Log

- 2026-06-28: Created story context and marked ready for development.
- 2026-06-28: Implemented Tevi sandbox shell adapter, explicit runtime mode/config detection, static shell wiring, reward-bearing balance separation, and focused VM tests; Check Round portal evidence remains pending.
- 2026-06-28: Recorded provided Tevi sandbox app ID, app URL, channel ID, and channel URL; webhook registration/scopes and SDK sandbox console evidence remain pending.
- 2026-06-28: Added verification-only Tevi sandbox webhook registration endpoint at `POST /api/webhooks/tevi`; portal save/scopes and sandbox SDK console evidence remain pending.
- 2026-06-28: Reviewed Tevi webhook docs and tightened non-challenge webhook behavior to fail closed until signature verification is implemented in a later story.
- 2026-06-28: Recorded deployed production API webhook challenge verification for `https://china-slot-api.onrender.com/api/webhooks/tevi`; portal save/scopes and sandbox SDK console evidence remain pending.
- 2026-06-28: Added safe structured Tevi webhook request logs for Render visibility without logging payloads, challenge values, signatures, or secrets.

## QA Results
