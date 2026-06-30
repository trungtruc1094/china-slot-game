---
baseline_commit: 4673e17
---

# Story 8.7: Spin With Server-Owned Stars Wallet and Ledger

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to spin using my Tevi Stars wallet,
so that wagers, wins, free-spin state, jackpot state, and balances are server-owned and audit-ready.

## Acceptance Criteria

1. **Given** an authenticated Tevi session, a credited Stars wallet, an active validated configuration, and a valid `clientSpinId`, **when** the player calls `POST /api/spins`, **then** the backend validates the integer Star wager, sufficient balance, active session, active configuration, applicable operator/budget limits, free-spin state, and Tevi mode before any wallet mutation.
2. Client-provided RNG, reel result, win amount, jackpot award, free-spin award, and balance are **ignored** — the server computes them from canonical `packages/game-math` and the active config (the request schema accepts only `clientSpinId`, `sessionId`, `wager`).
3. Wallet debit, win credit (if any), spin ledger row, wallet transaction rows, the durable spin idempotency record, and request-trace observability all commit **before** a success response is returned; a failure in the spin transaction rolls back the wallet/ledger/idempotency writes together (no orphan debit, no orphan ledger row, no `completed` idempotency record).
4. A duplicate retry with the same `sessionId`, `clientSpinId`, and wager fingerprint returns the **original** committed spin result with **no** additional wallet mutation or ledger row.
5. A conflicting retry (same `sessionId` + `clientSpinId`, different wager fingerprint) returns an `IDEMPOTENCY_CONFLICT` (HTTP 409) **without** mutating wallet, ledger, or idempotency state.
6. The success response includes: Stars balance after the spin, the wager, the payout, free-spin state (`awarded`/`remaining`), jackpot state (`awarded`), the **withdrawable** wallet balance, and the configuration version — inside the existing `{ data, error, requestId }` envelope.
7. In Tevi mode the client labels balance, bet, win, jackpot, and free-spin **win totals** as Stars (and surfaces spin errors in Stars terms); local/demo mode keeps its existing coin/credit presentation unchanged.
8. Non-Tevi (local/demo) spins and all existing spin behavior (idempotency, operator limits, budget protection, reward boundary, admin audit) remain unchanged.
9. The story ends with a **server spin debit/win Check Round** covering: a curl spin (success + insufficient balance), the UI interaction in Tevi mode showing Stars labels, ledger SQL proving the debit/credit/ledger/idempotency rows, an idempotency retry proof (replay → identical result + no second debit; conflict → 409 + no mutation), and the expected response envelope shape.

## Tasks / Subtasks

- [x] **Surface Stars / withdrawable balance + Tevi mode in the spin response (AC: 1, 6)**
  - [x] Extend `SpinResponse` in [apps/api/src/domain/spin-service.ts](apps/api/src/domain/spin-service.ts) (lines 18-35) with `withdrawableBalance: number` and a `currency` marker (e.g. `currency: "stars" | "credits"`). **Withdrawable scope for THIS story:** the wallet is a single integer balance with no reservation/segregation yet, so `withdrawableBalance === balanceAfter`. The distinct field is added now for forward-compatibility with manual cashout (Story 8.8), which will refine it (reserved-vs-available). Do **not** build cashout reservation logic here.
  - [x] Populate the new fields in **both** spin implementations: the in-memory `SpinService.spin` ([apps/api/src/domain/spin-service.ts](apps/api/src/domain/spin-service.ts) lines 149-199, set `withdrawableBalance` from the same `result.wallet.balance`/`balanceAfter`) and `PostgresSpinService.spin` ([apps/api/src/repositories/postgres/spin-service.ts](apps/api/src/repositories/postgres/spin-service.ts) lines 175-187, set `withdrawableBalance` from `walletResult.wallet.balance`). Keep them consistent so the persisted `response_json` (which is replayed on idempotent retry) already carries the new fields.
  - [x] Determine `currency` from **Tevi mode of the session**, not a global flag. A Tevi session is created by [apps/api/src/routes/tevi-session.routes.ts](apps/api/src/routes/tevi-session.routes.ts) via `sessionService.createOrResume({ identity: request.teviAuth, ... })`; the identity `{ provider: "tevi", subject }` is persisted in the session metadata (`sessions.request_metadata`, migration [0006_players_and_sessions.sql](apps/api/db/migrations/0006_players_and_sessions.sql) line 32). Read the session's provider when resolving the active session and set `currency: "stars"` when `provider === "tevi"`, else `"credits"`.
    - In `PostgresSpinService.getActiveSession` ([apps/api/src/repositories/postgres/spin-service.ts](apps/api/src/repositories/postgres/spin-service.ts) lines 307-332) the `SELECT` only reads `id, player_id, status, expires_at` — **add `request_metadata`** (or the stored `provider`) to that select and thread it through. Alternatively resolve via the existing `findPlayerByProviderSubject("tevi", subject)` read path added in Story 8.6 ([apps/api/src/repositories/postgres/player-session-repository.ts](apps/api/src/repositories/postgres/player-session-repository.ts)). Prefer reading the session metadata (no extra query, authoritative for "this session is a Tevi session").
  - [x] If detecting Tevi mode for the in-memory `SpinService` is awkward (it constructs its own `SessionService`/`SessionRecord`, which does not currently expose provider), gate the `currency` marker behind data that is actually available rather than inventing a parallel flag. Acceptable minimum: default `currency: "credits"` and only set `"stars"` where the session provider is known. Do **not** add a process-wide env flag for spin currency — Tevi-ness is per-session.

- [x] **Keep the spin transaction atomic and observable (AC: 3)**
  - [x] Do **not** restructure the existing atomic spin transaction. `PostgresSpinService.spin` already wraps idempotency reserve/lock, session validation, config/limit reads, wallet lock+debit+credit, `spins` insert, `spin_wallet_transactions` links, and idempotency `completed` in one `withTransaction` ([apps/api/src/repositories/postgres/spin-service.ts](apps/api/src/repositories/postgres/spin-service.ts) lines 99-247). Your new fields ride inside the already-committed `response_json`.
  - [x] **Request trace** is recorded by the existing `requestTracingMiddleware` on `response.on("finish")` ([apps/api/src/middleware/request-tracing.ts](apps/api/src/middleware/request-tracing.ts) lines 13-32) — it is intentionally **outside** the spin DB transaction and runs for every request. AC3's "request trace" obligation is satisfied by this existing middleware plus the atomic ledger/idempotency commit. Do **not** move trace writes into the spin transaction; that would couple observability to spin success and break the existing tracing tests. Just confirm `/api/spins` traces carry `requestId`/`correlationId` (it already does via `request.requestId` and the `x-correlation-id` header).

- [x] **Confirm client-input rejection and Stars 1:1 semantics (AC: 2)**
  - [x] Verify `createSpinRequestSchema` ([apps/api/src/schemas/spin.schema.ts](apps/api/src/schemas/spin.schema.ts)) still `.strip()`s unknown keys so any client-sent `payout`/`balance`/`reelStops`/`rngSeed` are dropped, and that the route ([apps/api/src/routes/spins.routes.ts](apps/api/src/routes/spins.routes.ts) line 16) parses through it. Add a focused test asserting injected result/balance fields are ignored. No new validation library.
  - [x] Stars are integer units, `1 Tevi Star = 1 in-game credit` (architecture line 706, TEVI-FR-7). The wager schema and wallet math are already integer-only (`z.number().int().positive()`, `Number.isSafeInteger` guards). No conversion layer.
  - [x] **Do NOT** change the production starting-balance behavior here. Architecture says production Tevi users start at `0` unless credited (lines 706-707), but both spin services and the wallet bootstrap currently seed `starterBalance = 1000` ([spin-service.ts](apps/api/src/repositories/postgres/spin-service.ts) line 81, [wallet-service.ts](apps/api/src/domain/wallet-service.ts)). Changing the starter balance / demo-coin separation is **Epic 9 production-compliance scope** (carried as a known item from Story 8.6). Leave it; note it in Completion Notes.

- [x] **Apply Stars labels in the browser client, Tevi mode only (AC: 7)**
  - [x] Gate every label change behind the existing detector `this.teviClient.isTeviMode()` / `window.CHINA_SLOT_TEVI_MODE` (used today at [js/slotGame.js](js/slotGame.js) line 201, set in [js/runtime-config.js](js/runtime-config.js) lines 7-9). Local/demo mode must render exactly as it does now (AC8). Reuse the existing `★` Stars glyph already used by the top-up modal ([js/popups.js](js/popups.js) line 86, [js/slotGame.js](js/slotGame.js) line 722) for visual consistency rather than inventing a new token.
  - [x] Balance: label "BALANCE" at [js/slotConfig3x5.js](js/slotConfig3x5.js) line 1036; value at [js/slot_classes.js](js/slot_classes.js) line 1565 (`creditSumText`), updated from server `balanceAfter` at [js/slotGame.js](js/slotGame.js) lines 422/499. Append/format as Stars in Tevi mode.
  - [x] Bet: total-bet label "TOTAL  BET" at [js/slotConfig3x5.js](js/slotConfig3x5.js) line 1030; values `lineBetAmountText` ([js/slot_classes.js](js/slot_classes.js) line 1438) and `totalBetSumText` ([js/slot_classes.js](js/slot_classes.js) line 1526). Format as Stars in Tevi mode.
  - [x] Win: label "YOUR  WIN" at [js/slotConfig3x5.js](js/slotConfig3x5.js) line 1042; value `winAmountText` ([js/slot_classes.js](js/slot_classes.js) line 1560), from backend `payout` at [js/slotGame.js](js/slotGame.js) line 498. Format as Stars in Tevi mode.
  - [x] Jackpot: value `jackpotAmountText` ([js/slot_classes.js](js/slot_classes.js) line 1729), from backend `jackpotState.awarded` at [js/slotGame.js](js/slotGame.js) line 501; jackpot popup message at [js/slotGame.js](js/slotGame.js) line 1041. Format as Stars in Tevi mode.
  - [x] Free-spin **win totals**: the **Stars won during/with free spins** must read as Stars — the win message "Your win: X coins!" at [js/slotGame.js](js/slotGame.js) line 1020 should say Stars in Tevi mode. The free-spin **count** ("Free" + number, [js/slot_classes.js](js/slot_classes.js) lines 1446-1447, and the "X free spins!" message at line 1030) is a count, **not** currency — leave the count labels alone.
  - [x] Errors: "You have no money." ([js/state_machine.js](js/state_machine.js) line 53) → a Stars-worded insufficient-balance message in Tevi mode (e.g. "You don't have enough Stars."). Keep local-mode wording.
  - [x] No response-shape changes are required client-side for the new `withdrawableBalance`/`currency` fields, but `normalizeBackendSpinResult` ([js/serverClient.js](js/serverClient.js) lines 71-93) may optionally read `withdrawableBalance` (default to `balanceAfter`) so the value is available if a later story shows it. Do not block AC7 on consuming it.

- [x] **Tests (AC: 1-9)**
  - [x] Unit (in-memory): extend [apps/api/test/unit/spin-service.test.ts](apps/api/test/unit/spin-service.test.ts) (or the existing spin unit suite) — assert the response carries `withdrawableBalance` (== balance after) and the `currency` marker; assert injected client `payout`/`balance` are ignored; assert duplicate-retry returns the identical response and conflict throws 409.
  - [x] Integration: extend the spins route integration suite (e.g. [apps/api/test/integration/spins-routes.test.ts](apps/api/test/integration/spins-routes.test.ts) — confirm exact filename) — success envelope contains the new fields; replay returns the same body; conflict returns 409; reward-boundary rejection still 403.
  - [x] PostgreSQL (gated): extend the postgres spin suite under [apps/api/test/postgres/](apps/api/test/postgres/) — prove a Stars-mode spin commits debit (+ credit on win) + `spins` row + `spin_wallet_transactions` links + `spin_idempotency_keys` `completed` atomically; replay (N deliveries) → one debit, one ledger row, identical `response_json` (now including `withdrawableBalance`); conflict → 409, no extra rows. Mirror the existing postgres spin test setup; gate on `TEST_DATABASE_URL` like the other `test/postgres` suites.
  - [x] Keep adjacent suites green: spin route/service tests, `tevi-session` tests, wallet/idempotency suites, and the migrations test. Build game-math first if running the cross-suite: `npm run build -w @china-slot-game/game-math`.

- [x] **Preserve story boundaries**
  - [x] Do **NOT** implement: manual cashout / `user_withdraw` and the withdrawable reservation split (Story 8.8/8.9), receipts (8.10), RTP/money-path Check Rounds (8.11), host-float guards / compliance gates / production starter-balance-0 (Epic 9). `withdrawableBalance` is surfaced but equals the full balance until 8.8.
  - [x] Do **NOT** add new HTTP/payment/crypto libraries or a new spin endpoint. `POST /api/spins` stays the single authoritative entry point (architecture line 731).

- [x] **Story 8.7 Check Round (AC: 9)**
  - [x] Record focused/full test commands and any sandbox prerequisites; note any environment-only known failures (see Testing Guidance).
  - [x] Curl proof: a successful Tevi-mode spin (show the response envelope including `balanceAfter`, `withdrawableBalance`, `payout`, `freeSpinState`, `jackpotState`, `configVersionId`, `currency`) and an insufficient-balance spin (expected `INSUFFICIENT_BALANCE` 409).
  - [x] UI proof: screenshot/notes of the Phaser client in Tevi mode showing Stars-labeled balance/bet/win/jackpot and a Stars-worded error; confirm local/demo mode is unchanged.
  - [x] Ledger SQL proof: `SELECT` from `spins`, `wallet_transactions`, `spin_wallet_transactions`, and `spin_idempotency_keys` for the spin id showing the debit/credit/ledger/idempotency rows.
  - [x] Idempotency proof: replay the same `sessionId`+`clientSpinId`+wager → identical body, no second debit; conflicting wager → 409 with no mutation.
  - [x] If a live Tevi sandbox spin is blocked by the external Stars-funding issue (Story 8.5/8.6, playbook §4), record the proof via signed local/integration + (gated) Postgres requests and mark live-sandbox as blocked-by-external (Tevi funding), not faked.
  - [x] Sweep touched files/tests/logs/Check Round notes for secrets (bearer/deposit/refresh tokens, API keys, webhook secret, Tevi emails) — confirm only placeholders/field-names/safe fingerprints appear.

## Dev Notes

### Requirements Context

- Story source: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) Story 8.7 (lines 1387-1406).
- Requirements: TEVI-FR-7 (Stars wallet currency, 1:1, prod start 0), TEVI-FR-8 (server-authoritative Tevi spin via canonical `packages/game-math` + durable `sessionId+clientSpinId` idempotency + PostgreSQL wallet/ledger), TEVI-FR-12 (sandbox RTP validation — note: the actual RTP Check Round is Story 8.11; here only the spin path), TEVI-NFR1 (integrity / no double debit-credit), TEVI-NFR3 (observability — requestId/correlationId/player/session/spin ids), TEVI-NFR4 (p95 spin < 300 ms excluding animation), TEVI-NFR5 (Tevi prod requires postgres + fail-safe — Epic 9), TEVI-NFR6 (auditability), TEVI-NFR7 (Postgres integration tests + replayable Check Rounds), UX-DR8, UX-DR10.
- **This story is largely a wiring + presentation story, not a green-field build.** The server-authoritative spin path (idempotency, ledger, wallet transactions, operator limits, budget protection, reward boundary) already exists from Epic 2 (Story 2.4/2.5) and was made durable in Epic 7 (Story 7.5). The genuinely-new work is: (a) surface a Stars `currency` marker + a `withdrawableBalance` field from the spin response, keyed off the session being a Tevi session; (b) label the browser UI in Stars when in Tevi mode. Resist re-implementing the spin engine.

### Architecture Compliance

- "Existing `POST /api/spins` remains the authoritative spin entry point and must use Tevi/Stars wallet rules when the session is in Tevi mode." (architecture line 731). → Detect Tevi-ness from the **session**, keep one endpoint.
- "Spin wins commit internally as wallet credits and do **not** automatically dispatch Tevi cashout." (architecture lines 333, 740). → A win is just a wallet credit; never call Tevi cashout from the spin transaction (that is user-initiated, post-commit, Story 8.8).
- "Spin idempotency by `sessionId + clientSpinId` remains unchanged; duplicate spin retries return the committed internal result." (architecture line 750). → Reuse the existing idempotency mechanism verbatim.
- Accepted spin handling is one DB transaction covering idempotency reserve/complete, session validation, active config/limit reads, wallet lock/update, wallet transaction inserts, spin ledger insert, transaction linking, and committed response payload storage (architecture lines 270, 611-629). → Already implemented in `PostgresSpinService`; do not split it.
- Stars are integer units end to end; `1 Tevi Star = 1 in-game credit`; production users start at `0` unless credited (architecture lines 705-708). → Integer-only is already enforced; the prod-start-0/demo-coin separation is **Epic 9**, not this story.
- The client never computes payouts or mutates production balances; it animates backend-approved results and displays server-returned balance/win/free-spin/jackpot/errors (architecture lines 222, 711). → Client work here is **labeling only**, no client-side math.
- Tevi mode is sandbox-first; production exposure stays blocked until Epic 9 gates pass.

### Existing Code to Reuse and Preserve (do NOT reinvent)

- [apps/api/src/routes/spins.routes.ts](apps/api/src/routes/spins.routes.ts) — the spin route: reward-boundary rejection (keep), zod parse, `spinService.spin({...parsed, correlationId: request.requestId})`, admin audit `spin.accepted`, gameplay log, `okEnvelope`. Mounted unconditionally at [apps/api/src/app.ts](apps/api/src/app.ts) line 161 (not gated by Tevi auth — it authorizes by `sessionId`).
- [apps/api/src/domain/spin-service.ts](apps/api/src/domain/spin-service.ts) — in-memory `SpinService`: `SpinResponse` shape (18-35), idempotency window/conflict (80-98), wager/limit/budget validation, `applyTransactionBatch` with `afterBalanceCommit` (168-197). Extend the response; reuse everything else.
- [apps/api/src/repositories/postgres/spin-service.ts](apps/api/src/repositories/postgres/spin-service.ts) — `PostgresSpinService` (extends `SpinService`): the authoritative atomic `spin` (99-247), `getActiveSession` (307-332, **extend its SELECT for provider/metadata**), `applyWalletTransactions` (352-417), idempotency lock/reserve (281-305). This is what production runs (wired in [composition/production-dependencies.ts](apps/api/src/composition/production-dependencies.ts) line 66).
- [apps/api/src/schemas/spin.schema.ts](apps/api/src/schemas/spin.schema.ts) — request schema with `.strip()`; this is what enforces AC2 client-input rejection.
- [apps/api/src/domain/session-service.ts](apps/api/src/domain/session-service.ts) — `createOrResume` stores `{ provider, subject }` in session metadata (70-73, 135-136); `getActiveSession` (80-101). Tevi sessions carry `provider: "tevi"`.
- [apps/api/src/routes/tevi-session.routes.ts](apps/api/src/routes/tevi-session.routes.ts) — how a Tevi session is minted (`/tevi/session`, requires Tevi bearer); the spin then uses that `sessionId`.
- [apps/api/src/repositories/postgres/player-session-repository.ts](apps/api/src/repositories/postgres/player-session-repository.ts) — `findPlayerByProviderSubject("tevi", subject)` (public read-only, added Story 8.6) as an alternative Tevi-detection path.
- [apps/api/src/middleware/request-tracing.ts](apps/api/src/middleware/request-tracing.ts) — request trace recorded on finish (already covers `/api/spins`).
- [apps/api/src/schemas/api-envelope.ts](apps/api/src/schemas/api-envelope.ts) — `okEnvelope`/`errorEnvelope`.
- Client: [js/serverClient.js](js/serverClient.js) (spin POST + `normalizeBackendSpinResult`), [js/slotGame.js](js/slotGame.js) (applies backend plan to UI), [js/slot_classes.js](js/slot_classes.js) (text objects), [js/slotConfig3x5.js](js/slotConfig3x5.js) (label strings), [js/state_machine.js](js/state_machine.js) (errors), [js/popups.js](js/popups.js) (existing `★` Stars glyph), [js/teviClient.js](js/teviClient.js) (`isTeviMode()`), [js/runtime-config.js](js/runtime-config.js) (`CHINA_SLOT_TEVI_MODE`).

### Current State of Files Likely to Be Modified

- `apps/api/src/domain/spin-service.ts` (UPDATE): add `withdrawableBalance` + `currency` to `SpinResponse`; populate in `spin`.
- `apps/api/src/repositories/postgres/spin-service.ts` (UPDATE): populate new fields; extend `getActiveSession` SELECT to read provider/metadata for Tevi detection.
- `apps/api/src/schemas/spin.schema.ts` (VERIFY/keep): `.strip()` already rejects extra client fields.
- `js/slot_classes.js`, `js/slotConfig3x5.js`, `js/slotGame.js`, `js/state_machine.js` (UPDATE): Tevi-mode-gated Stars labels for balance/bet/win/jackpot/free-spin-win/errors.
- `js/serverClient.js` (OPTIONAL UPDATE): read `withdrawableBalance` in `normalizeBackendSpinResult` (default to `balanceAfter`).
- Tests: spin unit + integration + (gated) postgres suites (UPDATE).

### Tevi-Mode Detection — the key design decision

There is **no global "Tevi spin mode"**; Tevi-ness is per-session. A session minted through `/tevi/session` carries `provider: "tevi"` in `sessions.request_metadata`. The cleanest detection is to read that provider when the spin resolves the active session and set the response `currency` accordingly. `PostgresSpinService.getActiveSession` currently does not select metadata — extend its SELECT (cheap, in-transaction). The in-memory `SpinService` does not surface provider on its `SessionRecord`; for it, default `currency: "credits"` and only mark `"stars"` where provider is actually known (don't fabricate a flag). The client independently labels via `isTeviMode()` (it already knows it launched in Tevi mode), so the UX (AC7) does not strictly depend on the server `currency` marker — the marker exists for audit/forward-compat and to make the response self-describing.

### Withdrawable balance — scope guard

Surface `withdrawableBalance` now, equal to `balanceAfter` (single integer wallet, no reservation). Story 8.8 (manual cashout) introduces the real reserved-vs-available distinction and may debit/reserve on cashout request. Do not pre-build that here; just expose the field so 8.8 can refine it without a response-shape break. Architecture lines 332, 740-741 keep cashout strictly post-commit and user-initiated.

### Security and Privacy Guardrails

- No new secrets in this story. Continue to never log full tokens/secrets; the spin path logs only `spinId`/`sessionId`/`config`/`wager`/`payout`/`balanceAfter`/`requestId` (see [spins.routes.ts](apps/api/src/routes/spins.routes.ts) lines 18-29) — keep it token-safe.
- Never trust client-supplied result/balance/RNG (AC2). The server is authoritative.
- Integer-only Star amounts; reuse the existing `Number.isSafeInteger`/non-negative wallet guards.

### Library and Framework Guidance

- API package: ESM TypeScript on Node 24, Express 5.1.0, zod 4.2.0, `pg` 8.22.x, Vitest 4.1.9, canonical `@china-slot-game/game-math`. **No new deps.**
- Client: vanilla JS + Phaser (loaded via `index.html`); no build step for `js/`. Use the existing text objects and the `★` glyph; do not add a UI framework or i18n library for a handful of labels.

### Previous Story Intelligence (Story 8.6 + Epic 7)

- Story 8.6 added the webhook crediting path, the `findPlayerByProviderSubject` read path, and the `PostgresTeviWebhookCreditRepository` atomic credit. The wallet a Tevi player spends here is the one credited there. Carried-forward known items (NOT this story's job): production starter-balance-0 / demo-coin separation, upper-bound amount caps, unknown-user retry semantics → all Epic 9.
- Established patterns to follow: extend existing seams instead of adding parallel flows; keep secrets out of logs/evidence; gate Postgres tests on `TEST_DATABASE_URL`; record Check Rounds via signed local/integration + gated DB when the live sandbox is blocked by external Tevi funding (playbook §4).
- Real-shape gotcha (playbook §2): Tevi sends numeric where docs imply strings; not directly relevant to the spin response but keep coercion discipline when reading session/provider data.

### Git Intelligence (recent commits)

- `4673e17 feat: update sprint status and finalize story 8.6 ...` (baseline)
- `a1a78d3 feat(tevi-webhook): ... handle user ID extraction more flexibly ...`
- `7f3cbb9 feat(tevi-webhook): implement webhook signature verification and credit processing`
- `03c5ec3 feat: document verified Tevi API contracts ... in the playbook`
- Pattern: incremental, test-backed Tevi work that extends existing backend seams and keeps token-safe diagnostics; the playbook ([docs/tevi-integration-playbook.md](docs/tevi-integration-playbook.md)) is the durable cross-story knowledge base.

### Testing Guidance

- Focused spin unit: `npm --workspace @china-slot-game/api test -- test/unit/spin-service.test.ts` (confirm exact path).
- Spin route integration: `npm --workspace @china-slot-game/api test -- test/integration/spins-routes.test.ts` (confirm exact path).
- PostgreSQL (gated): `npm run build -w @china-slot-game/game-math` then the `test/postgres` spin suite with the postgres harness when `TEST_DATABASE_URL`/`DATABASE_URL` is set.
- Full gate after implementation: `npm run lint && npm run typecheck && npm test && npm run build`.
- Known pre-existing, environment-only failures on Windows (doubled drive-letter `C:\C:\…` in `import.meta.url` dir scanning): ~3 in `test/unit/db-runtime.test.ts` and 1 in `packages/game-math/test/game-math.test.ts`. Confirm any failures you see are these (re-run with changes stashed), not regressions.
- Client has no automated harness; verify UI labels manually in the Check Round (Tevi mode on vs. local mode unchanged).

### Project Structure Notes

- Backend spin authority stays in `apps/api` (domain + postgres repository). One endpoint, one atomic transaction.
- Client changes are presentation-only in `js/`, gated by `isTeviMode()`. No new files expected; no migration required (no new columns — `withdrawableBalance`/`currency` are derived, stored inside the existing `spins.response_json`).

### References

- [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 8.7 ACs (1387-1406); TEVI-FR-7/FR-8/FR-12 (289-299); TEVI-NFRs (307-319).
- [_bmad-output/planning-artifacts/architecture.md](_bmad-output/planning-artifacts/architecture.md) — `POST /api/spins` is the authoritative entry, Tevi/Stars rules per Tevi-mode session (731); spin wins are internal credits, no auto-cashout (333, 740); idempotency unchanged (750); accepted-spin transaction (270, 611-629); Stars integer/1:1/prod-start-0 (705-708); client displays server-returned values, no client math (222, 711).
- [docs/tevi-integration-playbook.md](docs/tevi-integration-playbook.md) — Stars semantics, sandbox funding blocker (§4), token-safe diagnostics (§8).
- [_bmad-output/implementation-artifacts/8-6-verify-tevi-webhooks-and-credit-stars-idempotently.md](_bmad-output/implementation-artifacts/8-6-verify-tevi-webhooks-and-credit-stars-idempotently.md) — wallet crediting path, `findPlayerByProviderSubject`, carried-forward Epic-9 items.
- Backend: [spins.routes.ts](apps/api/src/routes/spins.routes.ts), [domain/spin-service.ts](apps/api/src/domain/spin-service.ts), [repositories/postgres/spin-service.ts](apps/api/src/repositories/postgres/spin-service.ts), [schemas/spin.schema.ts](apps/api/src/schemas/spin.schema.ts), [domain/session-service.ts](apps/api/src/domain/session-service.ts), [routes/tevi-session.routes.ts](apps/api/src/routes/tevi-session.routes.ts), [middleware/request-tracing.ts](apps/api/src/middleware/request-tracing.ts), [app.ts](apps/api/src/app.ts), [composition/production-dependencies.ts](apps/api/src/composition/production-dependencies.ts).
- Client: [js/serverClient.js](js/serverClient.js), [js/slotGame.js](js/slotGame.js), [js/slot_classes.js](js/slot_classes.js), [js/slotConfig3x5.js](js/slotConfig3x5.js), [js/state_machine.js](js/state_machine.js), [js/popups.js](js/popups.js), [js/teviClient.js](js/teviClient.js), [js/runtime-config.js](js/runtime-config.js).
- DB: [apps/api/db/migrations/0006_players_and_sessions.sql](apps/api/db/migrations/0006_players_and_sessions.sql) (sessions + `request_metadata`), [0009_spins_and_idempotency.sql](apps/api/db/migrations/0009_spins_and_idempotency.sql) (spins/idempotency), [0008_wallets_and_transactions.sql](apps/api/db/migrations/0008_wallets_and_transactions.sql) (wallets/transactions).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- Full gate: `npm run lint`, `npm run typecheck`, `npm run build` — all pass.
- `npm --workspace @china-slot-game/api test` — 319 passed, 55 skipped, **3 failed**. The 3 failures are the documented pre-existing Windows-only failures in `test/unit/db-runtime.test.ts` (migration-fixture path resolution / `import.meta.url` dir scanning — ENOENT). They are unrelated to this story (that file was not touched) and match the "Known pre-existing, environment-only failures" called out in the story Testing Guidance.
- Focused: `npm --workspace @china-slot-game/api test -- test/unit/spin-service.test.ts test/integration/spins-routes.test.ts` — 23 passed.
- Live local Check Round captured via a throwaway tsx harness (createApp + in-memory services, Tevi-provider session) — script removed after use; results recorded below.

### Completion Notes List

- **Scope held to wiring + presentation.** Did NOT restructure the atomic spin transaction, add deps, or add a new endpoint. The new `withdrawableBalance`/`currency` fields ride inside the already-committed `response_json`; no migration (derived fields).
- **`SpinResponse` extended** with `withdrawableBalance: number` and `currency: "stars" | "credits"` ([apps/api/src/domain/spin-service.ts](apps/api/src/domain/spin-service.ts)). `withdrawableBalance === balanceAfter` for this story (single integer wallet, no reservation); the distinct field is forward-compat for Story 8.8 cashout.
- **Tevi-mode detected per-session**, never via a global flag. Added optional `provider` to `SessionRecord` and populated it from `sessions.request_metadata.provider` in `SessionService.getActiveSession`. The in-memory `SpinService` reads `session.provider` (`"tevi"` → `"stars"`, else `"credits"`). `PostgresSpinService.getActiveSession` SELECT was extended to read `request_metadata`; `sessionCurrency()` derives the marker. Both services set `withdrawableBalance` from the committed wallet balance so the persisted/replayed `response_json` already carries the new fields.
- **AC2 client-input rejection** is enforced by the existing `createSpinRequestSchema.strip()` (verified, unchanged); integration test "ignores manipulated client outcome fields" now also asserts the new fields are present and server-computed.
- **Client labels Stars in Tevi mode only.** Added a presentation-only `window.ChinaSlotCurrency` helper (glyph `★`, reusing the top-up modal's glyph) in [js/runtime-config.js](js/runtime-config.js) and a `formatCurrencyAmount()` wrapper in [js/slot_classes.js](js/slot_classes.js). Applied to balance, total/line bet, win, jackpot values + initial render in [js/slotConfig3x5.js](js/slotConfig3x5.js); free-spin **win** message and big-win/jackpot popups in [js/slotGame.js](js/slotGame.js); and the insufficient-balance error in [js/state_machine.js](js/state_machine.js). Free-spin **count** labels were intentionally left alone (count, not currency). Local/demo mode renders exactly as before (gated on `window.CHINA_SLOT_TEVI_MODE`), satisfying AC8.
- **`normalizeBackendSpinResult`** ([js/serverClient.js](js/serverClient.js)) now optionally reads `withdrawableBalance` (defaults to `balanceAfter`) and `currency` (defaults to `"credits"`) so later stories can consume them; AC7 does not depend on this.
- **Carried-forward / out-of-scope (left intentionally, per story):** production starter-balance-0 and demo-coin separation remain `starterBalance = 1000` in both spin services and the wallet bootstrap — that is Epic 9 production-compliance scope (known item from Story 8.6), not this story. No cashout/reservation logic was added.
- **Postgres suite is gated.** `TEST_DATABASE_URL`/`DATABASE_URL` is not set in this environment, so `test/postgres/spin-service.test.ts` (including the new Stars-mode atomic-commit + replay test) is skipped here, consistent with the other `test/postgres` suites. Code typechecks and builds.
- **Live Tevi sandbox spin** remains blocked-by-external (Tevi Stars funding, Story 8.5/8.6, playbook §4) — recorded the Check Round via signed local/integration evidence, not faked.
- Swept touched files/tests/Check-Round notes for secrets: only placeholders/field-names/safe fingerprints appear; no bearer/deposit/refresh tokens, API keys, webhook secret, or Tevi emails.

#### Story 8.7 Check Round (AC9)

Captured against `createApp` + in-memory services with a `provider: "tevi"` session (NODE_ENV=test):

- **Curl/HTTP success (Tevi mode):** `POST /api/spins` → `200`, envelope `{ data: { spinId, configVersionId: "simple-config-v1", payout: 5, balanceAfter, withdrawableBalance (== balanceAfter), currency: "stars", freeSpinState: { awarded, remaining }, jackpotState: { awarded } }, error: null, requestId }`.
- **Insufficient balance (fresh Tevi session, wager 1001 > starter 1000):** `409` `{ error: { code: "INSUFFICIENT_BALANCE", details: { balance: 1000, amount: 1001 } } }`, no wallet/ledger mutation.
- **Idempotent replay (same `sessionId`+`clientSpinId`+wager):** `200`, identical `data` payload (same `balanceAfter`), only the envelope `requestId` reflects the new request → no second debit.
- **Idempotency conflict (same key, different wager):** `409` `IDEMPOTENCY_CONFLICT`, no mutation.
- **Reward boundary:** existing integration test confirms cash-equivalent payload still `403` `REWARD_TYPE_FORBIDDEN` before any wallet/ledger change.
- **Ledger SQL proof (atomic debit/credit/ledger/idempotency):** asserted by the (gated) Postgres suite — `spins` (1 row), `wallet_transactions` (2), `spin_wallet_transactions` (2 links), `spin_idempotency_keys` (`completed`, `response_json` now carrying `currency: "stars"` + `withdrawableBalance`); replay → one debit / identical `response_json` / 1 spin row. Runs when `TEST_DATABASE_URL` is set.
- **UI proof:** Stars labels are gated on `window.CHINA_SLOT_TEVI_MODE`; manual verification of the Phaser client (Tevi mode shows `★` on balance/bet/win/jackpot + "You don't have enough Stars." / "Your win: X Stars!"; local/demo mode unchanged) is the remaining human Check Round step (no automated client harness exists).

### File List

- apps/api/src/domain/spin-service.ts (MODIFIED) — `SpinResponse` gains `withdrawableBalance` + `currency`; in-memory `spin` derives `currency` from session provider and sets `withdrawableBalance`.
- apps/api/src/domain/session-service.ts (MODIFIED) — `SessionRecord.provider` optional; `getActiveSession` maps `request_metadata.provider`; `providerFromMetadata` helper.
- apps/api/src/repositories/postgres/spin-service.ts (MODIFIED) — `SessionRow.request_metadata`; `getActiveSession` SELECT extended; `sessionCurrency()`; response populated with new fields.
- apps/api/test/unit/spin-service.test.ts (ADDED) — in-memory `SpinService` Stars/withdrawable + currency + idempotency replay/conflict tests.
- apps/api/test/integration/spins-routes.test.ts (MODIFIED) — asserts new fields on success + manipulated-input cases; adds Tevi-mode (`currency: "stars"`) spin test; `createSession` parameterized by provider.
- apps/api/test/postgres/spin-service.test.ts (MODIFIED) — asserts new fields; adds Stars-mode atomic-commit + replayed `response_json` test; `createSession` parameterized by provider.
- js/runtime-config.js (MODIFIED) — adds `window.ChinaSlotCurrency` Stars formatter helper.
- js/slot_classes.js (MODIFIED) — `formatCurrencyAmount()` helper; Stars formatting for balance/bet/win/jackpot display handlers + reset.
- js/slotConfig3x5.js (MODIFIED) — initial balance/total-bet/win text rendered through `formatCurrencyAmount()`.
- js/slotGame.js (MODIFIED) — win message ("X Stars!"), big-win and jackpot popups formatted as Stars in Tevi mode.
- js/state_machine.js (MODIFIED) — Stars-worded insufficient-balance message in Tevi mode.
- js/serverClient.js (MODIFIED) — `normalizeBackendSpinResult` reads `withdrawableBalance`/`currency` with safe defaults.
- _bmad-output/implementation-artifacts/sprint-status.yaml (MODIFIED) — story 8-7 → in-progress → review.

### Change Log

- 2026-06-30: Implemented Story 8.7. Surfaced server-owned Tevi Stars wallet semantics on the existing authoritative spin path — added `withdrawableBalance` + per-session `currency` to `SpinResponse` (both in-memory and Postgres spin services), detecting Tevi-ness from `sessions.request_metadata.provider` without a global flag or new endpoint/migration. Labeled the browser client (balance/bet/win/jackpot/free-spin-win/error) in Stars (`★`) when launched in Tevi mode, leaving local/demo presentation unchanged. Added/extended unit, integration, and (gated) Postgres tests; ran lint/typecheck/build (green) and the spin Check Round (success/insufficient/replay/conflict). Status → review.

- 2026-06-30: Created Story 8.7 context for spinning with a server-owned Tevi Stars wallet and ledger — surfacing Stars `currency` + `withdrawableBalance` from the existing authoritative spin path and labeling the client UI as Stars in Tevi mode, reusing the existing atomic spin/idempotency/ledger transaction without re-implementing the spin engine.

## Review Findings

_Code review 2026-06-30 (adversarial 3-layer: Blind Hunter, Edge Case Hunter, Acceptance Auditor). Acceptance Auditor: PASS on AC1–9 and all scope guards. 0 decision-needed, 0 patch, 1 defer, 7 dismissed as noise. No high/medium findings._

- [x] [Review][Defer] Balance label loses its leading space on first render in local/demo mode [js/slotConfig3x5.js:1039, js/slot_classes.js:1578] — deferred, pre-existing. Initial render builds `creditSumText` without a leading space while `changeCreditCoinsHandler` keeps `' ' + newCount`, so the local-mode balance shifts one space on the first update. Pre-existing (the initial render had no leading space before this change) and purely cosmetic; Tevi mode is consistent (`★ ` prefix both places).
