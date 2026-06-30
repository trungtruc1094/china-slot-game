---
baseline_commit: b77f665
type: defect
priority: high
discovered_during: Story 8.7 Check Round (real Tevi mini-app sandbox play)
---

# Story 8.12 (Defect): Fix Tevi Mini-App Session Balance Load Race

Status: in-progress

<!-- Defect captured from live sandbox testing. Tracks root cause + fix plan so the change is referenceable. -->

## Problem (observed)

Playing the deployed game inside the **Tevi mini-app** (real sandbox, user `teviSubject: 3033448852`):

1. **Balance never loads.** On landing, the BALANCE HUD shows `...` and never resolves to a real number. Because `slotPlayer.coins` is never set from the server, the PreSpin check `totalBet > coins` is always true, so SPIN shows **"You don't have enough Stars."** / "you have no money" and the spin loop never starts.
2. **Deposit credits server-side but the UI never reflects it.** A 50-Star deposit succeeds end-to-end on the backend (`POST /api/v1/payments/top-up-signature 201` → Tevi → `POST /api/webhooks/tevi 200`, `[tevi-webhook] wallet credited … reasonCode: 'credited'`), but the in-game deposit dialog stays on **"Waiting for Tevi confirmation."** A full page refresh restarts the game back into state (1).

Net effect: the Tevi mini-app is currently unplayable even though the money path works server-side.

## Root Cause

### Primary (symptom 1) — balance load races the Tevi SDK init

In the Phaser scene `create()` ([js/slotGame.js](js/slotGame.js) lines 231-232):

```js
this.initializeTeviMiniAppShell();      // fires teviClient.initialize() — async, NOT awaited
this.initializeBackendSessionBalance(); // runs immediately, calls getUserAppToken()
```

- `initializeTeviMiniAppShell()` ([js/slotGame.js](js/slotGame.js) lines 394-406) kicks off `teviClient.initialize()` (which loads the Tevi SDK script) but is **not awaited**.
- `initializeBackendSessionBalance()` ([js/slotGame.js](js/slotGame.js) lines 408-428) runs synchronously next → `serverClient.startSession()` → `startTeviSession()` ([js/serverClient.js](js/serverClient.js) lines 261-276) → `teviClient.getUserAppToken()`.
- At that instant the SDK is not loaded, so `getUserAppToken` hits the `if (!sdk)` guard ([js/teviClient.js](js/teviClient.js) lines 96-97) and resolves `re-authentication-required` / `sdk-unavailable` immediately (or `sdk-timeout`).
- `startTeviSession()` throws ([js/serverClient.js](js/serverClient.js) lines 263-266) → `startSession()` rejects → `initializeBackendSessionBalance` lands in its catch ([js/slotGame.js](js/slotGame.js) lines 424-427). **No Tevi session is created, balance stays `...`, and nothing re-attempts once the SDK finishes loading.**

A manual **Deposit** tap happens seconds later, after the SDK has loaded, so *its* `getUserAppToken()` call (via `requestTopupSignature`, [js/serverClient.js](js/serverClient.js) line 329) succeeds — which is why the deposit works but the landing balance load does not. A page refresh re-runs the same race.

### Secondary (symptom 2) — no post-deposit balance refresh

The client top-up flow (Story 8.5) is intentionally terminal at `webhook-pending` and never polls for the credit ([js/slotGame.js](js/slotGame.js) lines 584-588, comment lines 504-506). Even after the primary fix, the deposit dialog will not auto-update when the webhook credits the wallet; the credited Stars only appear on the next spin/session load.

### Scope note

Neither symptom was introduced by Story 8.7 (which only added `currency`/`withdrawableBalance` to the spin response and Stars labels and did not touch the session-init ordering). This is a pre-existing defect in the Tevi session integration (Epics 8.2/8.3) exposed by real mini-app play; the gated tests use already-initialized in-memory sessions and so never hit the SDK-readiness race. Story 8.7 remains correctly `done`.

## Acceptance Criteria

1. **Given** the game launches inside the Tevi mini-app, **when** the scene initializes, **then** the backend balance load waits for `teviClient.initialize()` to resolve (SDK ready) before calling `getUserAppToken()` / `startTeviSession()`, so the Tevi session is created and the real wallet balance replaces the `...` placeholder.
2. If the SDK becomes ready late (slow load) or the first attempt fails transiently, the balance load **retries** rather than leaving the HUD stuck on `...` indefinitely. A genuine re-auth-required outcome surfaces a clear state (not a silent stall).
3. Local/demo (non-Tevi) startup behavior is **unchanged** — `initializeBackendSessionBalance()` still runs immediately via the generic `/api/sessions` path with no added init dependency.
4. **(Symptom 2)** After a `webhook-pending` deposit, the client refreshes the authoritative balance (poll or re-fetch) so the credited Stars appear in the HUD without requiring a manual spin, and the deposit dialog reflects the resolved state. Crediting remains server-authoritative — the client only reads the server balance, never mutates it locally.
5. A successful Tevi-mode loop is demonstrable: land → balance loads (e.g. 1000 + any prior credit) → SPIN debits/credits and updates balance → deposit 50 → balance reflects +50 without a full reload.

## Tasks / Subtasks (proposed — implement under dev-story)

- [x] **Sequence balance load after SDK init (AC1, AC3)**
  - [x] Have `initializeTeviMiniAppShell()` store its returned promise (e.g. `this.teviReady`). In `initializeBackendSessionBalance()`, when in Tevi mode, run the actual session/balance load from `this.teviReady.then(...)`; in local/demo mode keep the immediate path.
  - [x] Do not regress the existing `creditSumText = ' ...'` placeholder; just ensure it gets replaced once the session resolves.
- [x] **Add a bounded retry for late/failed SDK readiness (AC2)**
  - [x] If the first `startSession()` rejects with a transient/`sdk-unavailable`/`sdk-timeout` reason, retry once or twice with a short backoff after init resolves. A terminal `TEVI_REAUTH_REQUIRED` should set a visible re-auth state, not a silent `...`.
- [x] **Post-deposit balance refresh (AC4)**
  - [x] On `webhook-pending`, start a short bounded poll of the session/balance (reuse `startSession`/a balance read) until the credited amount lands or a timeout; update HUD + dialog. Keep it read-only and server-authoritative.
- [ ] **Manual Tevi-mode Check Round (AC5)** — _requires a live Tevi mini-app sandbox session; cannot be executed in this dev environment. Hand-off item for the user (see Completion Notes)._
  - [ ] Re-run the real sandbox flow: land → balance loads → spin works → deposit 50 → balance reflects +50. Capture before/after screenshots + BE logs. Confirm local/demo mode unchanged.
- [x] **Tests**
  - [x] Added client-facing unit coverage (AC1 SDK-ready ordering, AC2 transient retry + terminal re-auth surfacing, AC4 post-deposit refresh) to the VM-loaded client harness in `apps/api/test/unit/server-client.test.ts`; updated existing stubs for the refactored method surface.

### Review Findings

_Adversarial code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor), 2026-06-30. Diff: uncommitted changes vs baseline `b77f665`._

- [x] [Review][Patch] Post-deposit confirmation false-positive — `pollPostDepositBalance` keys "credited" off `points > baseline` where `baseline = Number(slotPlayer.coins)` ([js/slotGame.js:678](js/slotGame.js#L678), [js/slotGame.js:694](js/slotGame.js#L694)). When `baseline` is `NaN`/stale/`0` the `!Number.isFinite(baseline)` branch marks the *pre-credit* balance as "credited" on the first poll. **Resolution (decision):** apply minimal client-only fix now — establish the baseline from a server read and drop the `!Number.isFinite(baseline)` auto-success branch. The robust webhook-reference/status detection is deferred to Epic 10 (`10-3`). (sources: edge, blind)
- [x] [Review][Patch] Transient-vs-terminal retry classification — `isTerminalSessionReauth` ([js/slotGame.js:440](js/slotGame.js#L440)) treats `method-unavailable` and `sdk-call-failed` as retryable though they never recover. **Resolution (decision):** add `method-unavailable` and `sdk-call-failed` to the terminal list (fail fast); keep `sdk-timeout` retryable (`getUserAppToken` self-caps at 10s, so worst case is a bounded ~30s — acceptable vs. an infinite `...` stall). (sources: edge, blind)
- [x] [Review][Patch] Second `TEVI_REAUTH_REQUIRED` throw sets no `error.reason`, so a missing-session backend response is misclassified as transient (retried 3×) then surfaced as the generic "Backend unavailable / Reopen the game" instead of the re-auth state [js/serverClient.js:274-277](js/serverClient.js#L274-L277). Fix: set `sessionError.reason` (e.g. `"re-authentication-required"`) like the first throw does. (sources: edge, blind, auditor)
- [x] [Review][Defer] `refreshSession()` unconditionally nulls `session`/`sessionRequest` before `startSession()` [js/serverClient.js:285-300](js/serverClient.js#L285-L300) — a concurrent in-flight `startSession()` could be discarded (duplicate token-exchange) and `backendSpinStatus` is last-writer-wins. — deferred: latent only; the deposit modal blocks concurrent spins during `webhook-pending` and poll ticks are sequential. Revisit if the deposit flow becomes non-modal. (sources: edge, blind)
- [x] [Review][Defer] Post-deposit confirmation robust detection — match the webhook deposit reference/status instead of a balance delta (eliminates the residual false-negative when balance doesn't strictly rise). — deferred to Epic 10 `10-3` (richer deposit/cashout status UX), per the story's own scope note. (sources: edge, blind)
- [x] [Review][Defer] AC5 manual Tevi sandbox Check Round still unverified — the money path (land → balance → spin → deposit +50) must be run in a live sandbox before this story moves to `done`. Already tracked as the AC5 hand-off subtask. — deferred, by design (see Completion Notes). (sources: auditor, blind)
- [x] [Review][Defer] Timing tests stub `scheduleSceneDelay` to invoke its callback synchronously [apps/api/test/unit/server-client.test.ts], so the bounded-recursion caps (`maxAttempts`) and real async ordering of the retry/poll loops are never exercised against deferred scheduling. Test-quality improvement, not a runtime defect. — deferred, test-only. (sources: blind)

#### Dismissed as noise (7)

- `closePopUp(message)` callback "signature mismatch" — false positive; matches the established pattern used throughout the codebase ([js/slotGame.js:269-270](js/slotGame.js#L269), state_machine.js:46-56).
- `' ...'` / `' —'` placeholders bypass the Stars `★` formatter — cosmetic; these are loading/error placeholders, not balance values, and reading raw is intentional.
- "Reopen the game" messaging shown for the `retry` state — acceptable manual-recovery UX; no auto-retry consumer is promised.
- `user-cancelled` classified as terminal re-auth — reasonable product behavior.
- `refreshSession` failure path restores `session` but not `sessionRequest` — not a bug; the restored `session.sessionId` makes the next `startSession()` short-circuit correctly.
- `else`-branch in `initializeBackendSessionBalance` "reintroduces the SDK race" — not reachable; `initializeTeviMiniAppShell()` sets `this.teviReady` synchronously on the immediately preceding line ([js/slotGame.js:231-232](js/slotGame.js#L231)), and the retry loop is a backstop.
- `refreshSession` returning `null` mid-poll — benign; resolves to `NaN` points → bounded retry → timeout.

## Dev Notes

### Files likely to change

- [js/slotGame.js](js/slotGame.js) — `create()` ordering (231-233), `initializeTeviMiniAppShell()` (394-406), `initializeBackendSessionBalance()` (408-428), `handleTopupResult()` (580-591) for the post-deposit refresh.
- [js/serverClient.js](js/serverClient.js) — possibly expose a balance re-fetch helper; `startSession()`/`startTeviSession()` (244-276) for retry semantics.
- [js/teviClient.js](js/teviClient.js) — only if an explicit "SDK ready" promise is needed beyond `initialize()`.

### Verified-correct (do NOT change)

- Backend money path is sound: `/api/tevi/token` returns `session.balance.points` ([apps/api/src/domain/session-service.ts](apps/api/src/domain/session-service.ts) lines 164-181); the webhook credit committed (`reasonCode: 'credited'`). The bug is purely client-side init sequencing + missing refresh.

### References

- Discovered during Story 8.7 Check Round (real sandbox). Related: [8-5-run-sdk-top-up-with-pending-wallet-state.md](_bmad-output/implementation-artifacts/8-5-run-sdk-top-up-with-pending-wallet-state.md), [8-6-verify-tevi-webhooks-and-credit-stars-idempotently.md](_bmad-output/implementation-artifacts/8-6-verify-tevi-webhooks-and-credit-stars-idempotently.md), [docs/tevi-integration-playbook.md](docs/tevi-integration-playbook.md).
- Epic 10 `10-3-surface-payout-cashout-and-reconciliation-status-clearly` is the longer-term home for richer deposit/cashout status UX; AC4 here is the minimal "balance actually updates" slice needed for a playable sandbox now.

## Dev Agent Record

### Implementation Plan

Client-only fix in three slices, matching the root cause:

1. **AC1/AC3 — sequence after SDK init.** `initializeTeviMiniAppShell()` now stores the `teviClient.initialize()` promise as `this.teviReady`. `initializeBackendSessionBalance()` gates the session/balance load on `this.teviReady` **only in Tevi-session mode**; the generic `/api/sessions` (production-non-Tevi) and local/demo paths still load immediately with no init dependency. Extracted the actual load into `loadBackendSessionBalance(attempt)`.
2. **AC2 — bounded retry + visible terminal state.** `serverClient.startTeviSession()` now attaches the underlying `getUserAppToken` reason to the thrown `TEVI_REAUTH_REQUIRED` error so the client can tell a transient SDK-not-ready failure (`sdk-unavailable`/`sdk-timeout`/`method-unavailable`/`sdk-call-failed`) from a genuine re-auth (`token-missing`/`user-cancelled`). `loadBackendSessionBalance` retries transient failures up to 2× with a short backoff; on exhaustion or a terminal re-auth it calls `surfaceSessionBalanceFailure()`, which replaces the `' ...'` placeholder with `' —'` and shows a clear message instead of stalling.
3. **AC4 — post-deposit refresh.** Added a read-only `serverClient.refreshSession()` (bypasses the cached session, re-reads the server-authoritative balance via the existing Tevi token-exchange / sessions path). `handleTopupResult` starts `startPostDepositBalanceRefresh()` on `webhook-pending`; `pollPostDepositBalance` polls (bounded, ~8×2s) until the balance rises above the pre-deposit baseline, then updates the HUD via `setCoinsCount`/`changeCreditCoinsHandler` and moves the dialog to a new `credited` state. Crediting stays fully server-authoritative — the client only reads.

### Completion Notes

- **AC1, AC2, AC3, AC4 implemented and unit-tested.** New deterministic unit tests cover SDK-ready ordering, transient-retry-then-success, terminal re-auth surfacing, and the post-deposit balance refresh. Existing client stubs were updated for the refactored prototype-method surface.
- **Validation:** `apps/api` typecheck + lint clean; full `apps/api` suite = 323 passed / 55 skipped. The only failures (3, in `test/unit/db-runtime.test.ts` — migration file ordering/reversible-section checks) are **pre-existing and unrelated** to this change — confirmed failing on the baseline with these edits stashed. They do not touch `js/`.
- **AC5 (manual sandbox Check Round) NOT executed — hand-off to user.** It requires a live Tevi mini-app sandbox session (real `getUserInfo`/SDK + deposit webhook), which cannot run in this dev environment. To verify: open the deployed game in the Tevi mini-app, confirm the balance now resolves from `' ...'` to the real Stars amount on landing (no longer "no money"), SPIN debits/credits, then deposit 50 and confirm the HUD reflects +50 and the dialog shows "Deposit confirmed…" without a full reload. Capture before/after screenshots + BE logs, then flip the story to `done`. Story status is left at `review` pending this check.

### Debug Log

- Initial test run surfaced 3 regressions in `server-client.test.ts`: the bare `.call(game)` stubs lacked the new prototype methods (`isTeviSessionMode`, `loadBackendSessionBalance`, `startPostDepositBalanceRefresh`, …) the refactor introduced. Fixed by binding those methods onto the affected stubs (no production-code change needed).
- VM test context (`vm.createContext`) has no host `setTimeout`; new timing-sensitive tests inject a synchronous `scheduleSceneDelay` stub for determinism. `scheduleSceneDelay` falls back to `setTimeout` only in the real browser where `this.time.delayedCall` is the primary path.

## File List

- `js/slotGame.js` — modified: `initializeTeviMiniAppShell` stores `this.teviReady`; `initializeBackendSessionBalance` gates Tevi-mode load on SDK readiness; new `isTeviSessionMode`, `loadBackendSessionBalance`, `isTerminalSessionReauth`, `scheduleSceneDelay`, `surfaceSessionBalanceFailure`, `startPostDepositBalanceRefresh`, `pollPostDepositBalance`; `handleTopupResult` triggers the refresh; added `credited` topup status message.
- `js/serverClient.js` — modified: `startTeviSession` preserves the underlying re-auth reason on the thrown error; new read-only `refreshSession()` exposed on the client.
- `apps/api/test/unit/server-client.test.ts` — modified: updated 3 existing stubs for the new method surface; added 4 unit tests (AC1/AC2/AC4); extended `SlotGameCtor`/`TopupGame` types.
- `_bmad-output/implementation-artifacts/8-12-fix-tevi-mini-app-session-balance-load-race.md` — story tracking (this file).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status transitions.

## Change Log

- 2026-06-30: Defect captured from live Tevi mini-app sandbox testing during Story 8.7 Check Round. Root-caused the `...` balance stall to an SDK-init race in the scene `create()` ordering (balance load fires `getUserAppToken()` before `teviClient.initialize()` resolves), plus a secondary missing post-deposit balance refresh. Fix plan + ACs recorded; implementation pending dev-story.
- 2026-06-30: Implemented client-only fix (AC1–AC4): sequenced the Tevi balance load behind `teviClient.initialize()`, added a bounded transient retry with a visible terminal re-auth state, and added a server-authoritative post-deposit balance refresh poll. Added unit coverage; `apps/api` typecheck/lint clean and suite green except 3 pre-existing unrelated `db-runtime` failures. AC5 manual sandbox Check Round remains as a user hand-off. Status → review.
