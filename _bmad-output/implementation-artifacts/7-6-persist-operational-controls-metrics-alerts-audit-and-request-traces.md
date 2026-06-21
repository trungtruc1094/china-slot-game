# Story 7.6: Persist Operational Controls, Metrics, Alerts, Audit, and Request Traces

Status: done
baseline_commit: 60ae0db5f4ef2d883ee093ff0f7efa8589ea8011

## Story

As an operator or support user,
I want limits, metrics, alerts, audits, and request traces to survive restarts,
so that launch operations and incident review use one durable source of truth.

## Acceptance Criteria

1. In PostgreSQL persistence mode, operator limits, budget protection actions, alert rules/history, admin audit events, request traces, and metrics state are backed by PostgreSQL repositories instead of process-local collections.
2. Existing partial migrations for `operator_limits`, `operator_metric_buckets`, `alert_rules`, `alert_history`, `budget_protection_actions`, `budget_protection_audit_events`, and `admin_audit_events` are reconciled with the runtime repository contracts.
3. Active operator limits and active budget protection actions load from persisted state after service/repository reconstruction.
4. PostgreSQL-backed spin validation can evaluate persisted active operator limits and budget protection actions without bypassing the safeguards added in Story 7.5.
5. Budget and jackpot cap checks remain safe under concurrent spins or are explicitly serialized through database-backed state reads/writes where the current story owns the enforcement boundary.
6. Metrics are either derived from durable spin ledgers or stored in rebuildable buckets with the spin ledger as source of truth; restart/reconstruction must not lose observed RTP, hit rate, spend, active session, jackpot liability, or remaining budget values.
7. Alert rules, alert history, acknowledgments, and resolved/firing state survive API/repository restart and preserve the existing admin alert route response envelopes.
8. Admin audit events are durable, searchable, append-only, and preserve actor, role, action, resource type/id, request ID, reason, source, outcome, before/after, metadata, and occurred timestamp.
9. Request traces are durable and searchable enough for incident review, including request ID/correlation ID where available, method, route/path/action context, status/outcome, duration, error code when available, occurred timestamp, and relevant player/session/spin/admin identifiers when available.
10. Admin/support search can retrieve persisted operational records through existing route contracts or repository methods needed by those routes.
11. Existing in-memory implementations remain available as local/test doubles; Story 7.8 still owns production dependency composition and fail-safe startup wiring.
12. Persisted operational records preserve the non-cash reward boundary and do not introduce cash-out, redemption, transferable value, crypto, or currency conversion semantics.
13. Tests cover restart recovery, search filters, active limit loading, active protection loading, alert persistence, audit persistence, request trace persistence, metrics reconciliation, migration-from-empty/up-down-up behavior, and PostgreSQL-backed spin validation with persisted controls.

## Tasks / Subtasks

- [x] Reconcile operational schema (AC: 1, 2, 8, 9, 12, 13)
  - [x] Inspect migrations `0002` through `0005` and add a new migration only for missing columns/tables/indexes needed by runtime contracts.
  - [x] Preserve existing table names where possible: `operator_limits`, `operator_metric_buckets`, `alert_rules`, `alert_history`, `budget_protection_actions`, `budget_protection_audit_events`, `admin_audit_events`.
  - [x] Extend or add request trace persistence if no `request_traces` table exists.
  - [x] Ensure audit schema can store role, resource type/id, request ID, source, outcome, before/after JSON, metadata JSON, and occurred timestamp.
  - [x] Add indexes for active lookups and support/admin filters used by routes: scope/status, actor/action/source, resource type/id, request/correlation ID, path, outcome, status code, and time ranges.
- [x] Introduce PostgreSQL operational repositories (AC: 1, 3, 7, 8, 9, 10, 11)
  - [x] Add PostgreSQL implementations under `apps/api/src/repositories/postgres/` for operator limits, budget protection, alerts, admin audit, request traces, and metrics/bucket persistence or ledger-derived metrics.
  - [x] Keep repository interfaces asynchronous where needed and adapt route dependency types away from concrete `InMemory*` classes.
  - [x] Preserve current response shapes for admin operator limits, budget protection, alerts, audit search, metrics, and request tracing behavior.
  - [x] Keep in-memory repositories as defaults/test doubles; do not wire production composition in this story.
- [x] Persist active controls used by spin validation (AC: 3, 4, 5)
  - [x] Ensure PostgreSQL operator limits implement `OperatorLimitsProvider.getActiveLimits()` from persisted state.
  - [x] Ensure PostgreSQL budget protection implements `BudgetProtectionProvider.listActiveActions()` from persisted state.
  - [x] Add coverage that `PostgresSpinService` rejects spins using reconstructed PostgreSQL controls before wallet mutation.
  - [x] Document any remaining campaign-budget/jackpot concurrency limitation if full cross-process aggregate enforcement is deferred to metrics/production composition.
- [x] Persist or rebuild metrics from durable ledgers (AC: 6, 10, 13)
  - [x] Prefer deriving metrics from `spins` plus persisted controls/configs where practical, keeping `operator_metric_buckets` rebuildable rather than authoritative.
  - [x] Preserve existing `/api/admin/metrics` envelope and query validation.
  - [x] Cover restart/reconstruction and query filters by date/config/scope.
- [x] Persist alerts, audit, and traces (AC: 7, 8, 9, 10, 12)
  - [x] Persist alert rules/history and idempotent alert events.
  - [x] Persist alert acknowledgments and active alert state.
  - [x] Persist admin audit events from config/operator/alert/budget/search/reward/spin/auth sources without sensitive identity fields.
  - [x] Persist request traces from middleware and expose repository search/list operations needed by tests.
  - [x] Preserve non-cash language and avoid monetary semantics in metadata and docs.
- [x] Add PostgreSQL integration tests (AC: all)
  - [x] Cover migration up/down/up expectations including any new migration version.
  - [x] Cover each repository restart/reconstruction path.
  - [x] Cover route-level envelopes where interfaces become async.
  - [x] Cover spin validation with PostgreSQL operator limits and budget protection providers.
  - [x] Cover metrics reconciliation from persisted spin ledgers.
- [ ] Run gates and update BMAD status (AC: all)
  - [ ] Run PostgreSQL migration/check commands against an isolated test database.
  - [ ] Run `npm run lint`, `npm run typecheck`, PostgreSQL-backed `npm test`, `npm run build`, and the dedicated integration test script.
  - [ ] Record debug evidence, completion notes, file list, review outcome, and mark done only after review is complete.

## Dev Notes

- Requirements: DP-FR9, DP-FR10, DP-FR12, DP-FR13, DP-NFR1, DP-NFR3, DP-NFR5, DP-NFR8, DP-AC1, DP-AC11, DP-AC12.
- Story source: `_bmad-output/planning-artifacts/epics.md` Story 7.6.
- PRD source: `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/database-persistence-addendum.md` DP-FR-9, DP-FR-10, DP-FR-12, DP-FR-13.
- Architecture source: `_bmad-output/planning-artifacts/architecture.md` Database Persistence Architecture Update, Repository Boundaries, Schema Direction, Transaction Boundaries.
- Story 7.8 owns production dependency composition in `apps/api/src/main.ts`/`createApp`; do not make production startup wiring the center of this story.
- Existing partial operational migrations are already present:
  - `apps/api/db/migrations/0002_operator_limits.sql` creates `operator_limits` and a minimal `admin_audit_events` table.
  - `apps/api/db/migrations/0003_operator_metric_buckets.sql` creates `operator_metric_buckets`.
  - `apps/api/db/migrations/0004_alert_rules_and_history.sql` creates `alert_rules` and `alert_history`.
  - `apps/api/db/migrations/0005_budget_protection_actions.sql` creates `budget_protection_actions` and `budget_protection_audit_events`.
- The current `admin_audit_events` migration is thinner than `AdminAuditEventRecord`; reconcile with additive migration columns rather than dropping historical data.
- No `request_traces` table exists at story start; current request traces are in `InMemoryRequestTraceRepository`.
- Current metrics are derived by `MetricsService` from `SpinService.getLedger()`. With `PostgresSpinService`, call `loadLedger()` or introduce a PostgreSQL metrics/reconciliation boundary so restart does not leave metrics empty.
- Story 7.5 review deferred a separate request ID/correlation ID distinction: request traces should persist `request.requestId`; spin rows currently store the route request ID in both `request_id` and `correlation_id` until production composition passes richer trace context.
- Use `withTransaction(pool, async client => ...)` for multi-row state transitions that must be atomic. Plain SQL and `pg` remain the persistence style; do not introduce an ORM.
- Store integer values as point/minor units and preserve the non-cash reward boundary. Avoid cash/redeemable/currency conversion semantics.

### Existing Runtime Surfaces

- Operator limits: `apps/api/src/domain/operator-limits-repository.ts`, `apps/api/src/routes/admin-operator-limits.routes.ts`, `apps/api/test/integration/admin-operator-limits-routes.test.ts`.
- Budget protection: `apps/api/src/domain/budget-protection-repository.ts`, `apps/api/src/routes/admin-budget-protection.routes.ts`, `apps/api/test/integration/admin-budget-protection-routes.test.ts`.
- Alerts: `apps/api/src/domain/alert-repository.ts`, `apps/api/src/domain/alert-service.ts`, `apps/api/src/routes/admin-alerts.routes.ts`, `apps/api/test/integration/admin-alerts-routes.test.ts`.
- Metrics: `apps/api/src/domain/metrics-service.ts`, `apps/api/src/routes/admin-metrics.routes.ts`, `apps/api/test/integration/admin-metrics-routes.test.ts`.
- Admin audit: `apps/api/src/domain/admin-audit-repository.ts`, `apps/api/src/routes/admin-audit.routes.ts`, `apps/api/test/integration/admin-audit-search-routes.test.ts`.
- Request traces: `apps/api/src/domain/request-trace-repository.ts`, `apps/api/src/middleware/request-tracing.ts`.
- PostgreSQL patterns from prior stories: `apps/api/src/repositories/postgres/player-session-repository.ts`, `game-configuration-repository.ts`, `wallet-repository.ts`, `spin-service.ts`.

## Dev Agent Record

### Agent Model Used

GitHub Copilot

### Debug Log References

- `npm --workspace @china-slot-game/api run lint`
- `npm --workspace @china-slot-game/api run lint && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm --workspace @china-slot-game/api test -- test/postgres/migrations.test.ts test/postgres/operational-repositories.test.ts`
- `DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm test && npm run build && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run test:integration -w @china-slot-game/api`
- `npm --workspace @china-slot-game/api run lint && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm --workspace @china-slot-game/api test -- test/postgres/migrations.test.ts test/postgres/operational-repositories.test.ts`
- `DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm test && npm run build && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run test:integration -w @china-slot-game/api`

### Completion Notes List

- Added `0010_operational_audit_and_traces.sql` to extend `admin_audit_events` for the runtime audit contract and add durable `request_traces` with support indexes.
- Added awaitable operational repository interfaces and adapted admin routes/alert evaluation to support PostgreSQL implementations while keeping in-memory defaults.
- Added `PostgresOperatorLimitsRepository`, `PostgresBudgetProtectionRepository`, `PostgresAlertRepository`, `PostgresAdminAuditRepository`, and `PostgresRequestTraceRepository`.
- Added cache-loading methods for synchronous spin validation providers so reconstructed PostgreSQL limits and protection actions can be used by `PostgresSpinService` before Story 7.8 production wiring.
- Added PostgreSQL tests for restart/reconstruction, audit and trace persistence, alert state, budget protection, operator limits, metrics reconciliation, and spin validation with persisted controls.
- Completed review follow-ups by separating request ID from correlation ID in request traces, handling async trace persistence errors from middleware, and replacing avoidable full cache reloads after budget/alert writes with local cache updates.

### File List

- `_bmad-output/implementation-artifacts/7-6-persist-operational-controls-metrics-alerts-audit-and-request-traces.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/db/migrations/0010_operational_audit_and_traces.sql`
- `apps/api/src/domain/admin-audit-repository.ts`
- `apps/api/src/domain/alert-repository.ts`
- `apps/api/src/domain/alert-service.ts`
- `apps/api/src/domain/budget-protection-repository.ts`
- `apps/api/src/domain/operator-limits-repository.ts`
- `apps/api/src/domain/request-trace-repository.ts`
- `apps/api/src/repositories/postgres/operational-repositories.ts`
- `apps/api/src/routes/admin-alerts.routes.ts`
- `apps/api/src/routes/admin-audit.routes.ts`
- `apps/api/src/routes/admin-budget-protection.routes.ts`
- `apps/api/src/routes/admin-operator-limits.routes.ts`
- `apps/api/test/postgres/migrations.test.ts`
- `apps/api/test/postgres/operational-repositories.test.ts`
- `apps/api/test/unit/db-runtime.test.ts`

### Change Log

- 2026-06-21: Created story context for implementation.
- 2026-06-21: Implemented PostgreSQL-backed operational controls, alerts, audit, request traces, and metrics reconstruction; moved to review after green gates.
- 2026-06-21: Addressed review findings, reran focused and full PostgreSQL-backed gates, and marked done.

### Senior Developer Review (AI)

- Outcome: Approved after follow-up fixes.
- Review layers: focused Explore review over Story 7.6 changed files.
- Findings patched:
  - Added distinct `requestId` to `RequestTraceRecord` and persisted `request_id` separately from optional `x-correlation-id`.
  - Added async error handling around request trace persistence in middleware so PostgreSQL write failures are not silently ignored.
  - Replaced full cache reloads after budget-protection apply/revert and alert append operations with local cache updates while preserving explicit `load()` reconstruction paths.
- Deferred:
  - Production startup must call `load()` or compose PostgreSQL providers in Story 7.8. Story 7.6 keeps in-memory defaults by design and verifies reconstruction explicitly in repository tests.
