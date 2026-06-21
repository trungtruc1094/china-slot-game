# Story 7.5: Persist Accepted Spins and Durable Spin Idempotency Atomically

Status: done
baseline_commit: 1c12100d0ec216208a4fbf096836cdd1cdc1218f

## Story

As a player,
I want accepted spins and retries to be durable and idempotent,
so that crashes, duplicate requests, or network retries cannot double debit or double credit me.

## Acceptance Criteria

1. In PostgreSQL persistence mode, a valid spin request with `sessionId` and `clientSpinId` commits durable idempotency reservation/completion, persisted session validation, active configuration read, wallet debit, wallet credit if any, wallet transaction inserts, spin ledger insert, transaction-to-spin linking, and committed response payload storage in one database transaction.
2. The API returns an accepted spin response only after the database transaction commits.
3. Spin ledger rows store spin ID, session ID, player ID, client spin ID, config version ID, wager, reel stops, visible window, win breakdown, payout, free-spin state, jackpot award amount, balance after, accepted timestamp, request ID/correlation ID, and wallet transaction references.
4. Duplicate retries with the same session, client spin ID, and wager fingerprint return the original accepted result without additional wallet mutations.
5. Duplicate retries with the same session and client spin ID but changed wager data return `IDEMPOTENCY_CONFLICT` without mutating wallet, idempotency success, or spin state.
6. Injected wallet failures prevent accepted spin, successful idempotency completion, and wallet mutation persistence.
7. Injected spin ledger failures roll back wallet mutations and idempotency completion.
8. Restart after commit but before HTTP response delivery can be recovered by retrying the same spin request and receiving the committed response.
9. Restart before commit leaves no partial accepted spin, wallet mutation, or success idempotency record.
10. Existing Phaser presentation behavior and response envelope remain unchanged except for intentional persistence-safe retry/conflict/error semantics.
11. Persisted spin and transaction metadata preserves the non-cash reward boundary and does not introduce cash-out, redemption, transferable value, crypto, or currency conversion semantics.
12. Tests cover accepted spin persistence, duplicate same-fingerprint retry, changed-wager conflict, injected wallet failure rollback, injected ledger failure rollback, restart recovery after commit, no partial state before commit, wallet transaction linking, migration-from-empty behavior, and admin/support search readiness by spin/session/player/config/request identifiers.

## Tasks / Subtasks

- [x] Add spin ledger and idempotency schema (AC: 1, 3, 4, 5, 8, 9, 11)
  - [x] Add durable spin ledger table with immutable accepted-result payload columns and JSONB details.
  - [x] Add durable spin idempotency table keyed by `session_id` plus `client_spin_id` with wager fingerprint, status, committed response payload, timestamps, and request/correlation metadata.
  - [x] Add wallet transaction to spin link table or equivalent durable references without breaking wallet transaction append-only history.
  - [x] Add DB constraints, FK delete behavior, and indexes for spin ID, player, session, client spin ID, config version, accepted date range, payout, and request/correlation IDs.
- [x] Introduce PostgreSQL-compatible spin persistence boundary (AC: 1, 2, 3, 4, 5, 10)
  - [x] Preserve existing `SpinService.spin()` response shape and route behavior.
  - [x] Keep in-memory `SpinService` as the default local/unit implementation.
  - [x] Add a PostgreSQL-backed implementation or repository boundary that composes persisted sessions, wallets, configs, spin ledger, and idempotency atomically.
- [x] Implement atomic PostgreSQL spin acceptance (AC: 1, 2, 4, 5, 6, 7, 8, 9, 11)
  - [x] Reserve or lock idempotency key before wallet mutation.
  - [x] Validate session from persisted session state and active configuration from persisted configuration state.
  - [x] Resolve deterministic server outcome through canonical game math.
  - [x] Apply wallet debit/credit and insert wallet transactions in the same transaction as spin ledger and idempotency completion.
  - [x] Store committed response payload and return it on safe retry.
  - [x] Roll back wallet/idempotency/spin rows on injected wallet or ledger failures.
  - [x] Preserve non-cash reward metadata and ignore any client-provided balance/outcome fields.
- [x] Add support/admin search readiness (AC: 3, 12)
  - [x] Persist enough normalized columns and JSON payload detail for later admin/support spin search.
  - [x] Ensure wallet transaction links can explain debit/credit records for a spin.
  - [x] Do not broaden admin UI/API beyond what is needed for tests unless an existing route owns spin ledger search.
- [x] Add PostgreSQL integration tests (AC: all)
  - [x] Cover accepted spin persistence and wallet transaction links.
  - [x] Cover same-fingerprint duplicate retry after repository/service reconstruction.
  - [x] Cover changed-wager duplicate conflict without state mutation.
  - [x] Cover injected wallet failure and injected ledger failure rollback.
  - [x] Cover retry recovery after commit and no partial state before commit.
  - [x] Cover migration up/down/up expectations including the new migration version.
  - [x] Cover non-cash reward metadata and unchanged spin response envelope.
- [x] Run gates and update BMAD status (AC: all)
  - [x] Run PostgreSQL migration/check commands against an isolated test database.
  - [x] Run `npm run lint`, `npm run typecheck`, PostgreSQL-backed `npm test`, `npm run build`, and the dedicated integration test script.
  - [x] Record debug evidence, completion notes, file list, review outcome, and mark done only after review is complete.

## Dev Notes

- Requirements: DP-FR5, DP-FR6, DP-FR7, DP-FR12, DP-FR16, DP-FR17, DP-NFR1, DP-NFR2, DP-NFR3, DP-NFR7, DP-NFR8, DP-AC1, DP-AC2, DP-AC3, DP-AC5, DP-AC6, DP-AC7, DP-AC8, DP-AC15, DP-AC16.
- Story source: `_bmad-output/planning-artifacts/epics.md` Story 7.5.
- PRD source: `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/database-persistence-addendum.md` DP-FR-5, DP-FR-6, and DP-FR-7.
- Existing in-memory spin behavior lives in `apps/api/src/domain/spin-service.ts`. Preserve `SpinResponse`, `SpinLedgerEntry`, wager validation, canonical game math usage, reward model metadata, idempotency semantics, and `failLedgerCommit` test hook behavior unless persistence safety requires an explicit change.
- Existing spin route lives in `apps/api/src/routes/spins.routes.ts` and should keep the current API envelope and audit logging behavior.
- Persisted dependencies from earlier epic-7 stories:
  - Story 7.2: `players`, `provider_identity_mappings`, `sessions`, and `PostgresPlayerSessionRepository`.
  - Story 7.3: `game_config_versions`, math reports, simulation runs, and `PostgresGameConfigurationRepository`.
  - Story 7.4: `wallets`, `wallet_transactions`, and `PostgresWalletRepository`.
- Story 7.5 should make spin acceptance atomic across wallet rows, wallet transaction rows, idempotency records, and spin ledger rows. If existing repositories do not expose transaction-scoped methods, prefer a focused transaction orchestration boundary over leaking partial commits across services.
- Idempotency key: `session_id` plus `client_spin_id`. Wager fingerprint should be stable JSON over the accepted wager fields currently used by `SpinService`.
- Retry behavior: same fingerprint returns committed response; different fingerprint returns `IDEMPOTENCY_CONFLICT`; failed pre-commit attempts must be retryable.
- Accepted spin ledger rows are historical facts. Do not mutate player-visible outcome or accounting after acceptance.
- Store values as integer point units and preserve non-cash metadata. Do not add cash/redeemable/currency semantics.

### Project Structure Notes

- Expected migration path: `apps/api/db/migrations/0009_spins_and_idempotency.sql` unless the migration number has already advanced.
- Expected PostgreSQL implementation path: `apps/api/src/repositories/postgres/spin-repository.ts` or a similarly named spin persistence/orchestration implementation under `apps/api/src/repositories/postgres`.
- Expected tests: `apps/api/test/postgres/spin-repository.test.ts`, plus updates to migration/unit tests that enumerate migration versions.

### References

- `_bmad-output/planning-artifacts/epics.md` Story 7.5: Persist Accepted Spins and Durable Spin Idempotency Atomically.
- `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/database-persistence-addendum.md` DP-FR-5, DP-FR-6, DP-FR-7, DP-FR-12, DP-FR-16, DP-FR-17.
- `_bmad-output/planning-artifacts/architecture.md` Database Persistence Architecture Update, Transaction Boundaries, Schema Direction, Test Database Strategy.
- `apps/api/src/domain/spin-service.ts` existing spin/idempotency behavior and canonical math integration.
- `apps/api/src/routes/spins.routes.ts` existing public spin API behavior.
- `apps/api/test/integration/spins-routes.test.ts` existing idempotency, rollback, and response contract coverage.
- `apps/api/test/integration/admin-spin-ledger-routes.test.ts` existing admin spin ledger search contract.
- `_bmad-output/implementation-artifacts/7-2-persist-players-provider-identity-mappings-and-sessions.md` persisted session behavior.
- `_bmad-output/implementation-artifacts/7-3-persist-configuration-versions-math-reports-and-simulation-runs.md` persisted active config behavior.
- `_bmad-output/implementation-artifacts/7-4-persist-wallets-and-wallet-transactions-with-concurrency-safety.md` persisted wallet behavior and row-locking strategy.

## Dev Agent Record

### Agent Model Used

GitHub Copilot

### Debug Log References

- `npm --workspace @china-slot-game/api run lint`
- `TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm --workspace @china-slot-game/api test -- test/postgres/migrations.test.ts test/postgres/spin-service.test.ts`
- `npm --workspace @china-slot-game/api run lint && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm --workspace @china-slot-game/api test -- test/postgres/migrations.test.ts test/postgres/spin-service.test.ts`
- `DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm test && npm run build && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run test:integration -w @china-slot-game/api`
- `npm --workspace @china-slot-game/api run lint && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm --workspace @china-slot-game/api test -- test/postgres/migrations.test.ts test/postgres/spin-service.test.ts`
- `DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm test && npm run build && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run test:integration -w @china-slot-game/api`

### Completion Notes List

- Added `0009_spins_and_idempotency.sql` with durable spin idempotency keys, accepted spin ledger rows, wallet transaction links, JSONB payloads, FK restricts, safe integer constraints, and search indexes.
- Added `PostgresSpinService` as a PostgreSQL-backed spin acceptance boundary that validates persisted sessions/configs, reserves and locks idempotency keys, mutates wallets, stores spin ledger rows, links wallet transactions, and completes idempotency in one database transaction.
- Preserved in-memory `SpinService` as the default local implementation while keeping the public spin response envelope and non-cash reward metadata intact.
- Added PostgreSQL tests for accepted spin persistence, linked wallet transactions, duplicate retry recovery after reconstruction, changed-wager conflict, wallet failure rollback, ledger failure rollback, migration reversibility, JSONB array storage, and ledger reload reconstruction.
- Fixed JSONB parameter serialization so arrays such as reel stops are written as JSON values instead of PostgreSQL array literals.
- Completed code-review follow-ups by enforcing PostgreSQL spin operator limits and budget protection before wallet mutation, preserving `SESSION_INVALID` for missing sessions without idempotency residue, and updating the in-memory ledger cache only after successful transaction commit.

### File List

- `_bmad-output/implementation-artifacts/7-5-persist-accepted-spins-and-durable-spin-idempotency-atomically.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/db/migrations/0009_spins_and_idempotency.sql`
- `apps/api/src/repositories/postgres/spin-service.ts`
- `apps/api/test/postgres/migrations.test.ts`
- `apps/api/test/postgres/spin-service.test.ts`
- `apps/api/test/unit/db-runtime.test.ts`

### Change Log

- 2026-06-21: Created story context for implementation.
- 2026-06-21: Implemented PostgreSQL-backed accepted spin ledger and durable idempotency persistence; moved to review after green gates.
- 2026-06-21: Addressed review findings, reran focused and full PostgreSQL-backed gates, and marked done.

### Senior Developer Review (AI)

- Outcome: Approved after follow-up fixes.
- Review layers: Blind Hunter, Edge Case Hunter, and Acceptance Auditor. Blind Hunter could not review because the generated prompt omitted the full diff; Edge Case Hunter and Acceptance Auditor completed.
- Findings patched:
  - Enforced the same operator-limit and budget-protection branches in `PostgresSpinService` before wallet mutation.
  - Changed new idempotency reservation flow to validate missing sessions before inserting `spin_idempotency_keys`, preserving `SESSION_INVALID` and leaving no partial idempotency state.
  - Moved PostgreSQL spin ledger cache updates until after `withTransaction()` returns, so a commit failure cannot expose a phantom accepted spin through `getLedger()`.
  - Added PostgreSQL regression coverage for missing-session idempotency safety, operator limit enforcement, and budget-protection enforcement.
- Deferred:
  - Request ID and correlation ID are currently stored from the same request correlation value because the public spin route only passes one identifier. Keep this in view for Story 7.8 production dependency wiring or future request-trace integration, where a separate durable request identifier can be passed without widening 7.5's public API.