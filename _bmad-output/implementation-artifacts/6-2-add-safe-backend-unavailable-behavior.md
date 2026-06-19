# Story 6.2: Add Safe Backend-Unavailable Behavior

Status: done
baseline_commit: 5ee707a5cf056bfbe2157e6ce79896ef23fadd65

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want reward-bearing play to stop safely when the backend is unavailable,
so that no local-only reward outcomes are created.

## Acceptance Criteria

1. Given production mode is enabled, when the backend is unavailable or session validation fails, then the client disables reward-bearing spin actions and shows a clear recoverable state.
2. Local demo mode remains available only if explicitly enabled for visual development.
3. No client-side balance or payout mutation occurs during backend outage.
4. Backend timeout, HTTP 5xx, network failure, and mid-spin backend failure are explicit and tested.
5. User-facing error messages are non-leaky and do not expose stack traces, request IDs, session IDs, or internal implementation details.

## Tasks / Subtasks

- [x] Harden browser server-client failure handling (AC: 1, 3, 4, 5)
  - [x] Treat network failures, backend timeouts, 5xx responses, and malformed/failed session creation as retryable production failures.
  - [x] Do not synthesize successful spin results in production without backend confirmation.
  - [x] Return a safe recoverable state that callers can use to disable reward-bearing spin controls.
- [x] Preserve authoritative wallet/balance state on backend failure (AC: 3, 4)
  - [x] Ensure failed production spins do not mutate client balance, payout, free-spin, jackpot, or render-plan state.
  - [x] Test wallet/render state remains unchanged after a backend failure mid-spin.
- [x] Keep demo mode explicit and separate (AC: 2)
  - [x] Preserve local demo outcomes only for explicit demo mode.
  - [x] Ensure production failure paths never fall back to local demo outcomes.
- [x] Document public client contract and error cases (AC: 1, 4, 5)
  - [x] Document production `spin` success, retry/failure response shape, and demo-mode behavior.
  - [x] Document timeout, 5xx, network failure, and session failure cases.
  - [x] Document non-leaky message rules.
- [x] Add tests and run gates (AC: all)
  - [x] Test timeout, 5xx, network failure, session failure, no optimistic success, wallet state preservation after mid-spin failure, explicit demo mode, and non-leaky messages.
  - [x] Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
  - [x] Update Dev Agent Record, File List, Change Log, and final status.

## Dev Notes

- Binding Epic 5 retro findings:
  - Keep support/API contracts and error cases explicit in story notes.
  - Launch readiness must distinguish local passing behavior from production-safe behavior.
- Previous story intelligence from 6.1:
  - Production reward-bearing paths must be server-side authoritative.
  - Existing reward metadata is non-cash and must not create redeemable/cash states during failure handling.
  - Unified audit remains canonical where server-side audit is relevant, but 6.2 is primarily client safe-failure behavior.
- Assumptions:
  - `js/serverClient.js` is the integration seam for browser production/demo behavior.
  - Production mode means reward-bearing play; demo mode is visual-development only and must be explicitly configured.
  - Safe failure should be represented as a retryable state rather than a fake spin result.
- Public client contract to implement and preserve:
  - `createBackendClient({ mode: "production", ... }).spin(request)` returns a normalized backend spin result only after successful `/api/sessions` and `/api/spins` responses.
  - On timeout, network failure, HTTP 5xx, failed session validation, or failed spin response, production spin resolves or rejects in a way that callers can convert to a safe retry state; it must not return a local/demo outcome as success.
  - `buildRetryState(error)` returns a non-leaky user-facing message and does not include stack traces, request IDs, session IDs, internal IDs, or raw backend internals.
  - `resolveSpinRenderPlan({ mode: "production", backendResult, localOutcome })` must use only backend-confirmed results in production; if no backend result exists, it must return a backend retry/blocked state rather than a local result.
  - `resolveSpinRenderPlan({ mode: "demo", localOutcome })` remains local-demo only and marked as `source: "local-demo"`.
  - `SlotGame.requestBackendSpin()` must treat retry-state results as blocked/retry states, not as confirmed backend spin results.
  - Demo mode is opt-in via explicit `mode: "demo"`, `?mode=demo`, or `CHINA_SLOT_MODE = "demo"`; missing mode defaults to production.
- Candidate implementation locations:
  - `js/serverClient.js` for browser client contract and retry-state behavior.
  - `apps/api/test/unit/server-client.test.ts` for VM-loaded client contract tests.
- Existing patterns to follow:
  - Current tests load `js/serverClient.js` through `vm.runInContext` and assert plain object contracts.
  - Production render plans already prefer backend results over manipulated local outcomes.
  - Demo render plans are already distinguishable with `mode: "demo"` and `source: "local-demo"`.
- Test evidence expected for review:
  - Network failure test with non-leaky retry state.
  - HTTP 5xx test with non-leaky retry state.
  - Timeout test using a rejected timeout/abort-style error.
  - Session failure test proving no spin request is posted.
  - Mid-spin backend failure test proving local wallet/render state remains unchanged.
  - Production no-backend-result test proving no optimistic success or local fallback.

### Project Structure Notes

- Keep this story focused on client/backend-unavailable behavior. Do not add general offline gameplay, local wallet mutation, or redemption behavior.
- No new runtime dependency is expected.
- Avoid changing backend wallet semantics unless a client failure test proves a backend contract issue.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.2-Add-Safe-Backend-Unavailable-Behavior]
- [Source: _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/prd.md#FR-4-Render-backend-approved-outcomes-in-the-client]
- [Source: _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/prd.md#Cross-Cutting-NFRs]
- [Source: _bmad-output/planning-artifacts/architecture.md#Client-Backend-Boundary]
- [Source: _bmad-output/implementation-artifacts/epic-5-retro-2026-06-19.md#Team-Agreements]
- [Source: _bmad-output/implementation-artifacts/6-1-enforce-non-cash-reward-boundary.md#Completion-Notes-List]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Red phase: `npm --workspace @china-slot-game/api test -- unit/server-client.test.ts` failed 6 safe-failure tests before implementation.
- Focused green phase: `npm --workspace @china-slot-game/api test -- unit/server-client.test.ts` passed 11 tests.
- Full quality gate: `npm test && npm run lint && npm run typecheck && npm run build` passed with 113 API tests and 37 game-math tests.
- Code review findings patched: `SlotGame.requestBackendSpin()` now handles retry-state results without calling `runSlot()`, the UI uses the safe retry message, and demo mode is explicit instead of implicit default.
- Final re-review finding patched: invalid mode values now normalize to production, so only exact `demo` enables local demo mode.
- Final focused green phase: `npm --workspace @china-slot-game/api test -- unit/server-client.test.ts` passed 13 tests.
- Final quality gate: `npm test && npm run lint && npm run typecheck && npm run build` passed with 115 API tests and 37 game-math tests.
- Post-mode-normalization focused gate: `npm --workspace @china-slot-game/api test -- unit/server-client.test.ts` passed 13 tests.
- Post-mode-normalization full gate: `npm test && npm run lint && npm run typecheck && npm run build` passed with 115 API tests and 37 game-math tests.

### Completion Notes List

- Production `spin()` now converts network failure, timeout/abort, 5xx, session failure, and mid-spin backend failure into a retryable backend state instead of throwing/leaking raw backend details.
- Production render planning now returns a backend retry state when no confirmed backend result exists, so it cannot fall back to local demo outcomes.
- `SlotGame.requestBackendSpin()` now routes retry-state results through `handleBackendSpinRetry()` instead of treating them as successful backend spin results.
- Demo mode remains explicit and returns `source: local-demo`.
- Default client mode is production unless demo is explicitly configured.
- Invalid mode values normalize to production; only exact `demo` enables local-demo behavior.
- Retry state uses the non-leaky message `Reward-bearing play is paused while the backend is unavailable.`
- Tests verify no spin request is posted after session validation failure and caller wallet/render state remains unchanged after backend failure mid-spin.
- Tests verify the slot game caller path disables/re-enables controls into retry state, shows the non-leaky message, and does not call `runSlot()` on backend retry.

### File List

- js/serverClient.js
- js/slotGame.js
- apps/api/test/unit/server-client.test.ts
- _bmad-output/implementation-artifacts/6-2-add-safe-backend-unavailable-behavior.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

### Change Log

- 2026-06-19: Created story context for implementation.
- 2026-06-19: Implemented safe backend-unavailable production behavior and tests.
- 2026-06-19: Addressed review findings in the Phaser caller path and made demo mode explicit.
- 2026-06-19: Marked story done after mode-normalization fix and final passing quality gate.
