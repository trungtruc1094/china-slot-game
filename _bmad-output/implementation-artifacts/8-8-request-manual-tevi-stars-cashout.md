---
baseline_commit: 374ce34
---

# Story 8.8: Request Manual Tevi Stars Cashout

Status: done

## Story

As a winning player,
I want to enter a Stars amount and request cashout from my game wallet,
so that I can choose when and how much available balance to transfer back through Tevi.

## Acceptance Criteria

1. Given an authenticated Tevi player with available internal Stars balance, when the player submits a manual cashout amount through the game UI, then the backend validates integer Star amount, available wallet balance, Tevi readiness, and player identity.
2. Rejected requests for insufficient balance, invalid amount, or unavailable Tevi configuration do not mutate wallet, ledger, idempotency, or provider dispatch state.
3. Accepted requests create a cashout request record linked to internal player ID, Tevi user ID, requested amount, wallet debit, idempotency key, payload fingerprint, status, attempt count, and request ID.
4. The cashout request transaction commits before any Tevi provider cashout call is attempted.
5. It derives a UUIDv4-compatible `Idempotency-Key` from the authoritative cashout request ID.
6. It calls Tevi `POST /api/v1/payments/cashout` with `X-API-Key`, `Idempotency-Key`, rewards payload, and description after internal commit.
7. Retry with the same idempotency key and payload does not double-payout.
8. Reuse of the same idempotency key with a changed payload records a conflict for reconciliation.
9. Internal wallet and cashout request state remain correct when the Tevi cashout call fails, times out, or returns a retryable provider error.
10. The story ends with manual cashout amount-entry and idempotency Check Rounds (insufficient-balance rejection, replay, conflict behavior).

## Tasks / Subtasks

- [x] **Migration — cashout_requests table (AC: 3, 4)**
  - [x] Add `apps/api/db/migrations/0013_cashout_requests.sql` with status enum, wallet txn FK, idempotency key, payload fingerprint, dispatch metadata.
- [x] **Domain — CashoutRequestService + Tevi dispatch (AC: 1–9)**
  - [x] Add `cashout-request-service.ts` with validation, idempotency derivation, post-commit dispatch.
  - [x] Extend `tevi-payment-client.ts` with `dispatchCashout` (`X-API-Key`, `Idempotency-Key`, rewards body).
  - [x] Add `cashout-request-repository.ts` — atomic wallet debit + cashout row in one transaction.
- [x] **Route — POST /api/v1/payments/cashout-requests (AC: 1–2)**
  - [x] Add `tevi-cashout.routes.ts` with `requireTeviAuth`, zod `{ amount }`, envelope response.
  - [x] Wire in `app.ts`, `main.ts`, `production-dependencies.ts`, `env.ts` (cashout path default `/api/v1/payments/cashout`).
- [x] **Client — Cash Out modal (AC: 1, 10)**
  - [x] `serverClient.js` — `requestCashout(amount)`.
  - [x] `popups.js` — `createCashoutPUHandler` (presets, receive-after-fee display, status line).
  - [x] `slotGame.js` — Cash Out entry, `submitCashout`, pending/dispatched/failed states, balance refresh.
  - [x] `slotConfig3x5.js` — portrait/landscape control positions; `index.html` cache-bust.
- [x] **Tests (AC: 1–9)**
  - [x] Unit: service validation, idempotency derivation, Tevi client dispatch (mock fetch).
  - [x] Integration: route success, insufficient balance, invalid amount, idempotent replay, conflicting payload.
  - [x] Postgres: atomic debit + single payout row under concurrent delivery.
  - [x] Client VM harness: extend `server-client.test.ts` for cashout flow.
- [x] **Check Round (AC: 10)**
  - [x] Manual sandbox hand-off documented below (requires human Tevi sandbox run).

## Out of Scope / Defer

- Full reconciliation UI and operator retry tooling → Story 8.9.
- Compliance/KYC/self-exclusion/host-float hard stops → Epic 9 (stub pass-through in sandbox MVP).
- Receipts → Story 8.10.

## Completion Notes

- Backend: `POST /api/v1/payments/cashout-requests` debits wallet atomically, records `cashout_requests`, then dispatches Tevi cashout post-commit. Idempotency key derived from cashout request ID; payload fingerprint guards replay conflicts.
- Client: Cash Out button + modal with 1% fee receive display, `requestCashout` API client, balance update on success.
- Tests: `npm run lint -w @china-slot-game/api` green; full suite 346 passed (58 skipped postgres-gated).

### Review Findings (AI Code Review 2026-07-01)

- [x] [Review][Patch] Replay same `request_id` with mismatched amount now returns `TEVI_CASHOUT_IDEMPOTENCY_CONFLICT` via payload fingerprint check. [cashout-request-service.ts]
- [x] [Review][Patch] `pending` cashout rows resume provider dispatch on retry instead of falsely reporting `dispatched`. [cashout-request-service.ts]
- [x] [Review][Defer] AC10 live Tevi sandbox cashout Check Round — requires funded sandbox + human verification of provider dispatch. [manual]
- [x] [Review][Defer] Epic 9 compliance/self-exclusion/host-float gates — pass-through in sandbox MVP. [Epic 9]
- [x] [Review][Defer] Operator reconciliation/retry UI for `failed_retryable` — Story 8.9.

### Manual Check Round Hand-off (AC10)

1. Launch Tevi mini-app sandbox with `TEVI_PAYMENT_ENABLED=true` and Postgres.
2. Spin/deposit to build withdrawable balance; open **CASH OUT** modal.
3. Verify insufficient balance rejection (amount > balance) — no wallet change.
4. Submit valid amount; confirm balance drops immediately and status shows dispatched or failed_retryable.
5. Replay same `x-request-id` via curl — identical envelope, no double debit.
6. Replay with same request id but different amount body — expect 409 conflict.
