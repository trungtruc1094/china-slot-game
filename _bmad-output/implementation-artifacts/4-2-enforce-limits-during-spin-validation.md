---
baseline_commit: 425c528
---

# Story 4.2: Enforce Limits During Spin Validation

Status: done

## Story

As a host,
I want the backend to enforce limits before accepting a spin,
So that campaigns cannot exceed configured guardrails.

## Acceptance Criteria

1. Active operator limits are checked during spin validation before wallet debit, reel generation, payout calculation, or ledger append.
2. Spins violating bet, player cap, campaign budget, jackpot cap, max payout, or session limits are rejected with stable client-displayable error codes.
3. Spins at exactly the configured limit are allowed.
4. Spins one minor currency unit over a configured limit are rejected.
5. Rejected spins do not mutate wallet, ledger, idempotency, or session state.
6. Accepted spins are never changed after acceptance due to budget pressure.

## Tasks/Subtasks

- [x] Inject active operator limits into spin validation.
- [x] Evaluate per-spin, per-session, per-day player, campaign budget, payout, and jackpot caps before debit/generation.
- [x] Return stable operator-limit error codes and details.
- [x] Add tests for exact-limit allowed, one-unit-over rejected, and rejected spin non-mutation.
- [x] Document public API contracts and assumptions in Dev Notes.

## Dev Notes

### Persistence Approach

This story consumes durable operator limit state created by Story 4.1. It does not add new tables. Enforcement reads the active limit version from the `operator_limits` persistence contract:

- Table: `operator_limits`, unique active row per `scope_id`.
- Retention: all retired and active limit versions retained for at least campaign lifetime plus 180 days.
- Indexing: active lookup uses `(scope_id)` partial unique index where `status = 'active'`.

### API Contracts

- `POST /api/spins`
  - Request unchanged: `{ "clientSpinId": string, "sessionId": string, "wager": { "lineBet": number, "selectedWays": number, "totalWager": number } }`
  - Success response unchanged: authoritative spin result.
  - New error cases:
    - `OPERATOR_LIMIT_EXCEEDED` with details `{ "scopeId", "limit", "current", "attempted", "maximum" }`
    - Existing `INVALID_WAGER`, `INSUFFICIENT_BALANCE`, `INVALID_SESSION`, `SESSION_EXPIRED`, and `ACTIVE_CONFIG_MISSING` remain unchanged.

### Assumptions

- V1 uses `scopeId = "default"` for spin enforcement. Later campaign/config routing can pass a scope resolver without changing limit semantics.
- Campaign budget means cumulative accepted payouts plus the current spin's maximum allowed exposure cannot exceed `campaign.budget`.
- Jackpot liability means cumulative accepted jackpot awards plus current maximum jackpot exposure cannot exceed `campaign.jackpotCap`.
- Because spin results are random, budget checks use configured max exposure before generation, not generated payout after the fact.

## Dev Agent Record

### Implementation Plan

- Extend `SpinServiceOptions` with `operatorLimitsProvider`.
- Evaluate active limits before sampling reels and before `WalletService.applyTransactionBatch`.
- Cover exact cap and rejected non-mutation in integration tests.

### Debug Log

- `npm --workspace @china-slot-game/api test -- spins-routes` passed.
- `npm --workspace @china-slot-game/api run typecheck` passed.
- `npm run lint && npm run typecheck && npm test && npm run build` passed.

### Completion Notes

- `SpinService` now accepts an `operatorLimitsProvider` and evaluates active limits before reel sampling and before `WalletService.applyTransactionBatch`.
- Enforcement covers per-spin bet limits, per-session spin/wager caps, per-day player wager/reward caps, campaign budget, and jackpot cap.
- Rejections use `OPERATOR_LIMIT_EXCEEDED` with stable limit details for client messaging.
- Integration tests prove exact-limit spins are allowed and over-limit spins do not mutate wallet transactions or ledger and do not call RNG/reel generation.

## Senior Developer Review (AI)

Outcome: Approve

Evidence:

- Acceptance criteria covered by `apps/api/test/integration/spins-routes.test.ts`.
- Limit check happens before wallet debit and before spin generation: rejected test asserts RNG call count does not increase and wallet/ledger snapshots are unchanged.
- Exact-limit spin is allowed via the per-day wager cap test.
- One minor unit over the active per-day wager limit is rejected with `OPERATOR_LIMIT_EXCEEDED`.
- Rejected spins do not mutate wallet transactions, spin ledger, or idempotent accepted results; session remains usable for subsequent requests.
- Public API error contract and assumptions are documented in Dev Notes.
- Persistence decision is documented as consuming Story 4.1 `operator_limits` active-version storage.
- Lint, typecheck, tests, and build are clean.

### File List

- `_bmad-output/implementation-artifacts/4-2-enforce-limits-during-spin-validation.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/src/app.ts`
- `apps/api/src/domain/spin-service.ts`
- `apps/api/test/integration/spins-routes.test.ts`

### Change Log

- 2026-06-18: Implemented operator limit enforcement during spin validation and added non-mutation tests.
