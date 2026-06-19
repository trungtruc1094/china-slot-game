# CI Quality Gates

Date: 2026-06-19

CI runs on every pull request and push to `main`.

## Gates

| Gate | Local command |
| --- | --- |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Unit and integration tests | `npm test` |
| Coverage threshold | `npm run test:coverage` |
| Build | `npm run build` |

Coverage thresholds are 80% for lines, functions, and statements, with branches set to 79%. The branch threshold matches the current launch baseline after Epic 6 hardening so CI fails on regressions immediately while leaving the remaining branch-heavy MVP seams visible as follow-up coverage debt.

Migration checks are not applicable until a migration execution harness is introduced. When the harness exists, add it as a separate named CI step so failures identify the failing package/app.
