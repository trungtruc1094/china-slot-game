# CI Quality Gates

Date: 2026-06-19

CI runs on every pull request and push to `main`.

## Gates

| Gate | Local command |
| --- | --- |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Unit and integration tests | `npm test` |
| PostgreSQL migration check | `DATABASE_URL=postgres://china_slot:china_slot_password@localhost:55432/china_slot_test npm run db:migrate -w @china-slot-game/api` |
| PostgreSQL integration tests | `TEST_DATABASE_URL=postgres://china_slot:china_slot_password@localhost:55432/china_slot_test npm run test:integration -w @china-slot-game/api` |
| Coverage threshold | `npm run test:coverage` |
| Build | `npm run build` |

Coverage thresholds are 80% for lines, functions, and statements, with branches set to 79%. The branch threshold matches the current launch baseline after Epic 6 hardening so CI fails on regressions immediately while leaving the remaining branch-heavy MVP seams visible as follow-up coverage debt.

PostgreSQL migration checks use the Epic 7 migration harness and run as separate named CI steps so migration or database failures identify the API package/app. CI provisions PostgreSQL before running `db:migrate` and the PostgreSQL-backed integration suite.

The committed workflow uses CI-only disposable PostgreSQL credentials in the service container. They are not production secrets.
