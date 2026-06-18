---
baseline_commit: 7625f5c
---

# Story 4.4: Create Alert Rules and Alert History

Status: done

## Story

As a host,
I want alerts when operational thresholds are crossed,
So that I can react before reward exposure gets out of hand.

## Acceptance Criteria

1. Authorized operators can configure alert thresholds.
2. Alert evaluation creates alerts with metric value, threshold, time window, severity, and suggested operator action.
3. Alert evaluation is deterministic and idempotent for the same metrics window.
4. Alert history is append-only and retained.
5. Authorized operators can acknowledge alerts.
6. Alert state appears in admin metrics.

## Tasks/Subtasks

- [x] Add alert rule and alert history repository.
- [x] Add deterministic alert evaluation service.
- [x] Add admin alert rule, evaluate, list, and acknowledge routes.
- [x] Integrate alert state into admin metrics.
- [x] Add tests for fires-once-per-window, stops-firing-when-resolved, append-only history, and acknowledgments.
- [x] Document persistence, retention, indexing, API contracts, and assumptions.

## Dev Notes

### Persistence Approach

Alerts write durable operational history:

- `alert_rules`: stores rule id, scope id, metric type, threshold, severity, enabled flag, suggested action, actor metadata, and timestamps.
- `alert_history`: append-only event stream with alert id, rule id, deterministic evaluation key, status (`firing`, `resolved`, `acknowledged`), metric value, threshold, window start/end, severity, suggested action, actor/source, and created timestamp.
- Retention: keep `alert_rules` while a campaign or scope exists plus 2 years; retain `alert_history` for 2 years minimum for operational audit.
- Indexing: unique active rule id primary key; `alert_history` unique index on `(rule_id, evaluation_key, status)` to make replays idempotent; lookup indexes on `(scope_id, status, created_at)` and `(rule_id, window_start_at, window_end_at)`.

### API Contracts

- `POST /api/admin/alert-rules`
  - Request: `{ "id", "scopeId", "metric", "threshold", "severity", "suggestedAction", "enabled"? }`
  - Response: `{ "data": { "alertRule": AlertRule }, "error": null }`
- `POST /api/admin/alerts/evaluate`
  - Request: `{ "from"?, "to"?, "scopeId"?, "configVersionId"? }`
  - Response: `{ "data": { "alerts": AlertHistoryEvent[] }, "error": null }`
- `GET /api/admin/alerts`
  - Response: append-only alert history events.
- `POST /api/admin/alerts/:id/acknowledge`
  - Request: `{ "reason"?: string }`
  - Response: acknowledgment event appended to history.
- Errors: `ADMIN_UNAUTHORIZED`, `INVALID_ALERT_RULE`, `INVALID_ALERT_EVALUATION`, `ALERT_NOT_FOUND`.

### Assumptions

- V1 supports metrics already available from 4.3: `observedRtpAbove`, `observedRtpBelow`, `remainingBudgetBelow`, and `jackpotLiabilityAbove`.
- Alert evaluation reads metrics; it never mutates spin, wallet, or limit state.
- Resolution is represented by an append-only `resolved` event when a previously firing rule no longer crosses its threshold for a later window.

## Dev Agent Record

### Implementation Plan

- Add alert repository/service and routes.
- Add optional alert state provider to metrics.
- Add deterministic integration tests.

### Debug Log

- `npm --workspace @china-slot-game/api test -- admin-alerts-routes` passed.
- `npm --workspace @china-slot-game/api run typecheck` passed.
- `npm run lint && npm run typecheck && npm test && npm run build` passed.

### Completion Notes

- Added alert rule and append-only alert history repository with deterministic rule/window/status idempotency.
- Added alert evaluation for observed RTP, remaining budget, and jackpot liability metrics.
- Added admin routes for rule upsert/list, evaluation, history list, and acknowledgment.
- Integrated alert state into `GET /api/admin/metrics`.
- Added durable `alert_rules` and `alert_history` migration contract with retention and indexes documented above.

## Senior Developer Review (AI)

Outcome: Approve

Evidence:

- Acceptance criteria covered by `apps/api/test/integration/admin-alerts-routes.test.ts`.
- Deterministic idempotency is tested: re-running the same rule/window returns the same `alert_1` and does not append a duplicate.
- Append-only history is tested: firing, resolved, and acknowledged states append new history events rather than mutating prior events.
- Rule stops firing when resolved is tested with a later non-firing metrics window that appends `resolved` and causes metrics `alertState` to return `none`.
- Alert acknowledgment is tested with actor, reason, and retained firing history.
- Public API contract, assumptions, persistence table schema, retention, and indexing are documented in Dev Notes.
- Lint, typecheck, tests, and build are clean.

### File List

- `_bmad-output/implementation-artifacts/4-4-create-alert-rules-and-alert-history.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/db/migrations/0004_alert_rules_and_history.sql`
- `apps/api/src/app.ts`
- `apps/api/src/domain/alert-repository.ts`
- `apps/api/src/domain/alert-service.ts`
- `apps/api/src/domain/metrics-service.ts`
- `apps/api/src/routes/admin-alerts.routes.ts`
- `apps/api/src/schemas/alert.schema.ts`
- `apps/api/test/integration/admin-alerts-routes.test.ts`

### Change Log

- 2026-06-18: Implemented alert rules, deterministic evaluation, append-only history, acknowledgments, and metrics alert state.
