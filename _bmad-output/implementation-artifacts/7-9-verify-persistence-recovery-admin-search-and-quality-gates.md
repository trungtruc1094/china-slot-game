# Story 7.9: Verify Persistence Recovery, Admin Search, and Quality Gates

Status: done
baseline_commit: 2f9f9a9e7ce9fb0d7d4055ef202cf90c41724904

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a host,
I want persistence recovery and launch gates verified end to end,
so that the game is ready for Tevi planning only after durable state is proven.

## Acceptance Criteria

1. CI/local verification can provision or connect to an isolated PostgreSQL database, apply migrations, run persistence integration tests, and report migration or database failures as a named gate.
2. Tests prove restart recovery for players, sessions, wallets, wallet transactions, accepted spins, configuration history, active limits, active budget protection, alerts, audit events, request traces, metrics history, and future top-up idempotency records.
3. Tests prove duplicate spin retries do not double debit or double credit after PostgreSQL-backed commit/reconstruction.
4. Tests prove concurrent wallet updates for the same player do not corrupt balances or transaction history.
5. Tests prove admin/support search can retrieve persisted records after repository/app reconstruction.
6. Launch readiness documentation marks database persistence as required before Tevi integration.
7. CI quality-gate documentation includes PostgreSQL migration, readiness, and integration checks as named gates.
8. Verification preserves existing Phaser/client behavior boundaries; no gameplay presentation changes are introduced.
9. No cash-out, redemption, transferable value, Tevi top-up processing, wallet crediting from provider records, crypto, currency conversion, or real-money semantics are introduced.
10. Full validation gate passes with PostgreSQL integration tests and build.

## Tasks / Subtasks

- [x] Add end-to-end persistence verification coverage (AC: 1, 2, 3, 4, 5, 9)
  - [x] Add a PostgreSQL integration test that migrates a clean DB and creates durable records across all Epic 7 repository families.
  - [x] Reconstruct repositories/services inside the test and verify persisted players, sessions, wallets, transactions, spins, config, limits, budget protection, alerts, audit, traces, metrics, and provider top-up idempotency can be read after reconstruction.
  - [x] Include duplicate spin retry verification after reconstruction and assert wallet transaction count does not grow.
  - [x] Include concurrent wallet update verification against the same player.
  - [x] Include admin/support-style search methods for sessions, wallet transactions, spin ledger, audit/trace, and operational records where available.
- [x] Update operational documentation (AC: 1, 6, 7, 8, 9)
  - [x] Update `docs/operations/ci-quality-gates.md` with named PostgreSQL migration/readiness/integration gates and local commands.
  - [x] Update `docs/operations/launch-readiness-checklist.md` to include Epic 7 persistence evidence and a required database persistence gate before Tevi planning/integration.
  - [x] Preserve non-cash and no-Tevi-processing language.
- [x] Run gates and update BMAD status (AC: all)
  - [x] Run focused PostgreSQL persistence verification tests.
  - [x] Run full gate: DB migrate/check, root lint, root typecheck, root tests, build, and API PostgreSQL integration tests.
  - [x] Record debug evidence, completion notes, file list, review outcome, and mark done only after review is complete.

## Dev Notes

- Requirements: DP-FR12, DP-FR13, DP-FR14, DP-FR15, DP-FR16, DP-FR17, DP-NFR3, DP-NFR5, DP-NFR8, DP-AC1, DP-AC2, DP-AC4, DP-AC7, DP-AC9, DP-AC10, DP-AC11, DP-AC12, DP-AC13, DP-AC14, DP-AC15, DP-AC16.
- Story source: `_bmad-output/planning-artifacts/epics.md` Story 7.9.
- This is the last implementation story in Epic 7. Do not run the retrospective automatically; report feature-complete after this story is done.
- Reuse existing PostgreSQL repository tests where possible; this story should add a final cross-slice verification layer and documentation updates, not duplicate every low-level test.
- Story 7.8 added production dependency composition and readiness checks. This story should verify the whole persistence stack is demonstrably ready for Tevi planning, while still not implementing Tevi top-ups.

### Existing Verification Surfaces

- Migration harness: `apps/api/src/db/migrations.ts`, tests in `apps/api/test/postgres/migrations.test.ts` and `apps/api/test/unit/db-runtime.test.ts`.
- Production composition: `apps/api/src/composition/production-dependencies.ts`, tests in `apps/api/test/postgres/production-dependencies.test.ts`.
- Prior PostgreSQL tests cover individual persistence families under `apps/api/test/postgres/`.
- CI docs: `docs/operations/ci-quality-gates.md`.
- Launch docs: `docs/operations/launch-readiness-checklist.md`.

### Testing Guidance

- Focused test command:
  - `npm --workspace @china-slot-game/api run lint && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm --workspace @china-slot-game/api test -- test/postgres/persistence-recovery.test.ts`
- Full story gate:
  - `DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm test && npm run build && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run test:integration -w @china-slot-game/api`

### Project Structure Notes

- Expected new files:
  - `apps/api/test/postgres/persistence-recovery.test.ts`
- Expected modified files:
  - `docs/operations/ci-quality-gates.md`
  - `docs/operations/launch-readiness-checklist.md`
  - `_bmad-output/implementation-artifacts/sprint-status.yaml`
  - this story file

## Dev Agent Record

### Agent Model Used

GitHub Copilot

### Debug Log References

- `npm --workspace @china-slot-game/api run lint && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm --workspace @china-slot-game/api test -- test/postgres/persistence-recovery.test.ts`
- `DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm test && npm run build && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run test:integration -w @china-slot-game/api`

### Completion Notes List

- Added `persistence-recovery.test.ts`, a cross-stack PostgreSQL integration test covering migration, durable gameplay/config/operations/top-up-idempotency records, repository reconstruction, metrics recovery, duplicate spin retry safety, concurrent wallet updates, and admin/support search surfaces.
- Review follow-up tightened the recovery test with explicit final wallet balance, reconstructed spin ledger, and persisted alert rule/history assertions.
- Updated CI quality-gate docs to name PostgreSQL schema readiness and require migration/readiness/integration gates before Tevi planning.
- Updated launch readiness docs with Epic 7 evidence and a database persistence gate that blocks Tevi planning/integration until CI and Donnie acceptance.
- Preserved non-cash reward language and did not add Tevi processing, wallet crediting from provider records, cash-out, redemption, crypto, currency conversion, or real-money semantics.

### File List

- `_bmad-output/implementation-artifacts/7-9-verify-persistence-recovery-admin-search-and-quality-gates.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/test/postgres/persistence-recovery.test.ts`
- `docs/operations/ci-quality-gates.md`
- `docs/operations/launch-readiness-checklist.md`

### Change Log

- 2026-06-21: Created story context for implementation.
- 2026-06-21: Added final persistence recovery verification and documentation gates; moved to review after focused and full gates passed.
- 2026-06-21: Addressed review coverage findings, reran focused and full gates, and marked story done.

## QA Results

### Review Date: 2026-06-21

### Reviewed By: GitHub Copilot

### Review Findings

- Fixed: concurrent wallet update coverage now asserts the final recovered wallet balance after simultaneous credits.
- Fixed: spin ledger recovery now asserts the reconstructed ledger contains the expected persisted spin.
- Fixed: operational record coverage now asserts persisted alert rules and alert history can be listed after reconstruction.
- Not changed: PostgreSQL tests continue using the existing repository test harness pattern of resetting the dedicated test schema before and after runs.

### Validation

- PASS: `npm --workspace @china-slot-game/api run lint && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm --workspace @china-slot-game/api test -- test/postgres/persistence-recovery.test.ts`
- PASS: `DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm test && npm run build && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run test:integration -w @china-slot-game/api`
