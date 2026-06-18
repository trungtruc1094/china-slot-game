# Story 3.3: Attach Math Reports to Draft Configurations

## Status

done

## Story

As a host, I want every draft configuration to produce a math report, so that I can understand RTP and risk before activation.

## Acceptance Criteria

- The backend runs the canonical RTP calculator and stores the math report for a draft.
- Reports include RTP, hit rate, free-spin frequency, jackpot frequency, max payout exposure, payout distribution, and diagnostics.
- Configurations with blocking diagnostics cannot be activated.
- Math reports are linked to the draft and future active configuration version.
- Report attachment is immutable once attached.

## Dev Notes

- Math reports use the exact `RtpReport` contract exported by `@china-slot-game/game-math`.
- `POST /api/admin/configs/drafts/:id/math-report` calculates and attaches a report using `calculateRtpReport()`.
- Attached math reports are immutable. A second attachment attempt returns `409 MATH_REPORT_IMMUTABLE`; future mutability should use a new draft/version rather than replacing the stored report.
- Activation remains allowed for drafts with no report for backward compatibility with earlier stories, but if a report is attached and contains an `error` diagnostic, activation fails with `CONFIG_MATH_REPORT_BLOCKED`.
- Public API contract:
  - `POST /api/admin/configs/drafts/:id/math-report` body `{ wager? }` returns `201` with `{ mathReport }`.
  - `GET /api/admin/configs/drafts/:id/math-report` returns `200` with `{ mathReport }` or `404 MATH_REPORT_NOT_FOUND`.
  - Errors include `ADMIN_UNAUTHORIZED`, `INVALID_MATH_REPORT_REQUEST`, `CONFIG_NOT_FOUND`, `CONFIG_STATUS_CONFLICT`, `MATH_REPORT_IMMUTABLE`, and `CONFIG_MATH_REPORT_BLOCKED`.

## Review Evidence

- Acceptance tests: `apps/api/test/integration/admin-config-math-report-routes.test.ts`.
- Repository tests: `apps/api/test/unit/game-configuration-repository.test.ts`.
