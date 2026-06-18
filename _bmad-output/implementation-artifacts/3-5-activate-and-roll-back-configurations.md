# Story 3.5: Activate and Roll Back Configurations

## Status

done

## Story

As a host, I want to activate and roll back validated configurations, so that future spins use approved economics while historical spins remain auditable.

## Acceptance Criteria

- Activating a draft creates an immutable active configuration version and logs actor, timestamp, reason, and math report reference.
- Future spins use the active configuration version.
- Rollback changes only future spins and creates an audit event.
- Historical spins remain linked to the configuration used at spin time.
- Concurrent activation attempts allow only one activation to win.

## Dev Notes

- Public API contract:
  - `POST /api/admin/configs/drafts/:id/activate` body `{ reason? }` returns `200` with `{ activeConfig }`.
  - `POST /api/admin/configs/rollback` body `{ targetVersionId, reason? }` returns `200` with `{ activeConfig }`.
  - `GET /api/admin/configs/audit-events` returns `200` with `{ auditEvents }`.
  - Errors include `ADMIN_UNAUTHORIZED`, `INVALID_ACTIVATION_REQUEST`, `CONFIG_NOT_FOUND`, `CONFIG_STATUS_CONFLICT`, `MATH_REPORT_NOT_FOUND`, and `SIMULATION_NOT_FOUND`.
- API activation requires an attached non-blocking math report and at least one stored simulation run. Repository-level activation remains looser for lower-level tests from earlier stories.
- Activation and rollback are implemented as synchronous repository transitions: current active is retired and target active is promoted before control returns, so the spin endpoint can observe only the old active before the call or the new active after it.
- Rollback restores the prior version's stored `GameConfiguration` exactly as the active config for future spins. Existing spin ledger entries keep their original `configVersionId`.
- Audit events are persisted in the repository with actor, action, target, reason, and metadata containing math report references for activation and previous/current version details for rollback.

## Review Evidence

- Acceptance tests: `apps/api/test/integration/admin-config-activation-routes.test.ts`.
- Concurrency evidence: the test fires two activation requests for the same draft with `Promise.all`; exactly one succeeds and one receives `CONFIG_STATUS_CONFLICT`.
