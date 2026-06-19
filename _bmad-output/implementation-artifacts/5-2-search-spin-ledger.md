# Story 5.2: Search Spin Ledger

Status: done

## Story

As a support user,
I want to search spin history,
So that disputed outcomes can be explained.

## Acceptance Criteria

- Given a support user with permission, when they search by player, session, spin ID, date range, configuration version, or transaction type, then the backend returns matching spin records.
- Returned records include wager, reel stops, visible symbols, win breakdown, balance before/after, configuration version, and timestamps.
- Sensitive player information is minimized.
- Unauthorized users cannot access ledger search.
- Result pagination prevents unbounded exports.

## Dev Notes

- Endpoint: `GET /api/admin/spins`.
- Allowed roles: `support`, `operator`, and `admin`; `viewer` receives HTTP 403.
- Query parameters:
  - `playerId`, `sessionId`, `spinId`, `configVersionId`: trimmed string filters.
  - `from`, `to`: offset-aware ISO datetimes; `from` must be before or equal to `to`.
  - `transactionType`: `debit`, `credit`, `free_spin_award`, `jackpot_award`, or `adjustment`.
  - `limit`: integer 1-100, default 25.
  - `offset`: integer >= 0, default 0.
- Response contract: `{ records, page }` in the standard envelope. `page` contains `limit`, `offset`, `total`, and `hasMore`.
- Error cases:
  - Missing or invalid admin role: `ADMIN_UNAUTHENTICATED` with HTTP 401.
  - Authenticated role without permission: `ADMIN_FORBIDDEN` with HTTP 403.
  - Malformed query: `INVALID_SPIN_LEDGER_QUERY` with HTTP 400.
- Exposed fields: `spinId`, `sessionId`, internal `playerId`, `configVersionId`, wager, reel stops, visible window, win breakdown, payout, balance before/after, transaction types, and `acceptedAt`.
- Redacted / not exposed: identity provider, provider subject, session identity payload, idempotency keys, and raw wallet transaction IDs.
- Assumption: Epic 5 support search can use the process-local spin ledger introduced in Epic 2 until a durable repository replaces it.
- Audit-schema impact: search itself does not emit unified audit events until 5.4, where admin/support actions are wired into the unified audit schema.

## Review Evidence

- Tests cover support search by player and transaction type.
- Tests assert pagination is bounded and reports `hasMore`.
- Tests assert malformed query parameters return HTTP 400.
- Tests assert `viewer` receives HTTP 403 and missing role receives HTTP 401.
