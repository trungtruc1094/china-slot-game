---
baseline_commit: b0b6f77
---

# Story 2.5: Add Spin Idempotency and Retry Safety

Status: done

## Story

As a player,
I want network retries to be safe,
so that a slow or repeated request does not duplicate a spin or payout.

## Acceptance Criteria

1. Given a spin request with `clientSpinId` and `sessionId`, when the same accepted request is retried, then the backend returns the original spin result without creating a duplicate ledger entry or balance transaction.
2. Conflicting reuse of `clientSpinId` with different wager data returns a clear error.
3. Transaction rollback prevents partial balance or ledger writes.
4. Tests cover retry, conflict, rollback, and success paths.

## Tasks / Subtasks

- [x] Add `clientSpinId` to spin request schema and public contract (AC: 1-2)
- [x] Implement idempotency storage keyed by `sessionId + clientSpinId` (AC: 1-3)
- [x] Return accepted cached results for duplicate matching requests without wallet/ledger mutation (AC: 1)
- [x] Reject conflicting reuse of the same key with different wager data (AC: 2)
- [x] Ensure failed/rolled-back spins are not cached as accepted results (AC: 3)
- [x] Add tests for success, duplicate retry, conflict, and rollback retry safety (AC: 1-4)

## Dev Notes

### Public API Contract

`POST /api/spins`

- Request body now requires `clientSpinId`: `{ "clientSpinId": "spin-click-123", "sessionId": "sess_1", "wager": { "lineBet": 1, "selectedWays": 243, "totalWager": 243 } }`
- Idempotency key strategy: accepted spins are keyed by `sessionId + clientSpinId`.
- Retry window: the in-memory store keeps accepted idempotency records for 24 hours from acceptance. A repository-backed implementation should enforce the same window with an indexed expiration column.
- Duplicate matching request: returns the original accepted spin result with no new ledger entry and no new wallet transaction.
- Conflicting duplicate request: returns `409 IDEMPOTENCY_CONFLICT` when the same `sessionId + clientSpinId` is reused with different wager data.
- Failed or rolled-back attempts do not create accepted idempotency records and may be retried.

### Story-Specific Assumptions

- In-memory idempotency is process-local scaffolding. Durable idempotency belongs with the future spin ledger repository.
- Idempotency compares the normalized wager tuple `{ lineBet, selectedWays, totalWager }`.
- Client-provided outcome/RNG fields remain ignored by the spin schema from Story 2.4 and are not part of the idempotency fingerprint.

### Testing Requirements

- Tests must run under root `npm test`.
- Required coverage: successful accepted spin stores idempotency record, duplicate retry returns same result without double-debit, conflicting retry returns clear error, rollback failure leaves no partial balance/ledger/idempotency record and can be retried.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm run lint && npm run typecheck && npm test && npm run build`

### Completion Notes List

- Added required `clientSpinId` to the spin request schema and all spin route tests.
- Added in-memory idempotency records keyed by `sessionId + clientSpinId`, storing accepted response and normalized wager fingerprint.
- Duplicate matching requests inside the 24-hour retry window return the original accepted response without creating additional wallet transactions or ledger entries.
- Conflicting duplicate requests return `409 IDEMPOTENCY_CONFLICT`.
- Failed ledger-rollback attempts do not cache accepted idempotency records; retrying the same key after recovery succeeds once.
- Expired idempotency records are removed before duplicate/conflict handling; later requests no longer receive cached results or stale conflicts and must pass normal session/config/wager validation.
- Local review gate verified retry-window enforcement after the external review agent hit the account usage limit.
- Re-verified `npm test && npm run build` before marking done.
- Verified `npm run lint && npm run typecheck && npm test && npm run build`.

### File List

- `_bmad-output/implementation-artifacts/2-5-add-spin-idempotency-and-retry-safety.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/src/domain/spin-service.ts`
- `apps/api/src/schemas/spin.schema.ts`
- `apps/api/test/integration/spins-routes.test.ts`
