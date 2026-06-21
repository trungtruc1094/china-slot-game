# Story 7.1: Create PostgreSQL Runtime and Migration Harness

Status: done
baseline_commit: de94b9ed7c2d2911c1f15c28b2be213e5f477be8

## Story

As a developer,
I want a PostgreSQL connection, schema readiness check, and SQL migration runner,
so that production persistence can be introduced safely and repeatably.

## Acceptance Criteria

1. `@china-slot-game/api` includes `pg` or an equivalent node-postgres dependency, a PostgreSQL pool module, a transaction helper, and a schema readiness check.
2. Ordered SQL migrations under `apps/api/db/migrations` are applied through a migration runner that records applied migrations.
3. Migration execution from an empty PostgreSQL database succeeds in an isolated test database.
4. A failed migration blocks schema readiness and surfaces a structured error.
5. Production or `PERSISTENCE_MODE=postgres` startup fails when `DATABASE_URL` is missing or invalid.
6. Local/test modes can still inject explicit in-memory dependencies without pretending to be production.
7. Migrations are reversible with `up` and `down` directions, and a PostgreSQL integration test covers `migrate up && migrate down && migrate up` from a clean database.
8. Migration tooling is invokable from npm scripts.
9. Dev notes document local PostgreSQL setup with Docker compose, environment variables, and ports.
10. CI can spin up PostgreSQL and run migrations.

## Tasks / Subtasks

- [x] Add PostgreSQL runtime dependency and env validation (AC: 1, 5, 6)
  - [x] Add `pg` and TypeScript types to `@china-slot-game/api`.
  - [x] Extend `loadEnv` with `PERSISTENCE_MODE`, `DATABASE_URL`, and production/postgres fail-fast validation.
  - [x] Preserve explicit in-memory local/test composition behavior.
- [x] Add PostgreSQL pool and transaction helper (AC: 1, 4)
  - [x] Add `apps/api/src/db/pool.ts` with connection health/readiness checks and structured errors.
  - [x] Add `apps/api/src/db/transactions.ts` for transaction-scoped work.
- [x] Add migration runner (AC: 2, 3, 4, 7, 8)
  - [x] Support ordered migration files under `apps/api/db/migrations`.
  - [x] Track applied migrations in a schema migrations table.
  - [x] Support `up` and `down` execution.
  - [x] Add npm scripts for migrate/check/test integration entry points.
- [x] Add PostgreSQL local and CI harness (AC: 3, 7, 9, 10)
  - [x] Add Docker compose configuration for local PostgreSQL.
  - [x] Add integration test setup that requires an isolated test `DATABASE_URL`.
  - [x] Update CI quality gates to provision PostgreSQL and run migration checks.
- [x] Add tests and verification (AC: all)
  - [x] Test env fail-fast behavior for production/postgres mode.
  - [x] Test migration `up && down && up` against PostgreSQL.
  - [x] Test failed migration blocks schema readiness with a structured error against PostgreSQL.
  - [x] Run `npm test`, `npm run build`, and the PostgreSQL-backed integration test.

## Dev Notes

- Requirements: DP-FR13, DP-FR14, DP-FR15, DP-NFR3, DP-NFR6, DP-NFR8, DP-AC9, DP-AC10, DP-AC14.
- Architecture decision: use PostgreSQL with plain SQL migrations and `node-postgres` (`pg`), not Prisma. Existing migration files `0001` through `0005` are partial schema and must be reconciled into the canonical runner without changing current API behavior.
- Expected file locations from architecture: `apps/api/src/config/env.ts`, `apps/api/src/db/pool.ts`, `apps/api/src/db/transactions.ts`, `apps/api/src/composition/production-dependencies.ts` later in the epic, PostgreSQL repositories later under `apps/api/src/repositories/postgres`, and migrations under `apps/api/db/migrations`.
- This story is harness-only. Do not swap player/session/wallet/spin/config/operations repositories to PostgreSQL yet; later 7.x stories own those behavior migrations.
- Public API contracts must remain stable. Health/readiness may add database/schema readiness detail, but successful existing in-memory API behavior and Phaser presentation must not change.
- Production mode rules: `NODE_ENV=production` or `PERSISTENCE_MODE=postgres` must require a valid `DATABASE_URL` and must not silently fall back to in-memory persistence.
- Migration reversibility is required by the epic-7 gate for this story. Existing migration artifacts may need paired `down` operations or a runner convention that can reverse each migration safely in test databases.
- Local PostgreSQL setup must be documented for developers, including Docker compose service name, port, database/user/password, `DATABASE_URL`, and test database URL.
- CI update should extend the existing quality-gates workflow from Epic 6 with PostgreSQL service provisioning and migration checks.
- Pre-flight finding from retrospectives: prior epics intentionally shaped in-memory repositories like production storage but repeatedly called out missing live PostgreSQL execution, durable idempotency, ACID wallet/spin transactions, indexed retention, and CI migration checks.
- Local PostgreSQL setup uses Docker Compose service `postgres`, host port `55432`, database `china_slot_test`, user `china_slot`, password `china_slot_password`, and `postgres://china_slot:china_slot_password@localhost:55432/china_slot_test` for both `DATABASE_URL` and `TEST_DATABASE_URL` in local migration/integration checks.

## Dev Agent Record

### Agent Model Used

GitHub Copilot

### Debug Log References

- `npm test && npm run build` (pre-flight in-memory gate passed before epic-7 migration work)
- `npm --workspace @china-slot-game/api test -- unit/env.test.ts unit/db-runtime.test.ts integration/health-routes.test.ts unit/ci-quality-gates.test.ts`
- `docker compose up -d postgres` (blocked: `docker` command not found)
- `command -v docker || true`; `command -v podman || true`; `command -v psql || true`; `command -v initdb || true`; `command -v postgres || true` (no PostgreSQL/container runtime found)
- `npm test && npm run build` (passed after fixing strict optional readiness wiring; PostgreSQL integration file skipped because no test database URL/runtime is available)
- Homebrew PostgreSQL 18 disposable cluster start with `/opt/homebrew/opt/postgresql@18/bin/initdb`, `pg_ctl`, and `createdb` on port `55432`
- `TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm run test:integration -w @china-slot-game/api`
- `DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm run db:check -w @china-slot-game/api`
- `npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm test && npm run build`
- Post-review rerun: `DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm run db:check -w @china-slot-game/api`
- Post-review rerun: `npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm test && npm run build`

### Completion Notes List

- Added `pg` runtime dependency, PostgreSQL env validation, pool readiness checks, transaction helper, reversible migration runner, CLI scripts, Docker Compose service, CI PostgreSQL provisioning, and migration tests.
- Verified against a real PostgreSQL 18 test database using the Homebrew keg binaries because Docker is not available in this environment.
- Code review requested hardening for URL validation, schema migration table detection, empty rollback sections, test DB safety, and CI/local doc clarity; all were patched and the full gate was rerun successfully.

### File List

- `_bmad-output/implementation-artifacts/7-1-create-postgresql-runtime-and-migration-harness.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `.github/workflows/quality-gates.yml`
- `apps/api/package.json`
- `apps/api/src/config/env.ts`
- `apps/api/src/db/migrate.ts`
- `apps/api/src/db/migrations.ts`
- `apps/api/src/db/pool.ts`
- `apps/api/src/db/transactions.ts`
- `apps/api/src/app.ts`
- `apps/api/src/routes/health.routes.ts`
- `apps/api/test/fixtures/invalid-migrations/0001_missing_down.sql`
- `apps/api/test/fixtures/empty-down-migrations/0001_empty_down.sql`
- `apps/api/test/postgres/migrations.test.ts`
- `apps/api/test/unit/db-runtime.test.ts`
- `apps/api/test/unit/env.test.ts`
- `apps/api/test/integration/health-routes.test.ts`
- `apps/api/test/unit/ci-quality-gates.test.ts`
- `docker-compose.yml`
- `docs/operations/ci-quality-gates.md`
- `docs/operations/postgresql-persistence.md`
- `package-lock.json`

### Change Log

- 2026-06-21: Created story context for implementation.
- 2026-06-21: Implemented PostgreSQL runtime and migration harness, verified with PostgreSQL 18 integration tests, completed review hardening, and marked story done.

## Senior Developer Review (AI)

### Review Date

2026-06-21

### Review Outcome

Approve

### Review Evidence

- Acceptance criteria covered by tests: env validation in `apps/api/test/unit/env.test.ts`, reversible migration parsing in `apps/api/test/unit/db-runtime.test.ts`, real PostgreSQL `migrate up && migrate down && migrate up` and failed-migration readiness in `apps/api/test/postgres/migrations.test.ts`, readiness route behavior in `apps/api/test/integration/health-routes.test.ts`, and CI contract in `apps/api/test/unit/ci-quality-gates.test.ts`.
- Assumptions documented in Dev Notes: plain SQL plus `pg`, harness-only scope, local PostgreSQL setup, Docker Compose values, production/postgres `DATABASE_URL` rule, and no repository swap in 7-1.
- Public API contracts unchanged for default in-memory readiness; `/api/ready` still returns `api: ready` unless an explicit readiness dependency is injected.
- Lint/typecheck/test/build passed with PostgreSQL integration enabled: `npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm test && npm run build`.
- PostgreSQL migration tooling passed: `db:migrate`, `db:check`, and `test:integration` against a disposable PostgreSQL 18 database.
- Story artifact `Status: done` matches `sprint-status.yaml`.

### Review Follow-ups Completed

- [x] Tightened `DATABASE_URL` validation to require PostgreSQL scheme, hostname, and database name.
- [x] Changed schema migrations table readiness check to use an explicit boolean `to_regclass(...) IS NOT NULL` result.
- [x] Rejected migration files with empty `up` or `down` SQL sections.
- [x] Tightened PostgreSQL integration test database naming guard.
- [x] Clarified CI-only PostgreSQL credentials and local-versus-CI ports in docs/workflow.