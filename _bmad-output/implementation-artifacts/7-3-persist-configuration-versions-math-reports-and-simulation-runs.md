# Story 7.3: Persist Configuration Versions, Math Reports, and Simulation Runs

Status: done
baseline_commit: b4d3e099551662b3ebf17601d55e9fc5f26278c3

## Story

As a host,
I want configuration drafts, activations, rollbacks, math reports, and simulation runs stored durably,
so that live economics and historical spin explanations survive restarts.

## Acceptance Criteria

1. In PostgreSQL persistence mode, existing configuration, math report, simulation, activation, rollback, active-config, and admin audit behavior is backed by PostgreSQL repositories instead of process-local maps.
2. Existing partial migration `0001_game_configurations.sql` is reconciled with any missing math report and simulation persistence tables without breaking clean migrate-up, migrate-down, migrate-up behavior.
3. Draft configurations remain editable until activation and never affect live spins.
4. Activated configuration versions are immutable for gameplay purposes except explicit retirement or rollback status transitions.
5. Rollback changes only future spins and preserves historical version references and math/simulation records.
6. Math reports remain linked to the draft/config version they evaluated and are immutable once attached.
7. Simulation runs remain linked to the draft/config version and math report context they evaluated.
8. Simulation persistence writes only simulation records and never mutates player wallets, sessions, or live spin ledger tables.
9. Restarting repository/service instances does not lose drafts, active versions, retired versions, rollback state, math reports, or simulation runs.
10. Tests cover draft lifecycle, activation, rollback, math report attachment, simulation storage/list/get, migration-from-empty behavior, restart recovery of active config, and non-mutation of player/session/spin tables during simulation storage.

## Tasks / Subtasks

- [x] Reconcile configuration persistence schema (AC: 1, 2, 4, 6, 7, 8)
  - [x] Add migration tables for math reports and simulation runs if missing.
  - [x] Preserve `game_config_versions` status constraints, one-active invariant, and status-transition trigger behavior.
  - [x] Choose explicit FK delete behavior that preserves historical explainability.
  - [x] Add indexes needed by draft lookup, active config lookup, version lookup, math report lookup, and simulation list/get.
- [x] Introduce an implementation-neutral configuration repository boundary (AC: 1)
  - [x] Type routes and app composition against repository/provider interfaces, not `InMemoryGameConfigurationRepository` directly.
  - [x] Keep the in-memory repository available as the default local/unit implementation.
  - [x] Preserve public admin config API response envelopes and error codes unless a persistence-safe behavior requires an intentional change.
- [x] Add PostgreSQL configuration repository implementation (AC: 1, 3, 4, 5, 6, 7, 9)
  - [x] Persist draft create/update/read/list behavior.
  - [x] Persist math report attachment and enforce one immutable report per draft.
  - [x] Persist simulation run store/list/get behavior.
  - [x] Persist activation by retiring the previous active version, assigning version numbers, and marking the draft active atomically.
  - [x] Persist rollback by retiring the current active version and restoring the target activated version as active.
  - [x] Ensure `getActiveConfig` and active record reads survive repository reconstruction.
- [x] Add PostgreSQL integration tests (AC: all)
  - [x] Cover draft lifecycle and version uniqueness.
  - [x] Cover math report immutability and persistence across repository reconstruction.
  - [x] Cover simulation storage/list/get persistence across repository reconstruction.
  - [x] Cover activation, one-active invariant, retirement, rollback, and active config restart recovery.
  - [x] Cover migration up/down/up expectations including new migration versions.
  - [x] Cover simulation persistence does not mutate player/session/spin-ledger tables; if spin tables are not introduced yet, assert it does not mutate existing player/session tables and document spin-ledger coverage for story 7.5.
- [x] Run gates and update BMAD status (AC: all)
  - [x] Run PostgreSQL migration/check commands against an isolated test database.
  - [x] Run `npm run lint`, `npm run typecheck`, PostgreSQL-backed `npm test`, `npm run build`, and the dedicated integration test script.
  - [x] Record debug evidence, completion notes, file list, and mark story done only after review is complete.

## Dev Notes

- Requirements: DP-FR8, DP-FR12, DP-FR13, DP-NFR1, DP-NFR3, DP-NFR8, DP-AC1, DP-AC9, DP-AC12.
- Story source: `_bmad-output/planning-artifacts/epics.md` Story 7.3.
- PRD source: `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/database-persistence-addendum.md` DP-FR-8 and migration/test requirements.
- Architecture source: `_bmad-output/planning-artifacts/architecture.md` Database Persistence Architecture Update.
- Existing migration `apps/api/db/migrations/0001_game_configurations.sql` already creates `game_config_versions`, status enum, one-active partial index, and status transition trigger. Add a new migration rather than rewriting committed migration history unless a test proves the existing migration is incompatible.
- Existing domain surface lives in `apps/api/src/domain/game-configuration-repository.ts`. It currently contains the record types and `InMemoryGameConfigurationRepository`; introduce a repository interface that includes the methods used by routes and services.
- Existing admin config API lives in `apps/api/src/routes/admin-config.routes.ts`. Route handlers currently call repository methods synchronously; PostgreSQL methods will be async, so route handlers and repository interfaces likely need to become async while preserving response bodies.
- Existing app composition in `apps/api/src/app.ts` types `configRepository` as the in-memory class. Update the dependency type to accept the interface/provider needed by both in-memory and PostgreSQL implementations.
- Existing PostgreSQL utilities from story 7.1 live under `apps/api/src/db`, and PostgreSQL repository examples from story 7.2 live under `apps/api/src/repositories/postgres`.
- Existing PostgreSQL integration tests use `TEST_DATABASE_URL`, reset the public schema, apply migrations, and run with `--no-file-parallelism` because test files reset the same schema.
- Keep database snake_case and API camelCase. Store config/report/simulation payloads as JSONB where the domain object is already JSON-serializable.
- Activated versions are gameplay history. Do not mutate the player-visible config payload after activation; allowed lifecycle changes are status, activation metadata for rollback/retirement, and audit metadata required for operations.
- Simulation runs must remain offline/admin artifacts. They must not write wallets, sessions, accepted spins, balance transactions, or idempotency records.
- Story 7.5 will introduce durable spin ledger tables; this story should not invent spin acceptance persistence beyond ensuring configuration version records are ready to be referenced later.

### Project Structure Notes

- Expected new PostgreSQL implementation path: `apps/api/src/repositories/postgres/game-configuration-repository.ts`.
- Expected migration path: `apps/api/db/migrations/0007_configuration_reports_and_simulations.sql` unless the codebase has already advanced the migration number before implementation.
- Expected tests: `apps/api/test/postgres/game-configuration-repository.test.ts`, plus updates to migration/unit tests that enumerate migration versions.

### References

- `_bmad-output/planning-artifacts/epics.md` Story 7.3: Persist Configuration Versions, Math Reports, and Simulation Runs.
- `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/database-persistence-addendum.md` DP-FR-8, DP-FR-12, DP-FR-13, DP-FR-14.
- `_bmad-output/planning-artifacts/architecture.md` Database Persistence Architecture Update, Repository Boundaries, Schema Direction, Migration Strategy, Test Database Strategy.
- `apps/api/src/domain/game-configuration-repository.ts` existing in-memory behavior and record types.
- `apps/api/src/routes/admin-config.routes.ts` existing public admin config API behavior.
- `apps/api/db/migrations/0001_game_configurations.sql` existing configuration version schema.
- `_bmad-output/implementation-artifacts/7-1-create-postgresql-runtime-and-migration-harness.md` migration harness lessons and debug evidence.
- `_bmad-output/implementation-artifacts/7-2-persist-players-provider-identity-mappings-and-sessions.md` PostgreSQL repository/test patterns and serialized integration test behavior.

## Dev Agent Record

### Agent Model Used

GitHub Copilot

### Debug Log References

- `npm --workspace @china-slot-game/api run lint`
- `TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm --workspace @china-slot-game/api test -- test/postgres/migrations.test.ts test/postgres/game-configuration-repository.test.ts`
- `DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm test && npm run build`
- `TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm run test:integration -w @china-slot-game/api`
- `npm --workspace @china-slot-game/api run lint && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm --workspace @china-slot-game/api test -- test/postgres/game-configuration-repository.test.ts test/postgres/migrations.test.ts`
- `DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm test && npm run build && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm run test:integration -w @china-slot-game/api`

### Completion Notes List

- Added `0007_configuration_reports_and_simulations.sql` for durable math reports, simulation runs, config-specific audit events, and lookup indexes while preserving existing `game_config_versions` lifecycle constraints.
- Introduced a `GameConfigurationRepository` interface so admin config routes and app composition can use in-memory or PostgreSQL-backed repositories.
- Added `PostgresGameConfigurationRepository` with persisted draft create/update/read/list, immutable math report attachment, simulation run store/list/get, atomic activation, rollback, active-config cache refresh, and config audit events.
- Updated admin configuration routes to await the shared repository boundary while preserving response envelopes and error codes.
- Added PostgreSQL tests for repository lifecycle, restart recovery, route smoke coverage, migrations, and simulation non-mutation of player/session tables.
- Completed code-review follow-ups by moving activation validation artifacts into the PostgreSQL repository transaction, adding negative-path tests, and adding rollback route smoke coverage.

### File List

- `_bmad-output/implementation-artifacts/7-3-persist-configuration-versions-math-reports-and-simulation-runs.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/db/migrations/0007_configuration_reports_and_simulations.sql`
- `apps/api/src/app.ts`
- `apps/api/src/domain/game-configuration-repository.ts`
- `apps/api/src/repositories/postgres/game-configuration-repository.ts`
- `apps/api/src/routes/admin-config.routes.ts`
- `apps/api/test/postgres/game-configuration-repository.test.ts`
- `apps/api/test/postgres/migrations.test.ts`
- `apps/api/test/unit/db-runtime.test.ts`

### Change Log

- 2026-06-21: Created story context for implementation.
- 2026-06-21: Implemented PostgreSQL-backed configuration, math report, simulation, activation, and rollback persistence; moved to review after green gates.
- 2026-06-21: Addressed review findings, reran focused and full PostgreSQL-backed gates, and marked done.

### Senior Developer Review (AI)

- Outcome: Approved after follow-up fixes.
- Review layers: Blind Hunter, Edge Case Hunter, and Acceptance Auditor.
- Findings patched:
  - Repository-level activation now rejects missing math reports, missing simulation runs, and error-level math diagnostics inside the transaction.
  - PostgreSQL tests cover missing validation artifacts, blocking diagnostics, and rollback through the admin route.
  - Simulation non-mutation coverage is scoped to tables that exist in story 7.3; wallet and spin-ledger table coverage remains with stories 7.4 and 7.5 where those tables are introduced.
- Findings dismissed/deferred:
  - Per-row math report subquery is acceptable for the small admin configuration list and remains indexed through `game_config_math_reports_unique_draft`.
  - Multi-instance active-config cache invalidation is deferred to production composition/fail-safe startup in story 7.8; this story verifies restart recovery through explicit active-record reload.