# Story 7.4: Persist Wallets and Wallet Transactions With Concurrency Safety

Status: done
baseline_commit: 196503722766e8154271a9d79360caddb88c79e7

## Story

As a player,
I want my non-cash point balance to be durable and correct under concurrent requests,
so that debits, credits, and adjustments cannot be lost or duplicated.

## Acceptance Criteria

1. In PostgreSQL persistence mode, each player has one durable wallet record for the current non-cash points balance.
2. Wallet creation is idempotent and safe under concurrent first use.
3. Debits, credits, free-spin awards, jackpot awards, and adjustments persist append-only wallet transaction rows.
4. Wallet transaction records include transaction ID, player ID, type, integer amount, balance before, balance after, actor, source, created time, correlation ID when available, and metadata.
5. Concurrent updates for the same player serialize through PostgreSQL row-level locks, conditional atomic updates, or an equivalent database-enforced mechanism.
6. Insufficient balance fails without mutating wallet balance or writing a wallet transaction.
7. Injected transaction failures roll back wallet balance changes and transaction inserts.
8. Wallet transaction history remains searchable by player, transaction type, source/session, spin ID when present, and date range.
9. Restarting repository/service instances does not lose wallet balances or transaction history.
10. Persisted wallet and transaction metadata preserves the non-cash reward boundary and does not introduce cash-out, redemption, transferable value, crypto, or currency conversion semantics.
11. Tests cover debit, credit, adjustment-like transaction types, insufficient balance, concurrent first-use creation, concurrent wallet updates, rollback after injected failure, restart recovery, admin/support transaction search filters, and non-cash reward labels/metadata.

## Tasks / Subtasks

- [x] Add wallet persistence schema (AC: 1, 2, 3, 4, 5, 8, 10)
  - [x] Add `wallets` with one row per `player_id`, integer balance, timestamps, and DB-level non-negative/safe status constraints where practical.
  - [x] Add `wallet_transactions` as append-only history with balance-before/after, actor, source, optional correlation ID, metadata, and timestamps.
  - [x] Add explicit foreign keys to `players` with delete behavior chosen to preserve historical explainability.
  - [x] Add indexes for player, type, source/session, spin ID from metadata or column, created range, and support search pagination.
- [x] Introduce PostgreSQL-compatible wallet service boundary (AC: 1, 3, 8, 9)
  - [x] Preserve existing `WalletService` public methods or extract an interface used by `SpinService`, `createApp`, and admin balance transaction routes.
  - [x] Keep the in-memory wallet implementation available as the local/unit default.
  - [x] Preserve current public API response envelopes and admin transaction serialization.
- [x] Add PostgreSQL wallet implementation (AC: 1, 2, 3, 4, 5, 6, 7, 9, 10)
  - [x] Create wallets idempotently with starter non-cash point balance.
  - [x] Apply single and batch wallet transactions inside database transactions.
  - [x] Serialize same-player concurrent mutations using `SELECT ... FOR UPDATE` or equivalent PostgreSQL locking.
  - [x] Roll back balance and transaction inserts on validation or injected persistence failures.
  - [x] Store correlation ID when supplied without changing existing callers that omit it.
  - [x] Ensure metadata remains JSON-safe and no client-provided balance-looking metadata can affect authoritative balance.
- [x] Adapt support/admin search to repository-backed transaction history (AC: 8, 10)
  - [x] Search by player, transaction type, source/session, spin ID when present, date range, limit, and offset.
  - [x] Preserve reward model metadata in responses.
  - [x] Preserve audit logging for support/admin searches and auth failures.
- [x] Add PostgreSQL integration tests (AC: all)
  - [x] Cover debit, credit, free-spin/jackpot/adjustment-like transaction types.
  - [x] Cover insufficient balance and unsafe integer rejection without side effects.
  - [x] Cover concurrent first wallet creation and concurrent debits/credits for the same player.
  - [x] Cover rollback after injected failure.
  - [x] Cover restart recovery by reconstructing the PostgreSQL wallet implementation.
  - [x] Cover admin/support transaction search filters and non-cash reward response metadata.
  - [x] Cover migration up/down/up expectations including the new migration version.
- [x] Run gates and update BMAD status (AC: all)
  - [x] Run PostgreSQL migration/check commands against an isolated test database.
  - [x] Run `npm run lint`, `npm run typecheck`, PostgreSQL-backed `npm test`, `npm run build`, and the dedicated integration test script.
  - [x] Record debug evidence, completion notes, file list, review outcome, and mark done only after review is complete.

## Dev Notes

- Requirements: DP-FR3, DP-FR4, DP-FR12, DP-FR17, DP-NFR1, DP-NFR2, DP-NFR3, DP-NFR8, DP-AC1, DP-AC4, DP-AC5, DP-AC6, DP-AC16.
- Story source: `_bmad-output/planning-artifacts/epics.md` Story 7.4.
- PRD source: `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/database-persistence-addendum.md` DP-FR-3 and DP-FR-4.
- Existing wallet domain surface lives in `apps/api/src/domain/wallet-service.ts`. Preserve current methods used by `SpinService`: `getWallet`, `getTransactions`, `listTransactions`, `applyTransaction`, and `applyTransactionBatch`.
- Existing `WalletService` starts new wallets at 1000 non-cash points. Preserve this behavior unless a later story explicitly introduces configurable wallet initialization.
- Existing batch behavior validates one player per batch, applies requests in order, records balance-before/after for each request, and rolls back the entire batch if any step fails.
- Existing failure injection hook `failAfterBalanceUpdate` is used by tests to prove rollback after a mid-flight persistence failure. PostgreSQL implementation should provide equivalent test-only behavior without leaking production behavior.
- Existing admin transaction search route lives in `apps/api/src/routes/admin-balance-transactions.routes.ts`. It serializes `rewardModel`, `transactionType`, `sessionId` from `source`, `spinId` from metadata, and whitelisted metadata keys only.
- Existing spin service stores wallet transaction metadata with `spinId` and `clientSpinId`; keep that metadata searchable and serializable.
- Story 7.5 will atomically combine wallet updates with accepted spin ledger/idempotency. Story 7.4 should make wallet operations transaction-safe on their own and ready to be composed later, but should not introduce accepted spin ledger tables.
- Use plain SQL migrations and `pg`; do not introduce an ORM.
- Use database snake_case and API camelCase. Store amounts as integers. Do not add cash/redeemable/currency semantics.
- Locking strategy: use idempotent `INSERT ... ON CONFLICT DO NOTHING` wallet creation followed by `SELECT ... FOR UPDATE` on the player's wallet row inside the same transaction. This serializes same-player wallet mutations while allowing different players to update independently.
- Delete behavior: `wallets.player_id` and `wallet_transactions.player_id` use `ON DELETE RESTRICT` to preserve wallet history and balance explainability for support/audit workflows. Future privacy deletion should use anonymization or policy-specific retention tooling rather than orphaning transaction history.

### Project Structure Notes

- Expected migration path: `apps/api/db/migrations/0008_wallets_and_transactions.sql` unless the migration number has already advanced.
- Expected PostgreSQL implementation path: `apps/api/src/repositories/postgres/wallet-repository.ts` or a similarly named wallet persistence implementation under `apps/api/src/repositories/postgres`.
- Expected tests: `apps/api/test/postgres/wallet-repository.test.ts`, plus updates to migration/unit tests that enumerate migration versions.

### References

- `_bmad-output/planning-artifacts/epics.md` Story 7.4: Persist Wallets and Wallet Transactions With Concurrency Safety.
- `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/database-persistence-addendum.md` DP-FR-3, DP-FR-4, DP-FR-12, DP-FR-17.
- `_bmad-output/planning-artifacts/architecture.md` Database Persistence Architecture Update, Transaction Boundaries, Schema Direction, Test Database Strategy.
- `apps/api/src/domain/wallet-service.ts` existing in-memory wallet behavior.
- `apps/api/src/domain/spin-service.ts` wallet batch call sites and spin metadata expectations.
- `apps/api/src/routes/admin-balance-transactions.routes.ts` existing support search and serialization behavior.
- `apps/api/test/unit/wallet-service.test.ts` existing wallet contract tests.
- `apps/api/test/integration/admin-balance-transactions-routes.test.ts` existing admin search contract tests.
- `_bmad-output/implementation-artifacts/7-1-create-postgresql-runtime-and-migration-harness.md` migration harness patterns.
- `_bmad-output/implementation-artifacts/7-2-persist-players-provider-identity-mappings-and-sessions.md` PostgreSQL repository/test patterns and player FK schema.
- `_bmad-output/implementation-artifacts/7-3-persist-configuration-versions-math-reports-and-simulation-runs.md` PostgreSQL repository/interface patterns and review lessons.

## Dev Agent Record

### Agent Model Used

GitHub Copilot

### Debug Log References

- `npm --workspace @china-slot-game/api run lint && npm --workspace @china-slot-game/api test -- test/unit/wallet-service.test.ts test/integration/admin-balance-transactions-routes.test.ts`
- `TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm --workspace @china-slot-game/api test -- test/postgres/migrations.test.ts test/postgres/wallet-repository.test.ts`
- `DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm test && npm run build && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run test:integration -w @china-slot-game/api`
- `npm --workspace @china-slot-game/api run lint && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm --workspace @china-slot-game/api test -- test/unit/wallet-service.test.ts test/integration/admin-balance-transactions-routes.test.ts test/postgres/migrations.test.ts test/postgres/wallet-repository.test.ts`
- `DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm test && npm run build && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run test:integration -w @china-slot-game/api`

### Completion Notes List

- Added `0008_wallets_and_transactions.sql` with durable wallets, append-only wallet transactions, DB-level balance/amount constraints, row FKs, and search indexes.
- Added `WalletOperations` interface and adapted spin service, app composition, and admin balance transaction routes to accept in-memory or PostgreSQL-backed wallet implementations.
- Added `PostgresWalletRepository` with idempotent wallet creation, row-locked transactional batch updates, rollback on validation/injected failure, correlation ID storage, and post-callback metadata persistence for spin IDs.
- Preserved existing in-memory wallet behavior and admin transaction response envelope, including reward model metadata and redacted transaction metadata.
- Added PostgreSQL tests for debit/credit/award/adjustment persistence, concurrent wallet creation and mutation, rollback, restart recovery, admin search, migration coverage, and non-cash reward metadata.
- Completed code-review follow-ups by adding database-backed wallet transaction search, callback metadata row-count validation, safe bigint DB constraints, batch rollback coverage, spin ID search coverage, FK restrict coverage, and locking/delete rationale documentation.

### File List

- `_bmad-output/implementation-artifacts/7-4-persist-wallets-and-wallet-transactions-with-concurrency-safety.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/db/migrations/0008_wallets_and_transactions.sql`
- `apps/api/src/app.ts`
- `apps/api/src/domain/spin-service.ts`
- `apps/api/src/domain/wallet-service.ts`
- `apps/api/src/repositories/postgres/wallet-repository.ts`
- `apps/api/src/routes/admin-balance-transactions.routes.ts`
- `apps/api/test/postgres/migrations.test.ts`
- `apps/api/test/postgres/wallet-repository.test.ts`
- `apps/api/test/unit/db-runtime.test.ts`
- `apps/api/test/unit/wallet-service.test.ts`

### Change Log

- 2026-06-21: Created story context for implementation.
- 2026-06-21: Implemented PostgreSQL-backed wallet and wallet transaction persistence; moved to review after green gates.
- 2026-06-21: Addressed review findings, reran focused and full PostgreSQL-backed gates, and marked done.

### Senior Developer Review (AI)

- Outcome: Approved after follow-up fixes.
- Review layers: Blind Hunter, Edge Case Hunter, and Acceptance Auditor.
- Findings patched:
  - Pushed admin/support transaction search into `WalletOperations.searchTransactions` and PostgreSQL SQL filters so wallet indexes are used instead of loading all transactions into memory.
  - Added callback metadata persistence row-count validation and selected `spin_id` consistently with metadata fallback.
  - Added safe integer constraints for persisted wallet balances and transaction amounts/balances.
  - Added batch rollback, spin ID search, and FK restrict regression coverage.
  - Documented `SELECT ... FOR UPDATE` locking and `ON DELETE RESTRICT` history-preservation rationale.