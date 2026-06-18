---
baseline_commit: 7a97267
---

# Story 4.3: Build Metrics Aggregation

Status: done

## Story

As a host,
I want live operating metrics,
So that I can understand game economics during a campaign.

## Acceptance Criteria

1. Admin metrics return total wagered, total paid, observed RTP, theoretical RTP, hit rate, player count, active sessions, jackpot liability, remaining budget, and alert state.
2. Metrics can be filtered by UTC time window and configuration version.
3. Metric values reconcile against accepted spin ledger records.
4. Observed RTP and theoretical RTP are clearly separate fields.
5. Aggregation correctness is tested against a known input set.

## Tasks/Subtasks

- [x] Add accepted-at timestamps to spin ledger entries.
- [x] Add metrics aggregation service and admin metrics route.
- [x] Support time-window and configuration-version filters.
- [x] Include budget and alert-state fields.
- [x] Add tests with a known input set and reconciliation assertions.
- [x] Document persistence, retention, indexing, backfill/replay, UTC bucketing, API contracts, and assumptions.

## Dev Notes

### Persistence Approach

Metrics aggregation is derived durable state from append-only source records:

- Source tables: `spins` and `balance_transactions` remain the truth for accepted outcomes and wallet movement.
- Aggregate table: `operator_metric_buckets`
  - Columns: `bucket_start_at timestamptz`, `bucket_size_seconds integer`, `config_version_id text`, `scope_id text`, `total_wagered_minor integer`, `total_paid_minor integer`, `spin_count integer`, `hit_count integer`, `player_count integer`, `active_session_count integer`, `jackpot_liability_minor integer`, `created_at timestamptz`, `updated_at timestamptz`.
  - Retention: keep raw source ledgers per launch retention policy; keep 1-minute buckets for 90 days and roll up to hourly buckets retained for 2 years.
  - Indexing: primary key `(bucket_start_at, bucket_size_seconds, scope_id, config_version_id)`, lookup index `(scope_id, bucket_start_at)`, and config filter index `(config_version_id, bucket_start_at)`.
- Time bucketing: UTC only. V1 route computes live metrics directly from accepted ledger rows and documents the durable bucket contract; future background jobs should materialize 60-second UTC buckets.
- Backfill/replay: backfill is supported by replaying append-only `spins` rows ordered by `accepted_at` into deterministic UTC buckets. No destructive recomputation of source ledgers is in scope.

### API Contracts

- `GET /api/admin/metrics?from=<iso>&to=<iso>&configVersionId=<id>&scopeId=<scope>`
  - Request query parameters are optional; `from` and `to` are ISO datetimes and use UTC comparisons.
  - Response: `{ "data": { "metrics": { "totalWagered", "totalPaid", "observedRtp", "theoreticalRtp", "hitRate", "playerCount", "activeSessions", "jackpotLiability", "remainingBudget", "alertState", "filters", "bucket" } }, "error": null }`
  - Errors: `ADMIN_UNAUTHORIZED`, `INVALID_METRICS_QUERY`.

### Assumptions

- V1 `alertState` is `"none"` until Story 4.4 adds alert history.
- `remainingBudget` is computed from active operator limits for `scopeId` minus total paid in the filtered window.
- Metrics read accepted spin ledger entries only; rejected spins never appear in metrics.

## Dev Agent Record

### Implementation Plan

- Add ledger timestamps in `SpinService`.
- Add `MetricsService` and admin metrics route.
- Wire metrics route into `createApp`.
- Add deterministic integration tests against known spin outcomes.

### Debug Log

- `npm --workspace @china-slot-game/api test -- admin-metrics-routes` passed.
- `npm --workspace @china-slot-game/api run typecheck` passed.
- `npm run lint && npm run typecheck && npm test && npm run build` passed.

### Completion Notes

- Added accepted-at timestamps to spin ledger entries.
- Added `MetricsService` and `GET /api/admin/metrics` with UTC time-window, config-version, and scope filters.
- Metrics aggregate accepted ledger rows into total wagered, total paid, observed RTP, theoretical RTP, hit rate, player count, active sessions, jackpot liability, remaining budget, and alert state.
- Added `0003_operator_metric_buckets.sql` to document the durable aggregate table, retention target, and indexes.
- Added deterministic integration tests against a known input set and filtered replay window.

## Senior Developer Review (AI)

Outcome: Approve

Evidence:

- Acceptance criteria covered by `apps/api/test/integration/admin-metrics-routes.test.ts`.
- Aggregation correctness is tested against a known input set: one winning spin and one losing spin reconcile to total wagered `2`, total paid `5`, observed RTP `2.5`, hit rate `0.5`, two players, two sessions, and remaining budget `95`.
- Time-window filtering is tested with UTC ISO bounds and returns only the later accepted ledger row.
- Config-version filtering is part of the tested request contract.
- Observed RTP and theoretical RTP are separate response fields.
- Persistence approach, table schema, retention, indexing, UTC bucket size, and backfill/replay strategy are documented in Dev Notes before 4-5.
- Public API contract and assumptions are documented in Dev Notes.
- Lint, typecheck, tests, and build are clean.

### File List

- `_bmad-output/implementation-artifacts/4-3-build-metrics-aggregation.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/db/migrations/0003_operator_metric_buckets.sql`
- `apps/api/src/app.ts`
- `apps/api/src/domain/metrics-service.ts`
- `apps/api/src/domain/spin-service.ts`
- `apps/api/src/routes/admin-metrics.routes.ts`
- `apps/api/test/integration/admin-metrics-routes.test.ts`

### Change Log

- 2026-06-18: Implemented live metrics aggregation from accepted spin ledger rows with UTC filters and persistence contract.
