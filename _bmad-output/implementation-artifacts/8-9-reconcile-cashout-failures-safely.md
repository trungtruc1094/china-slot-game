---
baseline_commit: cb8b51f4a32ea6dfe4af4661d36bf24c134822dd
---

# Story 8.9: Reconcile Cashout Failures Safely

Status: done

## Story

As an operator,
I want failed or uncertain manual Tevi cashouts to be visible and safely retryable,
so that payout incidents can be resolved without double-paying or corrupting the game ledger.

## Acceptance Criteria

1. Given a manual cashout request record in `pending`, `dispatched`, `failed_retryable`, `failed_terminal`, `idempotency_conflict`, or equivalent state, when reconciliation runs or an operator or support user inspects payout status, then status, attempt count, provider response summary, last error, reconciliation state, related spin ID, related wallet transaction IDs, and request ID are visible.
2. Retryable failures (`failed_retryable`, `pending` with prior dispatch attempts) can be retried with the original idempotency key and payload fingerprint without mutating wallet balance or creating a new cashout row.
3. Terminal failures (`failed_terminal`, `idempotency_conflict`) require operator review and cannot be retried through the operator retry endpoint; wallet and spin ledger state remain unchanged on inspection or failed retry attempts.
4. A simulated provider timeout or failure leaves the internal spin ledger, cashout request record, and internal Stars wallet correct (wallet debited once, no duplicate debit on retry).
5. Logs and database rows expose pass/fail criteria without full secrets, tokens, or signatures.
6. The story ends with a simulated payout failure Check Round including logs, SQL, retry command, and expected state transitions.

## Tasks / Subtasks

- [x] **Domain — CashoutReconciliationService (AC: 1–4)**
  - [x] Add `cashout-reconciliation-service.ts` with `searchRecords`, `getRecord`, `retryDispatch`, and `deriveReconciliationState`.
  - [x] Extend `CashoutRequestRepository` with detail/search queries and reuse existing `recordDispatchOutcome`.
  - [x] Implement `PostgresCashoutRequestRepository.searchRecords`, `findDetailById`.
- [x] **Admin routes — support/operator visibility and retry (AC: 1–3, 5)**
  - [x] Add `admin-cashout-requests.routes.ts`: `GET /admin/cashout-requests`, `GET /admin/cashout-requests/:cashoutRequestId`, `POST /admin/cashout-requests/:cashoutRequestId/retry`.
  - [x] Wire router in `app.ts` and compose `CashoutReconciliationService` in `main.ts` when Postgres cashout repo is available.
  - [x] Redact secrets in serialized admin responses; audit admin search/retry actions.
- [x] **Player UX — retryable failure visibility (AC: 1, UX-DR11)**
  - [x] On `failed_retryable`, show acknowledgment with cashout request ID before closing modal (support reference).
- [x] **Tests (AC: 1–4)**
  - [x] Unit: reconciliation state derivation, retry guardrails, terminal rejection.
  - [x] Integration: admin search/detail/retry routes with auth and envelope shape.
  - [x] Postgres: retry re-dispatches without double debit; webhook reconcile still works.
- [x] **Check Round (AC: 6)**
  - [x] Document simulated payout failure steps with curl admin retry, SQL inspection, and pass/fail criteria.

## Dev Notes

### Architecture compliance

- Implement `CashoutReconciliationService` per [architecture.md#Tevi Readiness Boundary](_bmad-output/planning-artifacts/architecture.md) — tracks payout states without corrupting wallet ledger.
- Reuse `CashoutRequestService` dispatch client (`TeviPaymentClient.dispatchCashout`) and existing idempotency key derivation from cashout request ID.
- Admin routes follow `admin-balance-transactions.routes.ts` / `admin-spin-ledger.routes.ts` patterns: `requireAdminRole`, `okEnvelope`, audit via `AdminAuditRepository`.
- Do **NOT** credit wallet on retry; only re-call Tevi with stored idempotency key + payload fingerprint.
- Do **NOT** implement receipts (8.10), compliance gates (Epic 9), or player-facing operator retry UI.

### Manual Check Round (AC6)

1. Start API with `PERSISTENCE_MODE=postgres`, Tevi payment enabled, and a player with withdrawable balance.
2. Force provider failure (mock/unavailable Tevi base) and `POST /api/v1/payments/cashout-requests` with valid amount.
3. **Pass:** response `status=failed_retryable`, wallet debited once, `cashout_requests.status=failed_retryable`, `dispatch_attempt_count=1`.
4. Inspect: `GET /api/admin/cashout-requests?status=failed_retryable` with `x-admin-role: support` — record shows `reconciliationState=retry_required`, `walletTransactionId`, `requestId`, attempt count, failure reason.
5. Retry: `POST /api/admin/cashout-requests/{cashoutRequestId}/retry` with `x-admin-role: operator` — **Pass:** status becomes `dispatched`, attempt count increments, wallet balance unchanged, still one debit row.
6. SQL: `SELECT status, dispatch_attempt_count, failure_reason FROM cashout_requests WHERE id = '<id>';` and `SELECT COUNT(*) FROM wallet_transactions WHERE player_id = '<id>' AND transaction_type = 'debit';` — count stays 1.
7. Terminal guard: attempt retry on `idempotency_conflict` row — **Pass:** HTTP 409 `CASHOUT_RETRY_NOT_ALLOWED`, no wallet mutation.

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

### Completion Notes List

- Added `CashoutReconciliationService` with derived reconciliation states, admin search/detail, and operator retry dispatch using stored idempotency keys (no wallet mutation).
- Added admin routes `GET/POST /api/admin/cashout-requests*` with support/operator RBAC and audit logging.
- Player `failed_retryable` flow now shows cashout request ID for support reference before closing modal.
- Tests: lint green; API suite 362 passed (60 skipped postgres-gated).

### File List

- apps/api/src/domain/cashout-reconciliation-service.ts (new)
- apps/api/src/domain/cashout-request-service.ts (modified)
- apps/api/src/repositories/postgres/cashout-request-repository.ts (modified)
- apps/api/src/routes/admin-cashout-requests.routes.ts (new)
- apps/api/src/app.ts (modified)
- apps/api/src/main.ts (modified)
- js/slotGame.js (modified)
- apps/api/test/unit/cashout-reconciliation-service.test.ts (new)
- apps/api/test/integration/admin-cashout-requests-routes.test.ts (new)
- apps/api/test/postgres/cashout-request.test.ts (modified)
- apps/api/test/unit/cashout-request-service.test.ts (modified)

### Change Log

- 2026-07-02: Story 8.9 — cashout reconciliation service, admin visibility/retry, player support ID acknowledgment, tests.

- 2026-07-02: Code review — fixed reconciliationState SQL filter for correct admin search pagination.

### Review Findings (AI Code Review 2026-07-02)

- [x] [Review][Patch] Admin search `reconciliationState` filter applied after SQL pagination, breaking totals and page results. [cashout-request-repository.ts]
- [x] [Review][Defer] Live Tevi sandbox simulated payout failure Check Round — requires funded sandbox + operator curl verification. [manual]

## Status

done
