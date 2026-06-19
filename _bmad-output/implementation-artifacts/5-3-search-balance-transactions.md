# Story 5.3: Search Balance Transactions

Status: done

## Story

As a support user,
I want to inspect balance transaction history,
So that player balance changes can be reconciled.

## Acceptance Criteria

- Given a support user with permission, when they search balance transactions, then the backend returns transaction type, amount, balance before, balance after, source spin or adjustment, actor/source, and timestamp.
- Results can be filtered by player, session, date range, and transaction type.
- Transaction records reconcile with spin ledger outcomes.
- Export access can be restricted by role.

## Dev Notes

- Endpoint: `GET /api/admin/balance-transactions`.
- Allowed roles: `support`, `operator`, and `admin`; `viewer` receives HTTP 403.
- Query parameters:
  - `playerId`, `sessionId`: trimmed string filters.
  - `from`, `to`: offset-aware ISO datetimes; `from` must be before or equal to `to`.
  - `transactionType`: `debit`, `credit`, `free_spin_award`, `jackpot_award`, or `adjustment`.
  - `limit`: integer 1-100, default 25.
  - `offset`: integer >= 0, default 0.
- Response contract: `{ records, page }` in the standard envelope. `page` contains `limit`, `offset`, `total`, and `hasMore`.
- Error cases:
  - Missing or invalid admin role: `ADMIN_UNAUTHENTICATED` with HTTP 401.
  - Authenticated role without permission: `ADMIN_FORBIDDEN` with HTTP 403.
  - Malformed query: `INVALID_BALANCE_TRANSACTION_QUERY` with HTTP 400.
- Exposed fields: `transactionId`, internal `playerId`, `transactionType`, `amount`, `balanceBefore`, `balanceAfter`, `actor`, `source`, `sessionId`, `spinId`, `createdAt`, and minimized operational `metadata`.
- Redacted / not exposed: identity provider, provider subject, session identity payload, idempotency keys, raw request bodies, and any wallet fields outside immutable transaction records.
- Assumption: the wallet transaction `source` is the session id for spin-created transactions, and spin linkage is derived from transaction metadata added by this story plus source/session matching for existing in-memory records.
- Export access is restricted by omission: this story provides bounded paginated JSON search only, with no export endpoint or unbounded query mode.
- Audit-schema impact: search itself does not emit unified audit events until 5.4, where admin/support actions are wired into the unified audit schema.

## Review Evidence

- Tests cover support search by player, session, and transaction type.
- Tests assert results match the underlying `WalletService` transaction ledger for amount, balance before/after, source, timestamp, and transaction id.
- Tests assert pagination is bounded and reports `hasMore`.
- Tests assert malformed query parameters return HTTP 400.
- Tests assert `viewer` receives HTTP 403 and missing role receives HTTP 401.
- Full gate passed: `npm run lint && npm run typecheck && npm test && npm run build`.
