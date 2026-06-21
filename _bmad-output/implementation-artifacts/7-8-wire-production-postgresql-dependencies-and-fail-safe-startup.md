# Story 7.8: Wire Production PostgreSQL Dependencies and Fail-Safe Startup

Status: done
baseline_commit: 72d1c33c9a77825d8b68b4a5bfab02bc36d4ecab

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want production startup to use PostgreSQL-backed services or fail safely,
so that reward-bearing play never runs on accidental in-memory state.

## Acceptance Criteria

1. Production startup and `PERSISTENCE_MODE=postgres` construct PostgreSQL-backed repositories and services for player identity/sessions, wallets, spins, game configuration, operator limits, metrics dependencies, alerts, budget protection, admin audit, request traces, and provider top-up idempotency.
2. `createApp(dependencies)` remains testable and keeps explicit in-memory dependencies available for local/unit tests; production composition lives outside default app construction.
3. Startup fails before listening when PostgreSQL mode has missing `DATABASE_URL`, an unreachable database, pending migrations, checksum mismatch, or schema readiness failure.
4. Startup never silently falls back to in-memory repositories or process-local ledgers in production/PostgreSQL mode.
5. `SEED_ACTIVE_CONFIG=true` cannot seed an in-memory active config in production/PostgreSQL mode.
6. PostgreSQL composition hydrates restart-critical caches before serving traffic: active config cache, active operator limits, active budget protection actions, alert state, and spin ledger/metrics source.
7. Liveness and readiness stay separate: `/api/health` reports API process health, while `/api/ready` reports database/schema readiness and returns 503 when PostgreSQL readiness fails.
8. Existing Phaser client behavior and successful API response envelopes remain unchanged for persisted sessions/spins/admin routes.
9. Tests cover production dependency selection, missing database URL, invalid persistence mode, database unavailable/readiness failure, schema not ready/pending migrations, explicit in-memory local composition, readiness responses, and prevention of in-memory config seeding in PostgreSQL mode.
10. No cash-out, redemption, transferable value, Tevi top-up processing, wallet crediting from provider records, crypto, currency conversion, or real-money semantics are introduced.

## Tasks / Subtasks

- [x] Add production dependency composition (AC: 1, 2, 4, 6, 10)
  - [x] Add `apps/api/src/composition/production-dependencies.ts` or equivalent.
  - [x] Construct a PostgreSQL pool from `DATABASE_URL` using `createPostgresPool`.
  - [x] Construct PostgreSQL repositories/services: `PostgresPlayerSessionRepository`, `PostgresWalletRepository`, `PostgresGameConfigurationRepository`, `PostgresSpinService`, `PostgresOperatorLimitsRepository`, `PostgresBudgetProtectionRepository`, `PostgresAlertRepository`, `PostgresAdminAuditRepository`, `PostgresRequestTraceRepository`, and `PostgresProviderTopUpIdempotencyRepository`.
  - [x] Ensure admin audit repository is shared into config/operator/budget/alert repositories so audit writes remain durable.
  - [x] Keep provider top-up idempotency repository composed for Story 7.9 verification/future integration, but do not add routes or top-up processing.
- [x] Add fail-safe startup path (AC: 3, 4, 5, 7)
  - [x] Update `apps/api/src/main.ts` to load env, select production dependencies when `NODE_ENV=production` or `PERSISTENCE_MODE=postgres`, and only start listening after composition/readiness succeeds.
  - [x] Ensure startup logs a structured or clear error and exits non-zero if PostgreSQL composition fails.
  - [x] Ensure `SEED_ACTIVE_CONFIG=true` is rejected or ignored with an explicit error in PostgreSQL mode before `createApp` can seed in-memory config.
  - [x] Add graceful pool cleanup on server close/shutdown if a production pool was created.
- [x] Preserve test/local app construction (AC: 2, 8)
  - [x] Do not make `createApp()` implicitly inspect production env and swap dependencies.
  - [x] Keep existing in-memory defaults for tests that call `createApp()` directly.
  - [x] Widen dependency interface types where needed from concrete `InMemory*` classes to repository interfaces so PostgreSQL implementations can be injected.
- [x] Hydrate restart-critical state before serving (AC: 1, 6, 7)
  - [x] Call `PostgresGameConfigurationRepository.getActiveRecord()` before serving so `getActiveConfig()` is populated.
  - [x] Call `PostgresOperatorLimitsRepository.load()` and `PostgresBudgetProtectionRepository.load()` before serving so spin validation uses persisted controls.
  - [x] Call `PostgresAlertRepository.load()` before serving so alert state survives restarts.
  - [x] Call `PostgresSpinService.loadLedger()` before serving so `MetricsService` can derive live metrics from durable spin ledgers until a dedicated metrics query repository exists.
  - [x] Wire `/api/ready` to `MigrationRunner.assertReady()` or equivalent schema readiness check.
- [x] Add tests (AC: all)
  - [x] Add unit tests for dependency selection and env/startup guardrails without opening a long-lived server where possible.
  - [x] Add PostgreSQL integration tests for production composition against the migrated test database.
  - [x] Add readiness route tests for PostgreSQL readiness success/failure envelopes.
  - [x] Add regression coverage that `createApp()` with default dependencies still uses in-memory local/test doubles.
  - [x] Add coverage that PostgreSQL mode does not allow in-memory active-config seeding.
- [x] Run gates and update BMAD status (AC: all)
  - [x] Run focused API typecheck and production-composition tests.
  - [x] Run full gate: DB migrate/check, root lint, root typecheck, root tests, build, and API PostgreSQL integration tests.
  - [x] Record debug evidence, completion notes, file list, review outcome, and mark done only after review is complete.

## Dev Notes

- Requirements: DP-FR12, DP-FR13, DP-FR15, DP-FR16, DP-FR17, DP-NFR3, DP-NFR6, DP-NFR7, DP-AC1, DP-AC12, DP-AC14, DP-AC15, DP-AC16.
- Story source: `_bmad-output/planning-artifacts/epics.md` Story 7.8.
- PRD/architecture source: `_bmad-output/planning-artifacts/epics.md` Database Persistence Architecture Requirements and `_bmad-output/planning-artifacts/architecture.md` Infrastructure and Deployment / Process Patterns.
- Story 7.8 owns the production composition boundary that earlier stories deliberately deferred. This is where PostgreSQL repositories become the production default, but not the local/test default.
- Story 7.9 owns final end-to-end persistence verification and documentation updates after this wiring exists.

### Existing Runtime Surfaces To Preserve

- `apps/api/src/config/env.ts` already validates `PORT`, `PERSISTENCE_MODE`, `NODE_ENV`, and `DATABASE_URL` for production/PostgreSQL mode.
- `apps/api/src/main.ts` currently always calls `createApp()` with default in-memory dependencies; this is the main production bug to fix.
- `apps/api/src/app.ts` keeps route registration and default in-memory doubles. Preserve `createApp(dependencies)` for tests, but widen `AppDependencies` types from concrete in-memory repositories to domain interfaces where PostgreSQL implementations now exist.
- `/api/health` and `/api/ready` live in `apps/api/src/routes/health.routes.ts`. Readiness already accepts an injected async `readinessCheck`.
- `apps/api/src/db/migrations.ts` exposes `MigrationRunner.assertReady()` and `toDatabaseReadinessError()`. Reuse these rather than creating another schema checker.
- `apps/api/src/db/pool.ts` exposes `createPostgresPool()` and `DatabaseReadinessError`.

### PostgreSQL Repositories Available

- `apps/api/src/repositories/postgres/player-session-repository.ts`
- `apps/api/src/repositories/postgres/wallet-repository.ts`
- `apps/api/src/repositories/postgres/game-configuration-repository.ts`
- `apps/api/src/repositories/postgres/spin-service.ts`
- `apps/api/src/repositories/postgres/operational-repositories.ts`
- `apps/api/src/repositories/postgres/provider-top-up-idempotency-repository.ts`

### Cache Hydration Requirements

- `PostgresGameConfigurationRepository.getActiveRecord()` refreshes active config cache used by `getActiveConfig()`.
- `PostgresOperatorLimitsRepository.load()` refreshes `getActiveLimits()` cache for spin validation.
- `PostgresBudgetProtectionRepository.load()` refreshes `listActiveActions()` cache for spin validation.
- `PostgresAlertRepository.load()` refreshes alert active/none state.
- `PostgresSpinService.loadLedger()` refreshes the in-memory ledger view consumed by `MetricsService`; this is acceptable until Story 7.9 or a later metrics repository replaces it with direct queries.

### Previous Story Intelligence

- Story 7.6 review explicitly deferred production startup cache hydration to Story 7.8. Do not skip it.
- Story 7.7 introduced provider top-up idempotency persistence but no route/service behavior. Compose the repository for readiness/future use only.
- Story 7.5 established that accepted spin/wallet/idempotency writes must stay in one DB transaction; production wiring should inject `PostgresSpinService` rather than layering another spin implementation.
- Recent commits: `72d1c33 feat(7-7): add top-up idempotency persistence`, `1db96a3 feat(7-6): persist operational controls and traces`, `60ae0db feat(7-5): persist accepted spins and idempotency`.

### Testing Guidance

- Focused test command:
  - `npm --workspace @china-slot-game/api run lint && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm --workspace @china-slot-game/api test -- test/unit/env.test.ts test/integration/health-routes.test.ts test/postgres/production-dependencies.test.ts`
- Full story gate:
  - `DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm test && npm run build && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run test:integration -w @china-slot-game/api`

### Project Structure Notes

- Expected new files:
  - `apps/api/src/composition/production-dependencies.ts`
  - `apps/api/test/postgres/production-dependencies.test.ts`
- Expected modified files:
  - `apps/api/src/app.ts`
  - `apps/api/src/main.ts`
  - `apps/api/src/config/env.ts` if an explicit `isPostgresPersistenceRequired` helper is useful.
  - `apps/api/test/unit/env.test.ts`
  - `apps/api/test/integration/health-routes.test.ts`
  - `_bmad-output/implementation-artifacts/sprint-status.yaml`
  - this story file

## Dev Agent Record

### Agent Model Used

GitHub Copilot

### Debug Log References

- `npm --workspace @china-slot-game/api run lint`
- `npm --workspace @china-slot-game/api run lint && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm --workspace @china-slot-game/api test -- test/unit/env.test.ts test/integration/health-routes.test.ts test/postgres/production-dependencies.test.ts`
- `DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm test && npm run build && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run test:integration -w @china-slot-game/api`
- `npm --workspace @china-slot-game/api run lint && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm --workspace @china-slot-game/api test -- test/unit/env.test.ts test/integration/health-routes.test.ts test/postgres/production-dependencies.test.ts`
- `DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm test && npm run build && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run test:integration -w @china-slot-game/api`

### Completion Notes List

- Added production dependency composition that constructs PostgreSQL repositories/services for sessions, wallets, spins, config, limits, budget protection, alerts, audit, request traces, and provider top-up idempotency.
- Wired `main.ts` to use PostgreSQL composition for production or `PERSISTENCE_MODE=postgres` before listening, with pool cleanup on server close/shutdown.
- Hydrated active config, operator limits, budget protection actions, alert state, and spin ledger before serving traffic.
- Wired PostgreSQL readiness through `MigrationRunner.assertReady()` while preserving `/api/health` liveness and default in-memory `createApp()` behavior.
- Added PostgreSQL production composition tests for dependency selection, readiness success/failure, pending schema failure, default in-memory app construction, and `SEED_ACTIVE_CONFIG` rejection.
- Completed review follow-ups by moving budget-protection enablement into validated env, adding explicit production startup failure logging, tightening production shutdown cleanup, adding unreachable-database coverage, and documenting/test-covering migrated empty DB fail-safe behavior.

### File List

- `_bmad-output/implementation-artifacts/7-8-wire-production-postgresql-dependencies-and-fail-safe-startup.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/src/app.ts`
- `apps/api/src/composition/production-dependencies.ts`
- `apps/api/src/main.ts`
- `apps/api/test/postgres/production-dependencies.test.ts`

### Change Log

- 2026-06-21: Created story context for implementation.
- 2026-06-21: Implemented production PostgreSQL composition and fail-safe startup; moved to review after focused and full gates passed.
- 2026-06-21: Addressed review findings, reran focused and full gates, and marked done.

### Senior Developer Review (AI)

- Outcome: Approved after follow-up fixes.
- Review layers: focused Explore review over Story 7.8 changed files.
- Findings patched:
  - Moved `BUDGET_PROTECTION_ENABLED` into validated env parsing and production composition.
  - Added explicit production startup failure logging before process exit.
  - Tightened shutdown cleanup so PostgreSQL pool shutdown is invoked from signal-driven server close.
  - Added unreachable database startup coverage.
  - Added explicit migrated-empty-database fail-safe coverage: startup can serve readiness, but reward-bearing spin attempts fail instead of using in-memory config.
- Scope review: No cash-out, redemption, transferable value, Tevi top-up processing, wallet crediting from provider records, crypto, currency conversion, or real-money semantics were introduced.
