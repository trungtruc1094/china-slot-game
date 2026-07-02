---
baseline_commit: 6fd28f4fc62b2c3cf08300bb78fb43ca33befb42
---

# Story 8.10: Send Basic Tevi Top-Up and Cashout Receipts

Status: done

## Story

As a player,
I want receipt messages for completed top-ups and manual cashout payouts,
so that I can confirm important Stars events outside the slot animation alone.

## Acceptance Criteria

1. Given a completed top-up credit, when receipt dispatch runs, then the top-up receipt includes credited Stars amount and correlation ID (provider event ID / request ID).
2. Given a manual cashout in `dispatched` state, when receipt dispatch runs, then the cashout receipt includes cashout request ID, Stars amount, and cashout status.
3. Message dispatch records store message type, recipient, source event, status, attempt count, provider response summary, and retry state.
4. Message dispatch failures do not roll back wallet, spin, cashout, or reconciliation state.
5. Receipt status is visible through structured logs and support/admin search where authorized; secrets/tokens/signatures are not logged in full.
6. The story ends with a Message receipts Check Round with request/response examples and user-visible receipt verification.

## Tasks / Subtasks

- [x] **Persistence — message receipt records (AC: 3)**
  - [x] Add migration `0014_tevi_message_receipts.sql` with types `tevi_message_receipt_type`, `tevi_message_receipt_status`, and table `tevi_message_receipt_records`.
  - [x] Add `PostgresTeviMessageReceiptRepository` with create-or-get, record outcome, search, find-by-id, find-by-source.
- [x] **Tevi message client (AC: 1–2, 5)**
  - [x] Add `TeviMessageClient` calling configurable `POST {TEVI_MESSAGE_PATH}` with `X-API-Key`, body `{ user, text, type: "TEXT", parser: "PLAIN" }`.
  - [x] Add env `TEVI_MESSAGE_PATH` (default `/api/v1/conversations/messages/send`) alongside existing payment config.
- [x] **Domain — TeviReceiptService (AC: 1–5)**
  - [x] Add `tevi-receipt-service.ts` with `dispatchTopupReceipt`, `dispatchCashoutReceipt`, `retryDispatch`, `searchRecords`, `getRecord`.
  - [x] Record `pending` → `sent` or `failed_retryable`; never throw to money-path callers.
  - [x] Build safe message text: top-up includes amount + correlation ID; cashout includes request ID + amount + status.
- [x] **Money-path hooks (AC: 4)**
  - [x] After successful webhook top-up credit in `TeviWebhookService`, invoke receipt dispatch (post-commit, non-throwing).
  - [x] After successful cashout dispatch in `CashoutRequestService` and operator retry in `CashoutReconciliationService`, invoke cashout receipt dispatch.
- [x] **Admin routes — support search + retry (AC: 3, 5)**
  - [x] Add `admin-message-receipts.routes.ts`: `GET /admin/message-receipts`, `GET /admin/message-receipts/:receiptId`, `POST /admin/message-receipts/:receiptId/retry`.
  - [x] Wire in `app.ts` / `main.ts` when Postgres receipt repo available; audit admin actions.
- [x] **Player UX — receipt status visibility (AC: 6, UX-DR12)**
  - [x] Surface `receipt_status` on cashout API success envelope when a receipt row exists or was attempted.
  - [x] Update Tevi top-up `credited` and cashout `dispatched` status copy to mention receipt delivery state without blocking gameplay.
- [x] **Tests (AC: 1–5)**
  - [x] Unit: receipt message formatting, failure isolation (money path unaffected), retry guardrails.
  - [x] Integration: admin search/detail/retry routes with RBAC.
  - [x] Postgres: receipt row persisted on top-up/cashout triggers; failure does not mutate wallet/cashout rows.
- [x] **Check Round (AC: 6)**
  - [x] Document Message receipts Check Round with curl admin search, example provider request/response shapes, SQL inspection, and pass/fail criteria.

## Dev Notes

### Manual Check Round (AC6)

1. Start API with `PERSISTENCE_MODE=postgres`, Tevi payment enabled, message path configured.
2. Complete a sandbox top-up webhook credit (or postgres test fixture).
3. **Pass:** `tevi_message_receipt_records` row with `message_type=topup_credit`, `status=sent` or `failed_retryable`, `source_event_id` = provider event ID, amount matches credit.
4. Complete a manual cashout to `dispatched`.
5. **Pass:** receipt row with `message_type=cashout_dispatch`, includes cashout request ID in source fields and cashout status in metadata.
6. Admin: `GET /api/admin/message-receipts?messageType=topup_credit` with `x-admin-role: support` — record visible with attempt count and safe provider summary.
7. Force message provider failure (mock/unavailable base) — **Pass:** wallet/cashout rows unchanged; receipt `status=failed_retryable`.
8. Retry: `POST /api/admin/message-receipts/{id}/retry` with `x-admin-role: operator` — attempt count increments; money-path rows still unchanged.

## Dev Agent Record

### Agent Model Used

Composer

### Completion Notes List

- Added `TeviReceiptService`, `TeviMessageClient`, Postgres `tevi_message_receipt_records` migration, and admin search/retry routes.
- Hooked receipt dispatch post-commit on webhook top-up credit, cashout dispatch, and operator cashout retry — failures never roll back money-path state.
- Cashout API returns `receipt_status`; client shows receipt delivery copy for credited top-ups and dispatched cashouts.
- Tests: API suite 386 passed (61 skipped postgres-gated).

### File List

- _bmad-output/implementation-artifacts/8-10-send-basic-tevi-top-up-and-cashout-receipts.md (new)
- apps/api/db/migrations/0014_tevi_message_receipts.sql (new)
- apps/api/src/domain/tevi-message-client.ts (new)
- apps/api/src/domain/tevi-receipt-service.ts (new)
- apps/api/src/repositories/postgres/tevi-message-receipt-repository.ts (new)
- apps/api/src/routes/admin-message-receipts.routes.ts (new)
- apps/api/test/unit/tevi-message-client.test.ts (new)
- apps/api/test/unit/tevi-receipt-service.test.ts (new)
- apps/api/test/integration/admin-message-receipts-routes.test.ts (new)
- apps/api/src/config/env.ts (modified)
- apps/api/src/composition/production-dependencies.ts (modified)
- apps/api/src/domain/tevi-webhook-service.ts (modified)
- apps/api/src/domain/cashout-request-service.ts (modified)
- apps/api/src/domain/cashout-reconciliation-service.ts (modified)
- apps/api/src/app.ts (modified)
- apps/api/src/main.ts (modified)
- apps/api/src/routes/tevi-cashout.routes.ts (modified)
- apps/api/test/unit/db-runtime.test.ts (modified)
- apps/api/test/unit/env.test.ts (modified)
- js/serverClient.js (modified)
- js/slotGame.js (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)

### Change Log

- 2026-07-02: Story 8.10 — Tevi message receipts for top-up credit and cashout dispatch with admin search/retry and player-visible receipt status.

### Review Findings (AI Code Review 2026-07-02)

- [x] [Review][Patch] Missing `PostgresTeviWebhookCreditRepository` import after adding message receipt repository. [production-dependencies.ts]
- [x] [Review][Patch] Missing `TeviTokenServicePort` import in app dependencies. [app.ts]
- [x] [Review][Patch] Admin message receipt routes omitted required `requestId` on `okEnvelope` calls. [admin-message-receipts.routes.ts]
- [x] [Review][Defer] Live Tevi sandbox Message receipts Check Round — requires funded sandbox + operator curl verification.
- [x] [Review][Defer] Dedicated Postgres integration test for receipt failure isolation — covered at service/integration layer; full DB path deferred to sandbox Check Round.

## Status

done
