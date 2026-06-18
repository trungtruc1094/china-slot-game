---
baseline_commit: e5a0f25
---

# Story 4.5: Apply Budget Protection Actions

Status: done

## Story

As a host,
I want predefined budget protection actions,
So that the system can safely limit future exposure.

## Acceptance Criteria

1. Budget protection can apply disable paid spins, lower max bet, pause campaign, and require host approval actions.
2. Protection actions affect only future spins and never alter accepted spin outcomes.
3. Every action is reversible or has a documented manual rollback.
4. Actions are gated by feature flag / per-environment config.
5. Players receive stable client-displayable messages when play is paused or limited.
6. Audit trail records who/what/when/reason for every apply and revert.

## Tasks/Subtasks

- [x] Add budget protection action repository and audit trail.
- [x] Add admin routes to apply, list, and revert protection actions.
- [x] Enforce active protection actions during spin validation before wallet debit/generation.
- [x] Add feature flag / environment gate.
- [x] Add tests for each action triggering and being reverted.
- [x] Document API contracts, rollback behavior, persistence, and assumptions.

## Dev Notes

### Persistence Approach

Budget protection writes durable operational control state:

- `budget_protection_actions`: action id, scope id, action type, status (`active`, `reverted`), parameters, actor/source, reason, created/reverted timestamps.
- `budget_protection_audit_events`: append-only events for `budget_protection.apply` and `budget_protection.revert`, including actor, action id, action type, metric snapshot if supplied, reason, and timestamp.
- Retention: keep action records and audit events for 2 years minimum.
- Indexing: active lookup index `(scope_id, status)`, action type lookup `(scope_id, action_type, status)`, audit lookup `(target_id, created_at)`.

### API Contracts

- `POST /api/admin/budget-protection/actions`
  - Request: `{ "scopeId", "action", "reason", "parameters"?, "metricState"? }`
  - Actions: `disablePaidSpins`, `lowerMaxBet`, `pauseCampaign`, `requireHostApproval`
  - Response: `{ "data": { "action": BudgetProtectionAction }, "error": null }`
- `POST /api/admin/budget-protection/actions/:id/revert`
  - Request: `{ "reason" }`
  - Response: reverted action.
- `GET /api/admin/budget-protection/actions?scopeId=default`
  - Response: action history.
- Spin rejection error: `BUDGET_PROTECTION_ACTIVE` with details `{ action, message, scopeId }`.
- Disabled feature errors: `BUDGET_PROTECTION_DISABLED`.

### Reversibility

- `disablePaidSpins`: revert marks the action `reverted`, immediately allowing future paid spins again.
- `lowerMaxBet`: revert removes the temporary cap and restores operator-limit max bet behavior.
- `pauseCampaign`: revert resumes future spin validation.
- `requireHostApproval`: revert clears the approval hold. Manual rollback is not required for V1 because the hold is fully reversible.

### Assumptions

- V1 uses `scopeId = "default"` for spin enforcement.
- Budget protection feature gate defaults from environment/config and can be disabled in lower environments.
- Metric-state snapshots are accepted as metadata for audit; automated trigger orchestration can be layered on top later.

## Dev Agent Record

### Implementation Plan

- Add budget protection repository/provider.
- Wire provider and feature flag into spin service.
- Add admin routes and tests for each action and revert path.

### Debug Log

- `npm --workspace @china-slot-game/api test -- admin-budget-protection-routes` passed.
- `npm --workspace @china-slot-game/api run typecheck` passed.
- `npm run lint && npm run typecheck && npm test && npm run build` passed.

### Completion Notes

- Added budget protection repository/provider with active/reverted action records and append-only audit events.
- Added admin routes to apply, list, revert, and audit protection actions.
- Enforced active actions in spin validation before reel generation and wallet debit.
- Added `BUDGET_PROTECTION_ENABLED` / app dependency feature gate.
- Added durable migration contract for action and audit tables.
- Added tests for all four action types, reversions, audit trail, and disabled environment config.

## Senior Developer Review (AI)

Outcome: Approve

Evidence:

- Acceptance criteria covered by `apps/api/test/integration/admin-budget-protection-routes.test.ts`.
- Every action triggers and reverts: `disablePaidSpins`, `lowerMaxBet`, `pauseCampaign`, and `requireHostApproval` are each tested for rejection before revert and accepted future spin after revert.
- Reversibility is documented in Dev Notes and implemented as active/reverted action state.
- Feature flag/per-environment gate is implemented via `budgetProtectionEnabled` / `BUDGET_PROTECTION_ENABLED` and tested with `BUDGET_PROTECTION_DISABLED`.
- Audit trail records who/what/when/reason and metric snapshot for apply and revert.
- Public API contracts, persistence approach, rollback behavior, and assumptions are documented in Dev Notes.
- Protection enforcement runs during spin validation before wallet debit/reel generation and does not alter accepted historical outcomes.
- Lint, typecheck, tests, and build are clean.

### File List

- `_bmad-output/implementation-artifacts/4-5-apply-budget-protection-actions.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/db/migrations/0005_budget_protection_actions.sql`
- `apps/api/src/app.ts`
- `apps/api/src/domain/budget-protection-repository.ts`
- `apps/api/src/domain/spin-service.ts`
- `apps/api/src/routes/admin-budget-protection.routes.ts`
- `apps/api/src/schemas/budget-protection.schema.ts`
- `apps/api/test/integration/admin-budget-protection-routes.test.ts`

### Change Log

- 2026-06-18: Implemented budget protection actions, reversions, audit trail, feature gate, and spin enforcement.
