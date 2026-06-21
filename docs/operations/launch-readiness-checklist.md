# Launch Readiness Checklist

Date: 2026-06-19

Status: Not launch-ready until Donnie or another non-dev-agent reviewer signs off.

Manual review owner: Donnie. This checklist is flagged for human review before production/community deployment.

## Source Documents

| Document | Path | Evidence |
| --- | --- | --- |
| PRD | `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/prd.md` | Requirements FR4, FR11, FR13, FR14, FR15, FR18, NFR5, NFR6, NFR8, NFR9, NFR10, NFR12 |
| Architecture | `_bmad-output/planning-artifacts/architecture.md` | Backend authority, API, storage, and operational boundaries |
| Epics | `_bmad-output/planning-artifacts/epics.md` | Story 6.6 acceptance criteria and full epic scope |
| Sprint state | `_bmad-output/implementation-artifacts/sprint-status.yaml` | Epic/story completion source of truth |
| Retention operations | `docs/operations/retention-policy.md` | Retention periods and disabled destructive job note |
| CI operations | `docs/operations/ci-quality-gates.md` | Local and CI quality gates |

## Epic Evidence

| Epic | Status | Commit evidence | File and test evidence |
| --- | --- | --- | --- |
| Epic 1: Game math foundation | Done | `a0fd1a9 feat(1-5): build seeded simulation runner`; `8fa3d42 feat(1-4): build RTP calculator and config diagnostics` | `packages/game-math/src/win-calculator.ts`; `packages/game-math/src/rtp-calculator.ts`; `packages/game-math/src/simulator.ts`; tests `packages/game-math/test/game-math.test.ts`, `packages/game-math/test/rtp-calculator.test.ts`, `packages/game-math/test/simulator.test.ts`, `packages/game-math/test/win-calculator.test.ts` |
| Epic 2: Server-authoritative gameplay | Done | `c86db8b feat(2-6): integrate Phaser client with backend spin results`; `b0b6f77 feat(2-4): implement authoritative spin endpoint`; `e6429c1 feat(2-5): add spin idempotency retry safety` | `apps/api/src/routes/spins.routes.ts`; `apps/api/src/domain/spin-service.ts`; `js/serverClient.js`; `js/slotGame.js`; tests `apps/api/test/integration/spins-routes.test.ts`, `apps/api/test/unit/server-client.test.ts` |
| Epic 3: Configuration lifecycle | Done | `8e4a6a2 feat(3-5): activate and roll back configurations`; `e4f4442 feat(3-4): run and store simulation batches`; `da65981 feat(3-3): attach math reports to draft configurations` | `apps/api/src/routes/admin-config.routes.ts`; `apps/api/src/domain/game-configuration-repository.ts`; tests `apps/api/test/integration/admin-config-activation-routes.test.ts`, `apps/api/test/integration/admin-config-math-report-routes.test.ts`, `apps/api/test/integration/admin-config-simulation-routes.test.ts` |
| Epic 4: Operator controls and alerts | Done | `98709c4 feat(4-5): apply budget protection actions`; `e5a0f25 feat(4-4): create alert rules and history`; `7a97267 feat(4-2): enforce limits during spin validation` | `apps/api/src/domain/operator-limits-repository.ts`; `apps/api/src/domain/alert-service.ts`; `apps/api/src/routes/admin-budget-protection.routes.ts`; tests `apps/api/test/integration/admin-operator-limits-routes.test.ts`, `apps/api/test/integration/admin-alerts-routes.test.ts`, `apps/api/test/integration/admin-budget-protection-routes.test.ts` |
| Epic 5: Admin and audit support | Done | `9aa23b1 feat(5-5): provide admin audit search`; `337801b feat(5-4): record unified admin audit events`; `ed7bfd3 feat(5-1): implement admin authentication and roles` | `apps/api/src/domain/admin-audit-repository.ts`; `apps/api/src/routes/admin-audit.routes.ts`; `apps/api/src/middleware/admin-auth.ts`; tests `apps/api/test/integration/admin-audit-events.test.ts`, `apps/api/test/integration/admin-audit-search-routes.test.ts`, `apps/api/test/integration/admin-auth-routes.test.ts` |
| Epic 6: Launch guardrails | Done | `5ee707a feat(6-1): enforce non-cash reward boundary`; `f998dd3 feat(6-2): add safe backend-unavailable behavior`; `afe6159 feat(6-3): add observability and request tracing`; `8f8f706 feat(6-4): define retention and launch data policies`; `e91bb11 feat(6-5): add ci quality gates` | `apps/api/src/domain/reward-boundary.ts`; `apps/api/src/middleware/request-tracing.ts`; `apps/api/src/domain/retention-policy.ts`; `.github/workflows/quality-gates.yml`; tests `apps/api/test/integration/reward-boundary-routes.test.ts`, `apps/api/test/unit/server-client.test.ts`, `apps/api/test/integration/request-tracing.test.ts`, `apps/api/test/unit/retention-policy.test.ts`, `apps/api/test/unit/ci-quality-gates.test.ts` |
| Epic 7: Production-durable persistence | Done | `2f9f9a9 feat(7-8): wire production postgres dependencies`; `72d1c33 feat(7-7): add top-up idempotency persistence`; `1db96a3 feat(7-6): persist operational controls and traces`; `60ae0db feat(7-5): persist accepted spins and idempotency` | `apps/api/src/composition/production-dependencies.ts`; `apps/api/src/repositories/postgres/`; `apps/api/db/migrations/`; tests `apps/api/test/postgres/persistence-recovery.test.ts`, `apps/api/test/postgres/production-dependencies.test.ts`, `apps/api/test/postgres/spin-service.test.ts`, `apps/api/test/postgres/provider-top-up-idempotency.test.ts` |

## Launch Gate Checklist

| Gate | Required evidence | Current status | Blocker |
| --- | --- | --- | --- |
| Reward model | `apps/api/src/domain/reward-boundary.ts`; `apps/api/test/integration/reward-boundary-routes.test.ts`; commit `5ee707a` | Non-cash model documented and enforced server-side | Donnie must confirm the community reward model remains non-cash before launch |
| Player identity source | `apps/api/src/domain/player-identity.ts`; `apps/api/src/routes/sessions.routes.ts`; `apps/api/test/integration/sessions-routes.test.ts`; commits `b54c990`, `ed7bfd3` | Header/session adapter exists for MVP | Blocked for production until Donnie approves the identity source or replaces header identity with production auth |
| Compliance boundary | `apps/api/src/domain/reward-boundary.ts`; `apps/api/test/integration/reward-boundary-routes.test.ts`; commit `5ee707a` | Cash-equivalent and redeemable rewards are denied and audited | Not ready if any cash-equivalent reward is enabled |
| Active Configuration Version | `apps/api/src/routes/admin-config.routes.ts`; `apps/api/test/integration/admin-config-activation-routes.test.ts`; commit `8e4a6a2` | Activation and rollback API exists | Donnie must confirm the active version ID before launch |
| Math report | `apps/api/test/integration/admin-config-math-report-routes.test.ts`; `packages/game-math/test/rtp-calculator.test.ts`; commits `8fa3d42`, `da65981` | Math reports are generated and attached | Donnie must verify the selected active config has a current math report |
| Simulation result | `apps/api/test/integration/admin-config-simulation-routes.test.ts`; `packages/game-math/test/simulator.test.ts`; commits `a0fd1a9`, `e4f4442` | Seeded simulation runner and stored batch API exist | Donnie must verify the selected active config has an acceptable simulation result |
| Deterministic math matching | `packages/game-math/test/game-math.test.ts`; `packages/game-math/test/win-calculator.test.ts`; `apps/api/test/integration/spins-routes.test.ts`; commits `b0b6f77`, `c86db8b` | Tests cover backend math and client/backend spin integration | Not ready if client fixtures or active config diverge from backend game math |
| Budget limits | `apps/api/src/domain/operator-limits-repository.ts`; `apps/api/test/integration/admin-operator-limits-routes.test.ts`; commits `425c528`, `7a97267` | Limits are configurable and enforced during spin validation | Donnie must approve final limit values |
| Alert thresholds | `apps/api/src/domain/alert-service.ts`; `apps/api/test/integration/admin-alerts-routes.test.ts`; commit `e5a0f25` | Alert rules and history exist | Donnie must approve production thresholds and notification ownership |
| Retention policy | `docs/operations/retention-policy.md`; `apps/api/src/domain/retention-policy.ts`; `apps/api/test/unit/retention-policy.test.ts`; commit `8f8f706` | Retention periods are explicit and destructive job is disabled | Destructive retention remains blocked until legal/Donnie approval |
| Backend outage behavior | `js/serverClient.js`; `js/slotGame.js`; `apps/api/test/unit/server-client.test.ts`; commit `f998dd3` | Client does not optimistically succeed spins without backend confirmation | Donnie must review production outage copy |
| Observability and tracing | `apps/api/src/middleware/request-tracing.ts`; `apps/api/src/domain/request-trace-repository.ts`; `apps/api/test/integration/request-tracing.test.ts`; commit `afe6159` | Correlation IDs link requests, wallet transactions, and audit events | Donnie must confirm operational log retention/export target |
| Support access | `apps/api/src/middleware/admin-auth.ts`; `apps/api/src/routes/admin-spin-ledger.routes.ts`; `apps/api/src/routes/admin-balance-transactions.routes.ts`; tests `apps/api/test/integration/admin-spin-ledger-routes.test.ts`, `apps/api/test/integration/admin-balance-transactions-routes.test.ts`; commits `8f0a4f6`, `70369a4`, `ed7bfd3` | Support searches exist behind admin auth middleware | Blocked for production until real admin identity source is approved |
| CI quality gates | `.github/workflows/quality-gates.yml`; `vitest.config.ts`; `apps/api/test/unit/ci-quality-gates.test.ts`; `docs/operations/ci-quality-gates.md`; commit `e91bb11` | PR gate runs lint, typecheck, test, coverage, and build | Donnie must confirm CI is required on protected branches |
| Database persistence gate | `apps/api/src/db/migrations.ts`; `apps/api/src/composition/production-dependencies.ts`; `apps/api/test/postgres/persistence-recovery.test.ts`; `apps/api/test/postgres/production-dependencies.test.ts`; commits `60ae0db`, `1db96a3`, `72d1c33`, `2f9f9a9` | PostgreSQL migrations, schema readiness, production dependency composition, restart recovery, admin/search records, and future provider top-up idempotency are verified in an isolated PostgreSQL database | Tevi planning/integration must not begin until this gate passes in CI and Donnie accepts the persistence evidence |

## Unresolved Blockers

- Production admin identity is not approved: current support/admin access uses the centralized header-auth scaffold from `apps/api/src/middleware/admin-auth.ts`.
- Player identity source is not approved for production beyond the MVP adapter in `apps/api/src/domain/player-identity.ts`.
- Destructive retention execution is intentionally disabled in `apps/api/src/jobs/retention-job.ts` until legal/Donnie approval.
- Launch cannot proceed if cash-equivalent rewards are enabled or if `apps/api/test/integration/reward-boundary-routes.test.ts` fails.
- Launch cannot proceed until Donnie manually confirms active config, math report, simulation result, budget limits, alert thresholds, CI branch protection, and outage copy.
- Tevi planning or integration cannot proceed until the database persistence gate passes: `db:migrate`, `db:check`, PostgreSQL integration tests, and the persistence recovery suite must all be green against an isolated PostgreSQL database.

## Rollback Plan

1. Freeze new community traffic by disabling the launch entry point or routing users to the maintenance/offline state that uses `js/serverClient.js` safe failure messaging.
2. Roll back to the previous known-good deployment artifact and configuration version. For configuration rollback, use the activation/rollback behavior covered by `apps/api/test/integration/admin-config-activation-routes.test.ts` and commit `8e4a6a2`.
3. Preserve evidence before cleanup: export or snapshot spin ledger, balance transactions, audit events, request traces, alert history, and active configuration identifiers.
4. Verify recovery with `npm test`, `npm run typecheck`, `npm run build`, and the targeted tests for the failed area before reopening traffic.
5. Record the incident decision and follow-up owner in the audit/support record path backed by `apps/api/src/domain/admin-audit-repository.ts`.

## If X Breaks In Prod

| If this breaks | First action | Evidence to inspect | Escalation |
| --- | --- | --- | --- |
| Spins fail or time out | Keep the client in backend-unavailable retry state; do not credit a spin without backend confirmation | `js/serverClient.js`; `js/slotGame.js`; `apps/api/test/unit/server-client.test.ts`; request trace ID from `apps/api/src/middleware/request-tracing.ts` | Donnie plus backend owner |
| Wallet balance is wrong | Stop affected spin flow, capture correlation ID, inspect wallet transaction and audit event linkage | `apps/api/src/domain/wallet-service.ts`; `apps/api/test/integration/request-tracing.test.ts`; commit `afe6159` | Donnie plus backend owner |
| Cash-equivalent reward appears | Disable affected reward/config immediately and preserve audit event | `apps/api/src/domain/reward-boundary.ts`; `apps/api/test/integration/reward-boundary-routes.test.ts`; commit `5ee707a` | Donnie plus compliance/legal reviewer |
| Budget or alert thresholds misfire | Apply budget protection action and freeze the affected campaign/config | `apps/api/src/routes/admin-budget-protection.routes.ts`; `apps/api/test/integration/admin-budget-protection-routes.test.ts`; commit `98709c4` | Donnie plus operations owner |
| Admin/support access is suspect | Disable admin/support access path until identity source is verified | `apps/api/src/middleware/admin-auth.ts`; `apps/api/test/integration/admin-auth-routes.test.ts`; commit `ed7bfd3` | Donnie plus security reviewer |
| Audit or trace data is missing | Pause launch traffic until the missing correlation path is restored | `apps/api/src/domain/admin-audit-repository.ts`; `apps/api/src/domain/request-trace-repository.ts`; tests `apps/api/test/integration/admin-audit-events.test.ts`, `apps/api/test/integration/request-tracing.test.ts` | Donnie plus backend owner |

## Manual Sign-Off

- Required reviewer: Donnie or another person who is not the dev agent.
- Required result before launch: every blocker above is either closed with evidence or explicitly accepted by Donnie with date, owner, and rollback risk.
- Current result: Not launch-ready for production/community deployment until manual review is complete.
