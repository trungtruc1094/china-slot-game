# Story 6.6: Produce Launch Readiness Checklist

Status: done
baseline_commit: e91bb116331462f62f7fcb343b62166d38851d99

## Story

As a host,
I want a launch readiness checklist,
so that community deployment does not proceed with unresolved operational blockers.

## Acceptance Criteria

1. Checklist covers reward model, player identity source, compliance boundary, active Configuration Version, math report, simulation result, budget limits, alert thresholds, retention policy, backend outage behavior, and support access.
2. Unresolved blockers are clearly marked.
3. Checklist links to the relevant PRD, architecture, epics, and operational docs.
4. Launch is not marked ready while compliance boundary, reward model, player identity, or deterministic math matching remains unresolved.
5. Checklist references concrete evidence: file paths, test names, and commit hashes.
6. Checklist covers every previous epic.
7. Checklist includes a rollback plan and an "if X breaks in prod" runbook section.
8. Dev notes flag the checklist for Donnie/manual review by someone other than the dev agent.

## Tasks / Subtasks

- [x] Create launch readiness checklist document (AC: 1, 2, 3, 4, 5, 6, 7)
  - [x] Cover every previous epic with concrete evidence.
  - [x] Mark unresolved launch blockers explicitly.
  - [x] Add rollback plan and production breakage runbook.
- [x] Add checklist verification test (AC: 5, 6, 7, 8)
  - [x] Assert required evidence shape and all epic sections.
  - [x] Assert Donnie/manual review flag is present.
- [x] Run gates and update status (AC: all)
  - [x] Run focused test.
  - [x] Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.

## Dev Notes

- Binding Epic 5 retro findings:
  - Unified audit events are the canonical launch-readiness audit source.
  - Launch readiness must distinguish local passing tests from production deployment readiness.
  - Real admin identity and durable storage remain explicit deployment review items.
- Public checklist contract:
  - The checklist is an operations document at `docs/operations/launch-readiness-checklist.md`.
  - Each evidence item must include concrete file paths, test names, and commit hashes where applicable.
  - The checklist must not mark launch ready until Donnie or another non-dev-agent reviewer manually confirms the checklist.
  - Every checklist gate is flagged for manual review by Donnie or another person who is not the dev agent before production/community deployment.
- Assumption: this story produces the readiness checklist and automated evidence-shape test; it does not complete the human manual review.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm --workspace @china-slot-game/api test -- unit/launch-readiness-checklist.test.ts`
- `npm run lint && npm run typecheck && npm test && npm run build`

### Completion Notes List

- Added `docs/operations/launch-readiness-checklist.md` with concrete source docs, epic evidence, blockers, rollback, and production breakage runbook.
- Added automated checklist evidence-shape test covering epics, commit hashes, file paths, test names, Donnie/manual review flag, unresolved blockers, rollback, and runbook sections.
- Code review verified that the checklist does not mark launch ready before manual review and blocker closure.

### File List

- `apps/api/test/unit/launch-readiness-checklist.test.ts`
- `docs/operations/launch-readiness-checklist.md`
- `_bmad-output/implementation-artifacts/6-6-produce-launch-readiness-checklist.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-06-19: Created story context for implementation.
- 2026-06-19: Implemented launch readiness checklist and evidence-shape verification.
