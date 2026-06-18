---
baseline_commit: 8b1fd581aeb53077f2c95843fe2bc8675dd257f6
---

# Story 4.1: Configure Operator Limits

Status: done

## Story

As a host,
I want to configure operational limits,
So that reward exposure is bounded before players spin.

## Acceptance Criteria

1. Authorized operators can create and update active operator limits.
2. Limits include explicit types and units: per-spin min/max bet and max payout, per-session spin/wager caps, per-day per-player wager/reward caps, campaign budget, and jackpot cap, all money-like values in integer minor currency units.
3. Limit changes are versioned and audited.
4. Invalid or impossible limit combinations are rejected before storage.
5. Active limits can be fetched by admin routes and consumed by spin validation.

## Tasks/Subtasks

- [x] Add operator limit domain model and repository.
- [x] Add admin create, update, fetch active, list versions, and audit routes.
- [x] Add request validation for explicit limit types, units, and impossible combinations.
- [x] Add durable persistence contract for operator limits and audit events.
- [x] Add tests covering create, update, fetch active limits, validation, versioning, and audit evidence.
- [x] Document public API contracts and assumptions in Dev Notes.

## Dev Notes

### Sources

- Epic 4 story requirements: `_bmad-output/planning-artifacts/epics.md`
- PRD FR-12/FR-15 and NFR-9/NFR-10: `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/prd.md`
- Architecture storage model: `_bmad-output/planning-artifacts/architecture.md`
- Binding retro finding: `_bmad-output/implementation-artifacts/epic-3-retro-2026-06-18.md`

### Persistence Approach

Operator limits write durable campaign control state. V1 implementation uses an in-memory repository plus migration artifacts, matching the current config persistence pattern, but the committed persistence contract is:

- `operator_limits`: versioned limit sets keyed by `id`, `scope_id`, `version`, `status`, with all currency values stored as integer minor units and all count limits as integers.
- Retention: retain all versions for at least the campaign lifetime plus 180 days; active rows are never overwritten, updates retire the previous active version and insert a new active version.
- Indexing: unique active index on `(scope_id)` where `status = 'active'`, lookup index on `(scope_id, status)`, and audit lookup index on `(target_id, created_at)`.
- `admin_audit_events`: append-only audit records for `operator_limits.create` and `operator_limits.update`, including actor, reason, previous active version, and resulting version.

### API Contracts

- `POST /api/admin/operator-limits`
  - Request: `{ "scopeId": "campaign-1", "limits": OperatorLimits, "reason"?: string }`
  - Response: `{ "data": { "operatorLimits": OperatorLimitRecord }, "error": null, "requestId": string }`
  - Errors: `ADMIN_UNAUTHORIZED`, `INVALID_OPERATOR_LIMITS`, `OPERATOR_LIMITS_CONFLICT`
- `PUT /api/admin/operator-limits/:scopeId`
  - Request: `{ "limits": OperatorLimits, "reason"?: string }`
  - Response: same as create, with a new active version.
  - Errors: `ADMIN_UNAUTHORIZED`, `INVALID_OPERATOR_LIMITS`, `OPERATOR_LIMITS_NOT_FOUND`
- `GET /api/admin/operator-limits/active?scopeId=campaign-1`
  - Response: `{ "data": { "operatorLimits": OperatorLimitRecord | null }, "error": null, "requestId": string }`
- `GET /api/admin/operator-limits`
  - Response: `{ "data": { "operatorLimits": OperatorLimitRecord[] }, "error": null, "requestId": string }`
- `GET /api/admin/operator-limits/audit-events`
  - Response: `{ "data": { "auditEvents": OperatorLimitAuditEvent[] }, "error": null, "requestId": string }`

### OperatorLimits Shape

`limits` is explicitly unit-bearing:

- `currency`: ISO-like currency/unit code such as `POINTS`
- `perSpin.minBet`, `perSpin.maxBet`, `perSpin.maxPayout`: integer minor units
- `perSession.maxSpins`, `perSession.maxWager`: integer count/minor units
- `perDay.playerMaxWager`, `perDay.playerMaxReward`: integer minor units
- `campaign.budget`, `campaign.jackpotCap`: integer minor units

Impossible combinations include min bet above max bet, max payout above jackpot cap, max bet above session/day/campaign wager capacity, or non-positive budget/cap values.

### Assumptions

- The default scope is campaign-like (`scopeId`), and later stories can map it to config version or campaign identifiers without changing the repository contract.
- Header-based admin role scaffolding remains temporary until Epic 5.
- Currency values are non-cash reward units for this product unless future compliance work explicitly changes that boundary.

## Dev Agent Record

### Implementation Plan

- Add operator limit schema, repository, router, and migration.
- Wire repository into `createApp`.
- Cover create/update/fetch active with integration tests and repository validation tests.

### Debug Log

- `npm --workspace @china-slot-game/api test -- admin-operator-limits-routes operator-limits-repository` passed.
- `npm --workspace @china-slot-game/api run typecheck` passed.
- `npm run lint && npm run typecheck && npm test && npm run build` passed.

### Completion Notes

- Added `InMemoryOperatorLimitsRepository` with active/retired versioning, explicit unit-bearing limit shape, immutable read clones, validation for impossible combinations, and append-only audit events.
- Added admin routes for creating, updating, fetching active limits, listing versions, and reading limit audit events.
- Added `0002_operator_limits.sql` with table schema, constraints, active-scope unique index, lookup indexes, and audit-event retention target.
- Public API contracts, persistence approach, and assumptions are documented above.

## Senior Developer Review (AI)

Outcome: Approve

Evidence:

- Acceptance criteria covered by `apps/api/test/integration/admin-operator-limits-routes.test.ts` and `apps/api/test/unit/operator-limits-repository.test.ts`.
- Explicit limit types and units are present in the `OperatorLimits` shape and API Dev Notes: per-spin, per-session, per-day, campaign, integer minor currency units.
- Validation rejects impossible combinations in both Zod schema and repository domain checks.
- Create, update, fetch active, list versions, unauthorized write, audit trail, and duplicate/invalid domain cases are tested.
- Public request, response, and error contracts are documented in Dev Notes.
- Assumptions and persistence approach are documented in Dev Notes.
- Lint, typecheck, tests, and build are clean.

### File List

- `_bmad-output/implementation-artifacts/4-1-configure-operator-limits.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/db/migrations/0002_operator_limits.sql`
- `apps/api/src/app.ts`
- `apps/api/src/domain/operator-limits-repository.ts`
- `apps/api/src/routes/admin-operator-limits.routes.ts`
- `apps/api/src/schemas/operator-limits.schema.ts`
- `apps/api/test/integration/admin-operator-limits-routes.test.ts`
- `apps/api/test/unit/operator-limits-repository.test.ts`

### Change Log

- 2026-06-18: Implemented operator limits configuration, persistence contract, admin API, validation, audit events, and tests.
