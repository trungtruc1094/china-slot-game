# Story 6.4: Define Retention and Launch Data Policies

Status: done
baseline_commit: afe61598b219eaa0aa6a5da5e30be55d67e655f4

## Story

As an operator,
I want retention rules for operational data,
so that ledger, audit, and metrics storage is intentional before launch.

## Acceptance Criteria

1. Retention period per data type is explicit for spins, balance transactions, audit events, sessions, configuration history, simulation runs, alerts, and metrics.
2. Retention policy is documented for operations.
3. Deletion/archive mechanism is implemented or a scheduled job is scaffolded with a dated TODO.
4. Destructive retention jobs are disabled until policy is approved.
5. Launch readiness checks flag missing retention configuration.
6. Dev notes call out regulatory constraints affecting retention.

## Tasks / Subtasks

- [x] Create retention policy contract (AC: 1, 4, 5, 6)
  - [x] Define explicit periods or preserve-forever decisions for required data types.
  - [x] Include approval/destructive-job disabled state.
  - [x] Expose validation for launch readiness.
- [x] Scaffold retention job or deletion/archive mechanism (AC: 3, 4)
  - [x] Add scheduled-job scaffold with dated TODO if destructive deletion remains disabled.
  - [x] Ensure default runtime does not delete/archive data.
- [x] Document operational policy (AC: 2, 6)
  - [x] Add operations-facing retention matrix.
  - [x] Document regulatory constraints and approval requirements.
- [x] Add tests and run gates (AC: all)
  - [x] Test required data types have explicit retention rules.
  - [x] Test launch readiness fails when a required rule is missing.
  - [x] Test destructive retention job is disabled by default.
  - [x] Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.

## Dev Notes

- Binding Epic 5 retro finding: unified audit events are canonical, so retention policy must reference unified audit events, not legacy per-domain audit arrays.
- Previous story intelligence:
  - 6.1 established non-cash launch boundary.
  - 6.3 added request traces as operational records; metrics/traces need explicit retention too.
- Assumption: launch MVP keeps destructive retention disabled until Donnie/legal approves policy. A dated scheduled-job TODO is acceptable for this story.
- Regulatory constraints:
  - Cash-equivalent, redeemable, crypto, or gambling-like rewards remain blocked until legal review.
  - Audit, spin, and transaction records may become compliance evidence if any reward model changes; preserve or long-retain these records by default.
  - Destructive deletion requires jurisdiction, tax, dispute, age/identity, and no-purchase/free-entry policy review.
- Public API/contract:
  - Retention policy module exports a complete required-data-type matrix.
  - Launch readiness validation returns pass/fail with missing data types and whether destructive jobs are disabled.
  - No default code path deletes production data.
- Required data types:
  - spins
  - balance transactions
  - audit events
  - sessions
  - configuration history
  - simulation runs
  - alerts
  - metrics/request traces
- Candidate implementation locations:
  - `apps/api/src/domain/retention-policy.ts`
  - `apps/api/test/unit/retention-policy.test.ts`
  - `docs/operations/retention-policy.md`
  - `apps/api/src/jobs/retention-job.ts` for disabled scaffold.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Red phase: `npm --workspace @china-slot-game/api test -- unit/retention-policy.test.ts` failed because retention policy module did not exist.
- Focused green phase: `npm --workspace @china-slot-game/api test -- unit/retention-policy.test.ts` passed 3 tests.
- Full quality gate: `npm test && npm run lint && npm run typecheck && npm run build` passed with 121 API tests and 37 game-math tests.
- Code review: acceptance review returned no findings and verified retention categories, disabled job scaffold, regulatory notes, launch readiness validation, and tests.

### Completion Notes List

- Added default retention policy with explicit rules for spins, balance transactions, audit events, sessions, configuration history, simulation runs, alerts, and metrics/request traces.
- Added launch validation that flags missing required data types.
- Added disabled retention job scaffold with dated TODO `2026-06-19`.
- Added operations retention matrix in `docs/operations/retention-policy.md`.
- Destructive deletion/archive remains disabled by default pending Donnie/legal approval.

### File List

- apps/api/src/domain/retention-policy.ts
- apps/api/src/jobs/retention-job.ts
- apps/api/test/unit/retention-policy.test.ts
- docs/operations/retention-policy.md
- _bmad-output/implementation-artifacts/6-4-define-retention-and-launch-data-policies.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

### Change Log

- 2026-06-19: Created story context for implementation.
- 2026-06-19: Implemented retention policy matrix, disabled job scaffold, operations documentation, and tests.
- 2026-06-19: Marked story done after clean acceptance review and final passing gates.
