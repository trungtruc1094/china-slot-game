# Story 6.1: Enforce Non-Cash Reward Boundary

Status: done
baseline_commit: 9cb5222c83d3d12d85baa688c9e90471d354ca71

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a host,
I want the product to stay inside a non-cash reward model for MVP,
so that launch does not accidentally imply redeemable gambling behavior.

## Acceptance Criteria

1. Given MVP reward mode is configured, when client and admin-facing API surfaces display balances or rewards, then labels and API metadata distinguish internal points/credits from cash-equivalent value.
2. Redemption-related copy and features are disabled by default.
3. Cash-equivalent reward support is blocked behind an explicit compliance-ready configuration and cannot be enabled by a normal client request.
4. Tests verify the default reward mode cannot expose cash-out, crypto, redemption, or cash-equivalent states.
5. A cash-equivalent reward request is rejected server-side and records a unified audit event using the Epic 5.4 audit schema.

## Tasks / Subtasks

- [x] Add backend reward-boundary domain contract (AC: 1, 2, 3, 4)
  - [x] Define allowed reward modes and denied cash-equivalent/redeemable reward types.
  - [x] Expose default reward metadata for client/admin consumers without implying redemption.
  - [x] Keep the default mode as non-cash internal points/credits.
- [x] Enforce reward-boundary validation server-side (AC: 2, 3, 5)
  - [x] Reject cash-equivalent, crypto, cash-out, and redeemable reward-mode requests before any wallet/spin state can change.
  - [x] Emit a failed unified audit event through `InMemoryAdminAuditRepository` / `AdminAuditRepository`.
  - [x] Ensure client-provided extra fields cannot bypass the boundary.
- [x] Add non-cash metadata to existing display surfaces (AC: 1, 2, 4)
  - [x] Include reward metadata on session and spin responses.
  - [x] Include reward metadata on admin spin ledger and balance transaction search responses.
  - [x] Test that existing balance/reward surfaces identify points as non-cash.
- [x] Add public API contract documentation in this story (AC: 1, 2, 3, 5)
  - [x] Document request shape, response shape, and error cases for the reward-boundary endpoint or metadata surface.
  - [x] Document audit event fields emitted for rejected cash-equivalent requests.
- [x] Add tests for non-cash boundary behavior (AC: 1, 2, 3, 4, 5)
  - [x] Test default metadata identifies points/credits as non-cash and redemption-disabled.
  - [x] Test a cash-equivalent reward request is rejected server-side.
  - [x] Test the rejection emits an audit event using unified audit event fields from Story 5.4.
  - [x] Test unknown client fields do not enable redemption or cash-equivalent mode.
- [x] Run quality gates and update story record (AC: all)
  - [x] Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
  - [x] Update Dev Agent Record, File List, Change Log, and final status.

## Dev Notes

- Binding Epic 5 retro findings:
  - Treat unified audit events as the canonical audit source for launch-readiness work.
  - Keep API contracts and error cases in story notes.
  - Do not treat header-based admin auth as production identity.
- Allowed MVP reward types: internal `points`, internal `credits`, and non-redeemable `community_perk` display metadata.
- Denied reward types: `cash`, `cash_equivalent`, `crypto`, `gift_card`, `voucher`, `redeemable_prize`, `cash_out`, and any externally redeemable reward model unless a future compliance-approved configuration explicitly changes the product model.
- Assumption: Story 6.1 should implement the compliance boundary as server-side metadata and validation, not as player cash-out or redemption functionality.
- The boundary must be enforced by the backend. Client copy or omitted UI controls are not sufficient.
- Existing balance responses already use integer `points`; preserve integer accounting and do not introduce floating-point money fields.
- Reuse the Epic 5.4 unified audit repository in `apps/api/src/domain/admin-audit-repository.ts`. Do not create a second audit list or per-feature audit array.
- Existing request IDs are available as `request.requestId` from `apps/api/src/middleware/request-id.ts`; include it in audit events where the route has a request object.
- Candidate implementation locations:
  - `apps/api/src/domain/reward-boundary.ts` for allowed/denied model definitions and validation.
  - `apps/api/src/routes/reward-boundary.routes.ts` or an equivalent API route registered from `apps/api/src/app.ts`.
  - `apps/api/src/schemas/reward-boundary.schema.ts` for Zod request validation if the story adds a mutation/validation endpoint.
  - `apps/api/test/integration/*reward*boundary*.test.ts` for API behavior and audit assertions.
- Existing patterns to follow:
  - Express route factories under `apps/api/src/routes`.
  - `okEnvelope` for successful JSON responses and `ApiHttpError` for stable API failures.
  - Zod schemas under `apps/api/src/schemas`.
  - Integration tests use `createApp(...)` with injected in-memory repositories.
- Public API contract to implement and preserve:
  - `GET /api/reward-boundary` returns reward metadata for client/admin display. Response data should include an internal unit label such as `points`, a non-cash flag, disabled redemption/cash-out indicators, and allowed/denied reward type lists.
  - `POST /api/reward-boundary/validate` accepts `{ rewardType: string }` or equivalent validation input. Allowed types return success metadata. Denied cash-equivalent/redeemable types return HTTP 403 with a stable code such as `REWARD_TYPE_FORBIDDEN`.
  - Existing balance/reward surfaces (`POST /api/sessions`, `POST /api/spins`, `GET /api/admin/spins`, `GET /api/admin/balance-transactions`) include `rewardModel` metadata: `mode: mvp_non_cash`, `unit: points`, and disabled cash-equivalent/redemption/cash-out/crypto flags.
  - Error responses must not include legal advice, stack traces, internal audit IDs, or compliance internals.
  - Rejected denied-type requests emit a unified audit event with `source`, `action`, `resource`, `outcome`, `reason`, `requestId`, and metadata sufficient for support review.
- Test evidence expected for review:
  - A test named for rejecting cash-equivalent reward requests.
  - A test proving rejection emits a unified audit event.
  - A test proving default metadata cannot expose cash-out/redemption states.
  - A test proving unknown request fields do not bypass `.strip()` / validation behavior.

### Project Structure Notes

- Keep API code in `apps/api/src`; do not add reward-boundary behavior to the static Phaser prototype as the authoritative control.
- Keep launch/compliance policy language in story docs and API metadata; do not hard-code user-facing legal terms beyond non-cash labels and disabled redemption state.
- No new runtime dependency is expected; use Express, Zod, TypeScript, and Vitest already present in the workspace.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.1-Enforce-Non-Cash-Reward-Boundary]
- [Source: _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/prd.md#FR-11-Support-non-cash-reward-accounting]
- [Source: _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/prd.md#Compliance-and-Guardrails]
- [Source: _bmad-output/planning-artifacts/architecture.md#Key-Architecture-Decisions]
- [Source: _bmad-output/implementation-artifacts/epic-5-retro-2026-06-19.md#Team-Agreements]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Red phase: `npm --workspace @china-slot-game/api test -- integration/reward-boundary-routes.test.ts` failed with 4 route-level 404 failures before implementation.
- Focused green phase: `npm --workspace @china-slot-game/api test -- integration/reward-boundary-routes.test.ts` passed 4 tests.
- First full quality gate: `npm test && npm run lint && npm run typecheck && npm run build` passed.
- Code review findings patched: cash-equivalent aliases now normalize to audited forbidden rejections, `/api/spins` rejects cash-like raw payload fields before wallet/ledger mutation, and existing balance/reward API surfaces include non-cash reward metadata.
- Affected route regression: `npm --workspace @china-slot-game/api test -- integration/reward-boundary-routes.test.ts integration/spins-routes.test.ts integration/sessions-routes.test.ts integration/admin-spin-ledger-routes.test.ts integration/admin-balance-transactions-routes.test.ts` passed 36 tests.
- Final focused reward/spin regression after detector tightening: `npm --workspace @china-slot-game/api test -- integration/reward-boundary-routes.test.ts integration/spins-routes.test.ts` passed 21 tests.
- Final focused reward/spin regression after key-name bypass fix: `npm --workspace @china-slot-game/api test -- integration/spins-routes.test.ts integration/reward-boundary-routes.test.ts` passed 22 tests.
- Final quality gate: `npm test && npm run lint && npm run typecheck && npm run build` passed with 107 API tests and 37 game-math tests.

### Completion Notes List

- Implemented backend-authoritative MVP reward boundary metadata at `GET /api/reward-boundary`.
- Implemented server-side reward-type validation at `POST /api/reward-boundary/validate`.
- Added server-side raw payload inspection to `POST /api/spins` so cash-like reward fields are rejected and audited before spin or wallet state changes.
- Added shared non-cash `rewardModel` metadata to sessions, spin results, admin spin ledger search, and admin balance transaction search.
- Added cash/redeemable/crypto alias normalization and denied-signal detection for common variants such as `cash-out`, `gift-card`, `btc`, `usdc`, `usd`, `fiat`, and `paypal`.
- Added denied key-name detection so raw spin payload fields such as `cash_out: true` are rejected before Zod stripping.
- Default reward model exposes internal points only and keeps redemption, cash-out, crypto, and cash-equivalent flags disabled.
- Cash-equivalent/redeemable reward types are rejected with `REWARD_TYPE_FORBIDDEN` and emit unified audit events with `source: reward-boundary`, `action: reward_boundary.reject`, request ID, reason, and metadata.
- Unknown client fields are stripped by Zod and cannot enable redemption, cash-out, or compliance approval.

### File List

- apps/api/src/app.ts
- apps/api/src/domain/admin-audit-repository.ts
- apps/api/src/domain/reward-boundary.ts
- apps/api/src/domain/session-service.ts
- apps/api/src/domain/spin-service.ts
- apps/api/src/routes/admin-balance-transactions.routes.ts
- apps/api/src/routes/admin-spin-ledger.routes.ts
- apps/api/src/routes/reward-boundary.routes.ts
- apps/api/src/routes/spins.routes.ts
- apps/api/src/schemas/reward-boundary.schema.ts
- apps/api/src/schemas/session.schema.ts
- apps/api/test/integration/admin-balance-transactions-routes.test.ts
- apps/api/test/integration/admin-spin-ledger-routes.test.ts
- apps/api/test/integration/reward-boundary-routes.test.ts
- apps/api/test/integration/sessions-routes.test.ts
- apps/api/test/integration/spins-routes.test.ts
- _bmad-output/implementation-artifacts/6-1-enforce-non-cash-reward-boundary.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

### Change Log

- 2026-06-19: Created story context for implementation.
- 2026-06-19: Implemented non-cash reward boundary API, validation, unified audit rejection events, and integration tests.
- 2026-06-19: Addressed code review findings by hardening cash-equivalent detection, guarding spin requests before state mutation, and adding reward metadata to existing display surfaces.
- 2026-06-19: Marked story done after clean acceptance re-review and final passing quality gate.
