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
| PostgreSQL schema readiness check | `DATABASE_URL=postgres://china_slot:china_slot_password@localhost:55432/china_slot_test npm run db:check -w @china-slot-game/api` |
| PostgreSQL integration tests | `TEST_DATABASE_URL=postgres://china_slot:china_slot_password@localhost:55432/china_slot_test npm run test:integration -w @china-slot-game/api` |
| Coverage threshold | `npm run test:coverage` |
| Build | `npm run build` |

Coverage thresholds are 80% for lines, functions, and statements, with branches set to 79%. The branch threshold matches the current launch baseline after Epic 6 hardening so CI fails on regressions immediately while leaving the remaining branch-heavy MVP seams visible as follow-up coverage debt.

PostgreSQL persistence gates use the Epic 7 migration harness and run as separate named CI steps so migration, schema readiness, or database failures identify the API package/app. CI provisions PostgreSQL before running `db:migrate`, `db:check`, and the PostgreSQL-backed integration suite.

The PostgreSQL integration suite is required before Tevi planning or integration work. It verifies restart-safe persistence for sessions, wallets, spin idempotency, configuration history, operational controls, alert/audit/trace records, production dependency composition, and future provider top-up idempotency records without enabling top-up processing or wallet crediting from provider records.

The committed workflow uses CI-only disposable PostgreSQL credentials in the service container. They are not production secrets.
