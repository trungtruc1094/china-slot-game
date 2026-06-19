# Story 6.5: Add CI Quality Gates

Status: done
baseline_commit: 8f8f7069fcf0c18b75cb4e4af3d94fb495739fba

## Story

As a developer,
I want automated quality gates,
so that math, API, and integration regressions are caught before deployment.

## Acceptance Criteria

1. CI runs lint, typecheck, test, and build on every pull request.
2. CI fails if any of lint, typecheck, test, or build fails.
3. Coverage threshold is set and documented with the chosen percentage and rationale.
4. CI output identifies which package/app failed through separate named steps.
5. Dev notes document how to run every CI step locally.

## Tasks / Subtasks

- [x] Add CI workflow (AC: 1, 2, 4)
  - [x] Trigger on pull requests and pushes to main.
  - [x] Run install, lint, typecheck, tests, coverage, and build as named steps.
- [x] Add coverage threshold (AC: 3)
  - [x] Configure Vitest coverage threshold.
  - [x] Document selected threshold and rationale.
- [x] Document local commands (AC: 5)
  - [x] Add developer-facing CI/local quality gate docs.
- [x] Add tests and run gates (AC: all)
  - [x] Test CI workflow includes required commands.
  - [x] Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.

## Dev Notes

- Coverage threshold: 80% lines/functions/statements and 79% branches. Rationale: high enough to catch accidental coverage collapse for launch readiness while pinning branch coverage to the current hardened baseline without making unrelated historical branch debt block this story.
- Local commands:
  - `npm run lint`
  - `npm run typecheck`
  - `npm test`
  - `npm run test:coverage`
  - `npm run build`
- Public CI contract:
  - Pull requests must fail on lint, typecheck, test, coverage, or build failure.
  - Coverage uses Vitest V8 provider and the root `vitest.config.ts` thresholds.
  - Workflow step names include the package/gate name so failures are visible in GitHub Actions output.
- Assumption: no migration runner exists yet; CI quality gate documents migration checks as not applicable until a migration execution harness is introduced.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm --workspace @china-slot-game/api test -- unit/ci-quality-gates.test.ts`
- `npm run test:coverage`
- `npm run lint && npm run typecheck && npm test && npm run build`

### Completion Notes List

- Added GitHub Actions quality gate workflow for pull requests and pushes to `main`.
- Added root Vitest V8 coverage config and `npm run test:coverage`.
- Documented local gate commands and coverage threshold rationale in `docs/operations/ci-quality-gates.md`.
- Added unit coverage asserting workflow and threshold contracts.

### File List

- `.github/workflows/quality-gates.yml`
- `apps/api/test/unit/ci-quality-gates.test.ts`
- `docs/operations/ci-quality-gates.md`
- `package-lock.json`
- `package.json`
- `vitest.config.ts`
- `_bmad-output/implementation-artifacts/6-5-add-ci-quality-gates.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-06-19: Created story context for implementation.
- 2026-06-19: Implemented CI quality gate workflow, coverage thresholds, documentation, and verification tests.
