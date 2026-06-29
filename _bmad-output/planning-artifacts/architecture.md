---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/prd.md
  - _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/addendum.md
  - _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/database-persistence-addendum.md
  - _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/tevi-integration-addendum.md
  - _bmad-output/project-context.md
  - docs/project-overview.md
workflowType: architecture
project_name: China Slot Game
user_name: Donnie
date: 2026-06-01
lastStep: 8
status: complete
completedAt: 2026-06-01
updatedAt: 2026-06-27
---

# Architecture Decision Document: China Slot Game

This document defines the architecture for separating the current Phaser browser slot game from backend authority, so reward-bearing play can be configured, measured, audited, and operated safely.

## Project Context Analysis

### Requirements Overview

The PRD defines 18 functional requirements across five architectural areas:

- Server-authoritative spin flow: session start, bet validation, backend outcome resolution, and client animation of backend-approved results.
- Game math and configuration management: versioned game configurations, theoretical RTP calculation, simulation, activation, and rollback.
- Wallet, balance, and reward ledger: backend-owned balances, append-only spin ledger, and non-cash reward accounting.
- Operator metrics and controls: bet limits, prize caps, budget controls, live metrics, and alerts.
- Admin and support workflows: admin access, spin search, balance history, and operational audit trail.

### Non-Functional Requirements

- Security: the backend treats all client input as untrusted.
- Integrity: accepted spins must be safely recoverable and must not duplicate payouts on retry.
- Observability: spin volume, errors, latency, RTP windows, budget use, and alert state must be measurable.
- Performance: target p95 backend spin resolution below 300 ms, excluding client animation, pending validation.
- Availability: reward-bearing play stops safely when the backend is unavailable.
- Auditability: configuration, spin, wallet, and admin records must be retained and queryable.
- Accessibility: critical state must not depend only on animation or sound.

### Scale and Complexity

- Primary domain: full-stack web game with backend API, ledger, math engine, and admin operations.
- Complexity level: medium-high because game math, money-like reward accounting, auditability, and compliance guardrails create stronger correctness requirements than a normal casual game.
- Estimated architectural components: browser client, API backend, shared game math module, relational database, simulation CLI, admin dashboard, observability/alerts, and test harnesses.

### Technical Constraints and Dependencies

- The existing client is a static Phaser app loaded by `index.html`.
- The active client math behaves as 243 ways because no explicit payline array is configured.
- The current `server_examples` code is not canonical; it uses simplified payline logic and does not match the browser's 243-ways behavior.
- The current game config contains known math/config issues that must be fixed before canonical simulation or live backend execution.
- The first production architecture must support non-cash community rewards unless compliance review expands the product model.

### Cross-Cutting Concerns Identified

- Backend authority over every reward-bearing decision.
- Single source of truth for game math.
- Configuration versioning and rollback.
- Immutable spin and balance audit trails.
- Clear client recovery for failed, pending, or retried spins.
- Operator budget protection without changing already accepted outcomes.
- Compliance boundary around redeemable rewards.

## Starter Template Evaluation

### Primary Technology Domain

The project should move toward a TypeScript full-stack architecture while preserving the existing Phaser client during migration. The browser game can remain static initially; the new backend and operational tooling should be implemented as a Node.js TypeScript service with a PostgreSQL database.

### Starter Options Considered

- Keep the current static client and add a TypeScript backend package: best migration fit because it avoids rewriting the playable Phaser game before the backend boundary exists.
- Convert immediately to a full-stack framework such as Next.js: useful later for admin UI, but too much churn for the core spin-authority migration.
- Expand the existing `server_examples` JavaScript Express sketch: fastest superficially, but weak for shared math types, tests, migrations, and long-term agent consistency.

### Selected Starter Direction

Use a repo-internal TypeScript backend package rather than a full application rewrite.

Recommended implementation foundation:

```bash
mkdir -p apps/api packages/game-math apps/admin
cd apps/api
npm init -y
npm install express cors helmet express-rate-limit dotenv zod pg
npm install -D typescript tsx @types/node @types/express @types/cors vitest
```

Add Prisma or node-postgres migrations in the first backend story. Prisma is a good default if the team wants type-safe migrations and generated client types; plain `pg` plus SQL migrations is acceptable if the team wants tighter SQL control.

### Version Notes

- Node.js: use Active LTS for production. As of the checked release schedule, Node.js 24 is Active LTS and Node.js 26 is Current, so target Node.js 24 LTS for backend deployment.
- TypeScript: TypeScript 6.0 is current in official docs; use strict TypeScript and pin the exact version during implementation.
- Express: Express 5 exists and has official migration docs; use Express 5 for new TypeScript backend work unless dependency compatibility blocks it.
- PostgreSQL: PostgreSQL 18 is the latest major version in official PostgreSQL release notes; choose PostgreSQL 17 or 18 depending on deployment provider support, with PostgreSQL 18 preferred for greenfield local/dev infrastructure.

References:

- https://github.com/nodejs/release
- https://nodejs.org/en/download/releases/
- https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html
- https://expressjs.com/en/guide/migrating-5
- https://www.postgresql.org/
- https://www.prisma.io/docs

## Core Architectural Decisions

### Decision Priority Analysis

**Critical decisions that block implementation:**

- Backend owns RNG, wager validation, win calculation, balance mutation, and spin ledger.
- Client receives reel stops and outcome details from backend and only animates/displays them in production mode.
- Game math lives in one canonical module used by the backend, calculator, simulation tests, and optionally client demo tooling.
- PostgreSQL stores configuration versions, spin ledger, balance transactions, sessions, player identity mappings, admin audit records, and alerts.
- Operator controls affect future spin validation and configuration, never already accepted outcomes.

**Important decisions that shape architecture:**

- Preserve the static Phaser client while introducing backend integration through a small client API adapter.
- Use REST JSON APIs for v1 because the interaction model is request/response and audit-heavy.
- Use deterministic simulation and seeded test fixtures for game math verification.
- Add admin dashboard after backend math, ledger, and reporting APIs exist.

**Deferred decisions:**

- Exact auth provider: defer until player identity source is confirmed.
- Cash-equivalent reward support: defer until compliance review.
- Provably fair public verification: defer unless community trust requires it.
- Real-time dashboards via WebSocket/SSE: defer until polling proves insufficient.

### Data Architecture

Use PostgreSQL as the authoritative data store.

Core tables:

- `players`: player identity and display-safe profile fields.
- `sessions`: active and historical game sessions.
- `game_config_versions`: immutable activated configurations and draft metadata.
- `game_config_math_reports`: theoretical RTP and probability reports.
- `simulation_runs`: simulation parameters, seeds, and aggregate results.
- `spins`: append-only spin ledger with config version, wager, stops, win breakdown, and balance before/after.
- `balance_transactions`: append-only wallet transaction log.
- `operator_limits`: active budget, cap, and limit rules by campaign/config.
- `admin_audit_events`: configuration, limit, manual adjustment, and support actions.
- `alerts`: threshold breaches and acknowledgments.

Money-like values must use integer minor units, not floating point decimals. For non-cash points, store integer point units.

### Authentication and Security

V1 should support a replaceable auth adapter:

- Player auth adapter maps community identity to internal `player_id`.
- Admin auth adapter protects configuration, reporting, audit, and support tools.
- Authorization is role-based: `operator`, `support`, `viewer`, and future `admin`.
- All API requests validate input with schemas before entering domain logic.
- Spin endpoint rate limits by player/session/IP.
- Admin routes require stronger rate limits and full audit logs.

No client-provided balance, payout, RNG seed, or win result is trusted.

### API and Communication Patterns

Use REST JSON endpoints for v1:

- `POST /api/sessions` starts or resumes a session.
- `GET /api/me/balance` returns backend balance and free-spin state.
- `POST /api/spins` validates wager, resolves spin, updates ledger, and returns display result.
- `GET /api/spins/:spinId` returns support-safe spin details for the owner or admin.
- `GET /api/config/active` returns client-display-safe configuration metadata.
- `POST /api/admin/configs/draft` creates or updates draft configuration.
- `POST /api/admin/configs/:id/simulate` runs simulation.
- `POST /api/admin/configs/:id/activate` activates a validated configuration.
- `POST /api/admin/configs/:id/rollback` rolls back future spins to a prior version.
- `GET /api/admin/metrics` returns observed RTP, wagered, paid, budget, and alert state.
- `GET /api/admin/ledger/spins` searches spin ledger.

API responses use a stable envelope:

```json
{
  "data": {},
  "error": null,
  "requestId": "req_..."
}
```

Error responses use:

```json
{
  "data": null,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient balance for this bet.",
    "details": {}
  },
  "requestId": "req_..."
}
```

### Frontend Architecture

Keep the existing Phaser client and add a production-mode backend adapter.

Client responsibilities:

- Render game scene, reels, buttons, popups, audio, and animation.
- Capture user bet intent.
- Call backend APIs through a dedicated client module.
- Animate server-returned reel stops.
- Display server-returned balance, win breakdown, free-spin state, jackpot state, and errors.

Client non-responsibilities in production:

- RNG.
- Payout calculation.
- Authoritative balance mutation.
- Operator limit enforcement.
- Configuration activation.

Keep a local demo mode for visual development only. Demo mode must be visually marked in developer tooling or config and must not be deployable as reward-bearing mode.

### Infrastructure and Deployment

Recommended deployable units:

- `client`: static Phaser assets served from CDN/static hosting.
- `api`: Node.js TypeScript backend.
- `admin`: later web admin UI, likely React/Vite or Next.js depending on hosting.
- `db`: PostgreSQL.
- `jobs`: simulation and reporting jobs, initially runnable as CLI commands from the backend package.

CI should run linting, typecheck, unit tests, game math deterministic tests, API integration tests, and migration checks before deployment.

## Implementation Patterns and Consistency Rules

### Naming Patterns

Database:

- Tables use snake_case plural names: `game_config_versions`, `balance_transactions`.
- Columns use snake_case: `player_id`, `created_at`, `balance_after`.
- Primary keys use `id`.
- Foreign keys use `{table_singular}_id`.
- Timestamps use `created_at`, `updated_at`, `activated_at`, `expires_at`.

API:

- Routes use plural nouns: `/api/spins`, `/api/admin/configs`.
- Request and response JSON use camelCase.
- Error codes use SCREAMING_SNAKE_CASE.
- IDs in API payloads use `playerId`, `spinId`, `configVersionId`.

Code:

- TypeScript files use kebab-case: `spin-engine.ts`, `game-config-repository.ts`.
- Classes and types use PascalCase: `SpinEngine`, `GameConfigVersion`.
- Functions and variables use camelCase.
- Domain services end with `Service` or `Engine`; persistence classes end with `Repository`.

### Structure Patterns

- Domain math lives in `packages/game-math`.
- Backend API route handlers live in `apps/api/src/routes`.
- Backend domain orchestration lives in `apps/api/src/domain`.
- Database access lives in `apps/api/src/repositories`.
- Shared API schemas live in `apps/api/src/schemas`.
- Client API integration lives in `js/serverClient.js` initially, then may move under `apps/client` during modernization.
- Tests are colocated by package in `test` or `*.test.ts`, but deterministic math fixtures live in `packages/game-math/test/fixtures`.

### Format Patterns

- Store all timestamps as UTC ISO strings at API boundaries and database timestamp columns internally.
- Store wager, payout, and balance values as integers.
- Store reel stops as numeric indices and visible symbols as explicit arrays.
- Store win breakdown as JSON plus normalized summary fields for reporting.
- Every ledger row includes `config_version_id`.

### Communication Patterns

- Spin requests are synchronous request/response.
- Simulation can be synchronous for small runs and queued for large runs.
- Admin metrics use polling in v1.
- Alert creation is backend-owned and stored in `alerts`; notification delivery can be added later.

### Process Patterns

- Validation occurs at the API boundary and again at the domain boundary for critical spin inputs.
- Accepted spins are idempotent by `clientSpinId` plus `sessionId`.
- If a retry uses the same `clientSpinId`, return the original accepted result.
- If a spin is accepted and ledger write fails, return an error only after transaction rollback.
- If balance update succeeds, ledger and transaction records must be committed in the same database transaction.

### Enforcement Guidelines

All AI agents must:

- Use the canonical game math module for RTP, simulation, and spin resolution.
- Never duplicate payout logic in the client.
- Add or update deterministic tests when changing reel strips, paytable, scatter, jackpot, or ways logic.
- Add migration and rollback notes for database changes.
- Keep production client balance display sourced from backend responses.
- Preserve audit fields on configuration, spin, transaction, and admin actions.

Anti-patterns:

- Calculating production payouts in Phaser client code.
- Storing balances as JavaScript floats.
- Updating operator limits without audit records.
- Applying budget protection by changing an already accepted spin result.
- Allowing a draft configuration to affect live spins.

## Project Structure and Boundaries

### Complete Project Directory Structure

```text
china-slot-game/
├── index.html
├── js/
│   ├── slotConfig3x5.js
│   ├── slotGame.js
│   ├── slot_classes.js
│   ├── state_machine.js
│   ├── popups.js
│   ├── mkutils.js
│   └── serverClient.js
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.ts
│   │   │   ├── config/
│   │   │   │   └── env.ts
│   │   │   ├── routes/
│   │   │   │   ├── sessions.routes.ts
│   │   │   │   ├── spins.routes.ts
│   │   │   │   └── admin.routes.ts
│   │   │   ├── domain/
│   │   │   │   ├── spin-engine.ts
│   │   │   │   ├── wallet-service.ts
│   │   │   │   ├── config-service.ts
│   │   │   │   ├── metrics-service.ts
│   │   │   │   └── budget-service.ts
│   │   │   ├── repositories/
│   │   │   │   ├── player-repository.ts
│   │   │   │   ├── spin-repository.ts
│   │   │   │   ├── wallet-repository.ts
│   │   │   │   ├── config-repository.ts
│   │   │   │   └── audit-repository.ts
│   │   │   ├── schemas/
│   │   │   │   ├── spin.schema.ts
│   │   │   │   ├── config.schema.ts
│   │   │   │   └── admin.schema.ts
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── error-handler.ts
│   │   │   │   ├── rate-limit.ts
│   │   │   │   └── request-id.ts
│   │   │   └── db/
│   │   │       ├── client.ts
│   │   │       └── migrations/
│   │   └── test/
│   │       ├── integration/
│   │       └── unit/
│   └── admin/
│       └── README.md
├── packages/
│   └── game-math/
│       ├── package.json
│       ├── src/
│       │   ├── config-types.ts
│       │   ├── ways.ts
│       │   ├── win-calculator.ts
│       │   ├── rng.ts
│       │   ├── rtp-calculator.ts
│       │   └── simulator.ts
│       └── test/
│           ├── fixtures/
│           └── game-math.test.ts
├── docs/
│   └── project-overview.md
├── _bmad-output/
│   └── planning-artifacts/
│       ├── architecture.md
│       └── prds/
└── server_examples/
    └── README.md
```

### Architectural Boundaries

**API boundaries:**

- Client calls only public player endpoints.
- Admin UI calls only `/api/admin/*` endpoints.
- Backend routes call domain services, not repositories directly except for simple reads.
- Domain services call repositories and game math package.

**Component boundaries:**

- Phaser scene code never imports database, auth, or ledger logic.
- API route handlers do not implement game math directly.
- Game math package has no Express, database, or UI dependencies.
- Admin UI never writes database directly.

**Data boundaries:**

- Database writes for accepted spins occur inside backend transactions.
- Simulation runs cannot mutate player balances.
- Draft configurations are separate from active immutable configuration versions.

### Requirements to Structure Mapping

- FR-1 through FR-4: `apps/api/src/routes/sessions.routes.ts`, `apps/api/src/routes/spins.routes.ts`, `apps/api/src/domain/spin-engine.ts`, `js/serverClient.js`, existing Phaser state flow.
- FR-5 through FR-8: `apps/api/src/domain/config-service.ts`, `packages/game-math/src/rtp-calculator.ts`, `packages/game-math/src/simulator.ts`, config repositories and migrations.
- FR-9 through FR-11: `apps/api/src/domain/wallet-service.ts`, wallet and transaction repositories, balance API.
- FR-12 through FR-15: `apps/api/src/domain/budget-service.ts`, `metrics-service.ts`, admin routes, alerts table.
- FR-16 through FR-18: admin auth middleware, audit repository, ledger search endpoints, future admin UI.

### Integration Points

- Client to API: REST JSON over HTTPS.
- API to database: PostgreSQL client or ORM.
- API to game math: internal package import.
- Admin to API: authenticated REST JSON.
- Jobs to database: same repository/domain layer as API where practical.

## Architecture Validation Results

### Coherence Validation

The selected architecture is coherent with the PRD because it preserves the current Phaser client while moving reward authority to a backend. The domain package boundary prevents game math from drifting across client, server, calculator, and simulator implementations.

### Requirements Coverage Validation

All 18 PRD functional requirements have architectural support:

- Spin authority maps to session/spin APIs, `SpinEngine`, and the game math package.
- Config management maps to configuration services, math reports, simulation runs, and immutable config versions.
- Wallet and ledger requirements map to transaction-safe repositories and append-only records.
- Operator controls map to budget service, metrics service, admin routes, and alerts.
- Admin/support requirements map to role-based admin APIs and audit repositories.

### Implementation Readiness Validation

The architecture is ready for epics and stories, with these caveats:

- The exact player identity provider remains open.
- The exact reward model remains open and can change compliance requirements.
- The exact target RTP, hit rate, volatility, and budget caps remain open and should be treated as product configuration inputs, not architecture blockers.

### Gap Analysis Results

**Critical gaps before live reward launch:**

- Compliance boundary for any redeemable reward model.
- Confirmed reward model and player identity source.
- Deterministic game math implementation matching the active 243-ways behavior.

**Important gaps before implementation planning:**

- Decide Prisma versus plain SQL migrations.
- Decide admin UI framework when admin dashboard work begins.
- Decide deployment provider and secrets management.

**Deferred gaps:**

- Public provably-fair verification.
- Real-time metrics transport.
- Multi-game support.

### Architecture Completeness Checklist

**Requirements Analysis**

- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**

- [x] Critical decisions documented with versions
- [x] Technology stack specified for v1
- [x] Integration patterns defined
- [x] Performance considerations addressed

**Implementation Patterns**

- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure**

- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

Status: ready for `bmad-create-epics-and-stories`.

The architecture is sufficiently complete for downstream story generation. Implementation should begin with the shared game math package and deterministic tests before wiring production spin APIs, because correctness of RTP, ways calculation, scatter, jackpot, and payouts is the foundation for every later operational metric.

## Database Persistence Architecture Update

### Update Context

This update incorporates the Database Persistence PRD addendum dated 2026-06-21. The original architecture correctly selected PostgreSQL as the authoritative data store and required balance updates, spin ledger writes, and transaction records to commit together. The implemented API now has the domain surface for sessions, wallets, spins, configurations, operator limits, alerts, budget protection, admin audit, and request tracing, but `apps/api/src/app.ts` still composes in-memory services by default.

The persistence architecture must convert production API state from process memory to PostgreSQL before Tevi Mini App identity, Stars top-ups, SDK `topup()`, webhooks, or payment-like retry flows are implemented.

### Technology Decision

Use PostgreSQL with plain SQL migrations and `node-postgres` (`pg`) for the persistence epic.

Rationale:

- The repo already contains SQL migrations under `apps/api/db/migrations`.
- Wallet and spin correctness require explicit transaction boundaries, row locking, uniqueness constraints, and failure injection tests that are easiest for implementation agents to reason about in SQL.
- The current API package does not yet depend on Prisma or `pg`; adding `pg` is the smaller architectural move than introducing an ORM after SQL migration work has started.
- Node.js 24 is an active LTS release, and PostgreSQL 18 is supported by the PostgreSQL project. Use PostgreSQL 18 where hosting supports it, with PostgreSQL 17+ acceptable for managed-provider compatibility.

### Production Composition Boundary

Preserve `createApp(dependencies)` as the testable Express composition function, but stop letting production startup rely on implicit in-memory defaults.

Add a production dependency composition boundary:

- `apps/api/src/config/env.ts` validates runtime mode, `DATABASE_URL`, migration requirements, and optional feature flags.
- `apps/api/src/db/pool.ts` owns the PostgreSQL pool and connection health checks.
- `apps/api/src/db/transactions.ts` exposes a small transaction helper that passes a transaction-scoped client through repository calls.
- `apps/api/src/repositories/postgres/*` contains PostgreSQL-backed repository implementations.
- `apps/api/src/composition/production-dependencies.ts` constructs production repositories and services.
- `apps/api/src/main.ts` uses production dependency composition for production/staging runtime.
- Tests and narrow local demos may still call `createApp({ ...inMemoryDependencies })` explicitly.

Production mode rules:

- If `NODE_ENV=production` or `PERSISTENCE_MODE=postgres`, missing or invalid `DATABASE_URL` fails startup.
- Production startup must not silently fall back to `InMemoryPlayerIdentityAdapter`, `SessionService` with map-backed sessions, map-backed `WalletService`, `SpinService` in-memory ledger/idempotency, or in-memory admin repositories.
- `SEED_ACTIVE_CONFIG=true` may seed only through an explicit database-aware seed path, never by mutating an in-memory active config during production startup.
- Health endpoints distinguish liveness from readiness. Readiness fails when PostgreSQL is unavailable or schema readiness is not satisfied.

### Repository Boundaries

Move production persistence behind explicit repository/provider interfaces so domain services stop depending on process-local collections.

Required repository boundaries:

- `PlayerRepository`: creates/reads internal players and stable provider identity mappings.
- `SessionRepository`: creates, resumes, expires, and searches persisted sessions.
- `WalletRepository`: reads wallets, creates wallets idempotently, applies transaction-scoped balance updates, and lists wallet transactions.
- `SpinLedgerRepository`: writes accepted spins, retrieves spin details/search results, and resolves original idempotent spin responses.
- `SpinIdempotencyRepository`: reserves and completes `sessionId` plus `clientSpinId` keys with wager fingerprints and committed response payloads.
- `GameConfigurationRepository`: persists drafts, activations, retirements, rollbacks, math reports, and simulation runs.
- `OperatorLimitsRepository`: persists active/retired limit versions and provides transaction-safe limit reads for spin validation.
- `MetricsRepository`: stores/rebuilds metric buckets where needed while keeping ledger-derived reconciliation possible.
- `AlertRepository`: persists alert rules, alert history, acknowledgments, and resolutions.
- `BudgetProtectionRepository`: persists active/reverted protection actions and audit events.
- `AdminAuditRepository`: persists append-only admin audit events.
- `RequestTraceRepository`: persists request traces needed for support and incident review.
- `TeviTopupIdempotencyRepository`: stores future provider idempotency records without implementing Tevi crediting.

Domain services should depend on these interfaces, not concrete PostgreSQL classes. In-memory implementations remain test doubles, not production defaults.

### Schema Direction

Use database snake_case naming and API camelCase payloads, consistent with the existing architecture.

Core schema groups:

- Identity: `players`, `provider_identity_mappings`.
- Sessions: `sessions` with `active` and `expired` status history.
- Wallets: `wallets`, `wallet_transactions`.
- Spins: `spins`, `spin_wallet_transactions`, `spin_idempotency_keys` or equivalent uniqueness table.
- Configuration: existing `game_config_versions`, plus required math report and simulation persistence if not already represented by migrations.
- Operations: existing or reconciled `operator_limits`, `operator_metric_buckets`, `alert_rules`, `alert_history`, `budget_protection_actions`, `budget_protection_audit_events`.
- Audit and traces: `admin_audit_events`, `request_traces`.
- Future Tevi safety: `provider_topup_idempotency_records` or `tevi_topup_idempotency_records` with provider event/token uniqueness.

Schema rules:

- Store all balance, wager, payout, cap, jackpot, and top-up-like values as integer minor units.
- Enforce uniqueness for provider mappings and spin idempotency keys in PostgreSQL.
- Use foreign keys for historical explainability where records must remain linked, with delete behavior chosen to preserve audit history.
- Activated config versions, accepted spins, wallet transactions, and admin audit events are append-first historical records. Corrections use compensating rows or explicit status transitions.
- Store player-visible spin result payloads in enough detail to support later explanation without recomputing through changed code.

Existing migrations `0001` through `0005` are partial production schema, not the complete persistence model. The persistence epic should add missing migrations and reconcile existing migration names/locations into the canonical migration runner.

### Transaction Boundaries

Accepted spin handling is the highest-integrity transaction in the system.

The spin transaction must include:

1. Resolve and lock or reserve the durable idempotency key for `sessionId` plus `clientSpinId`.
2. Validate the session from persisted session state.
3. Read active config and active operator/budget protection state from persisted records.
4. Lock the player's wallet row or perform an equivalent conditional atomic update.
5. Insert wallet debit and credit transaction rows with balance before/after values.
6. Insert the accepted spin ledger row with config version, wager, stops, win breakdown, payout, balance after, and trace metadata.
7. Link wallet transactions to the spin.
8. Complete the idempotency record with the committed response payload.
9. Commit before returning an accepted response.

Rollback rules:

- If wallet debit fails, no accepted spin or success idempotency record is written.
- If wallet credit or transaction insert fails, the debit rolls back.
- If spin ledger insert fails, wallet mutations and idempotency completion roll back.
- If response delivery fails after commit, retry returns the committed result through durable idempotency lookup.

Concurrent wallet updates for the same player must serialize through PostgreSQL row-level locks or an equivalent conditional update pattern. Implementation stories should include concurrency tests against PostgreSQL, not only in-memory service tests.

### Migration Strategy

Use ordered SQL migration files under `apps/api/db/migrations` and add a migration runner that records applied migrations in a schema migrations table.

Migration requirements:

- Migrations run from an empty database in CI.
- Production deployment runs migrations before serving traffic that depends on the schema.
- Failed migrations block deployment/startup rather than falling back to in-memory state.
- Destructive rollback is not assumed for production ledger tables; forward-fix migrations are acceptable for append-only operational data.
- Migration logs/status are visible in deployment output.

Recommended scripts:

- `npm run db:migrate -w @china-slot-game/api`
- `npm run db:check -w @china-slot-game/api`
- `npm run test:integration -w @china-slot-game/api`

### Test Database Strategy

Persistence behavior must be verified against PostgreSQL.

Test setup rules:

- Integration tests use an isolated `DATABASE_URL`, never production data.
- Test setup applies all migrations from a clean state.
- Test cases isolate data through schema reset, transaction rollback, or per-worker database/schema names.
- CI provisions PostgreSQL before migration and persistence integration tests.
- Concurrency, rollback, restart-recovery, idempotency, admin/support search, and schema-readiness tests run against PostgreSQL.

Minimum persistence test coverage:

- Restart does not lose players, sessions, wallets, transactions, spins, configs, limits, alerts, audits, traces, or future top-up idempotency records.
- Duplicate spin retry returns the original accepted result and does not double debit or credit.
- Changed-wager duplicate retry returns idempotency conflict.
- Concurrent wallet updates cannot corrupt balances.
- Injected ledger failure rolls back wallet mutations.
- Injected wallet failure prevents accepted spin creation.
- Production startup fails without `DATABASE_URL` when PostgreSQL persistence is required.

### Admin, Metrics, Alerts, And Search

Admin/support APIs must be backed by persisted records after this epic.

- Spin search reads `spins` and related wallet/idempotency/request metadata.
- Balance transaction search reads `wallet_transactions`.
- Metrics either query durable ledgers directly or use rebuildable `operator_metric_buckets`; the ledger remains the reconciliation source of truth.
- Alert history, budget protection actions, and admin audit events survive restarts and remain searchable.
- Request traces include request ID, correlation ID when available, route/action context, status/outcome, duration, error code, and relevant player/session/spin/admin identifiers.

### Tevi Readiness Boundary

The Database Persistence epic keeps the original readiness boundary: add durable future-ready provider top-up idempotency records, but do not implement Tevi top-up behavior, webhook wallet crediting, cashout, redemption, transferable value, or real-money reward semantics inside that epic.

The record model must support:

- Provider name.
- Provider event ID or token.
- Normalized idempotency key.
- Player ID when known.
- Status such as `pending`, `completed`, `failed`, `ignored`, or `duplicate`.
- Amount/points metadata without implying redeemable value during the persistence epic.
- Raw provider metadata.
- First seen, last seen, completed, and failed timestamps.
- Failure reason/details.

The Tevi Mini App Integration PRD addendum dated 2026-06-27 intentionally advances this boundary for a later, separate Tevi integration path. In that path, the future-ready idempotency table becomes part of an implemented Stars wallet flow, but only after PostgreSQL persistence, schema readiness, and production dependency composition are complete.

Architectural rules for the Tevi integration path:

- Tevi mode is sandbox-first. Production Tevi exposure is blocked until legal review, permitted-jurisdiction geo-gating, age gate, KYC where available, responsible-gaming controls, deposit limits, self-exclusion, host float controls, security review, Tevi API key/secret approval, and production cutover approval are complete.
- Tevi Stars are treated as real-money-style value for architecture, risk, audit, observability, retry, and rollback design, even though v1 does not implement fiat withdrawal, game-managed currency conversion, crypto withdrawal, or off-platform redemption.
- Production Tevi mode uses Tevi Stars end to end: `1 Tevi Star = 1 in-game credit`; production users start at `0` Stars unless credited by Tevi top-up or an approved sandbox/admin fixture.
- The existing `defaultCoins: 100000` behavior is sandbox/demo-only and must not apply to production Tevi players.
- All Tevi balance, wager, payout, jackpot, free-spin win total, receipt, and cashout values are integer Star units and use integer storage at persistence boundaries.
- The backend remains authoritative for Tevi authentication mapping, wager validation, RNG, win calculation, internal wallet balance, ledger, manual cashout request validation, wallet debit/reservation, dispatch status, reconciliation status, and host float guard decisions.
- The client adds a thin `js/teviClient.js` adapter beside `js/serverClient.js` to load `https://static.tevicdn.com/helper_tevi.js`, detect `window.TeviJS`, obtain Tevi user app tokens, request backend top-up signatures, invoke SDK top-up, and expose Mini App UI affordances.
- The client never signs deposit tokens, verifies webhooks, computes payouts, mutates production balances, or treats SDK top-up success as a wallet credit before webhook processing commits.

Required Tevi backend boundaries:

- `TeviAuthAdapter`: exchanges and verifies Tevi identity tokens, caches JWKS, validates RS256 JWTs, rejects invalid or wrong-app tokens, and maps Tevi `user_id` to internal `player_id` through provider identity mappings.
- `TeviPaymentClient`: calls Tevi payment APIs with environment-supplied credentials only, issues or requests deposit tokens, dispatches cashout requests, and never logs full secrets, tokens, or signatures.
- `TeviWebhookService`: receives `user_topup` webhooks, verifies `X-TEVI-SIGNATURE` before effects, normalizes idempotency keys, and coordinates atomic wallet crediting through PostgreSQL.
- `TopupService`: validates integer Star amounts, deposit limits, user eligibility, and top-up metadata before returning backend-issued deposit tokens.
- `CashoutRequestService`: validates authenticated manual cashout requests for player-entered Star amounts against available internal wallet balance, cashout limits, compliance gates, self-exclusion state, host float, and Tevi readiness.
- `CashoutDispatcher`: dispatches accepted manual cashout requests after the internal cashout transaction commits, deriving the Tevi `Idempotency-Key` from the authoritative cashout request ID and storing dispatch state for retry and reconciliation.
- `CashoutReconciliationService`: tracks `pending`, `dispatched`, `succeeded`, `failed_retryable`, `failed_terminal`, and `reconciled` manual cashout states without corrupting the internal wallet ledger.
- `TeviReceiptService`: sends basic Tevi Message receipts for completed top-ups and manual cashout payouts; receipt failure is retryable and never rolls back wallet or cashout state.
- `ComplianceGateService`: blocks production Tevi access when jurisdiction, age, KYC, responsible-gaming, deposit-limit, self-exclusion, API approval, or policy gates are not satisfied.
- `HostFloatService` or budget-service extension: blocks spins whose maximum possible payout exceeds available host Stars float, alerts below configured float thresholds, and accounts for jackpot reserve and hard ceiling rules.

Tevi API and route additions:

- `POST /api/tevi/session` or an equivalent authenticated session route exchanges Tevi runtime identity for an internal player/session context using the existing `{data, error, requestId}` envelope.
- `POST /api/v1/payments/top-up-signature` issues a backend-approved Tevi deposit token for an authenticated Tevi user and validated integer Star amount.
- `POST /api/v1/webhooks/tevi` receives Tevi webhooks, verifies signatures, records provider events, and credits wallets idempotently.
- Existing `POST /api/spins` remains the authoritative spin entry point and must use Tevi/Stars wallet rules when the session is in Tevi mode.
- `POST /api/v1/payments/cashout-requests` accepts authenticated manual cashout requests for player-entered Star amounts, validates available internal Stars, records wallet debit/reservation and dispatch state, and returns cashout status.
- Admin/support search must expose top-up idempotency records, wallet credits, cashout dispatch attempts, reconciliation status, Tevi message receipt status, float guard decisions, and compliance gate denials.

Tevi persistence additions or refinements:

- Provider identity mappings must include Tevi user identifiers and preserve historical auditability.
- Top-up idempotency records must support both the readiness-only state from the persistence epic and the implemented states needed for webhook crediting.
- Wallet credit from Tevi top-up must commit atomically with idempotency completion and wallet transaction rows.
- Spin wins commit internally as wallet credits and do not automatically dispatch Tevi cashout. Manual cashout requests commit separately after user action and before Tevi provider dispatch.
- Cashout request/dispatch records store cashout request ID, Tevi user ID, player ID, requested amount, wallet transaction or reservation reference, idempotency key, payload fingerprint, dispatch status, attempt count, last error, and reconciliation timestamps.
- Message receipt records store top-up or cashout correlation, safe Tevi message metadata, dispatch status, and retry state.
- Compliance, deposit-limit, self-exclusion, and host-float blocks are audit records, not transient logs only.

Tevi transaction and retry rules:

- Webhook signature verification happens before wallet mutation.
- Duplicate `user_topup` webhook delivery returns the previously committed result and never double-credits.
- Duplicate top-up webhook with conflicting payload is rejected or quarantined for operator review without wallet mutation.
- Spin idempotency by `sessionId + clientSpinId` remains unchanged; duplicate spin retries return the committed internal result.
- Manual cashout is user-initiated and post-commit. The authoritative spin transaction must not call Tevi cashout; accepted cashout request transactions must commit before provider dispatch.
- Tevi cashout idempotency uses a UUIDv4-compatible key derived from the cashout request ID; reuse with different payload is treated as a conflict and escalated through reconciliation.

Tevi readiness gates:

- `PERSISTENCE_MODE=postgres`, valid `DATABASE_URL`, applied migrations, schema readiness, and required Tevi secrets are mandatory for Tevi mode startup.
- The active Tevi game configuration must pass simulator validation before sandbox real-value testing and before production exposure; target RTP defaults to configurable `92%` until product changes it.
- Host float, jackpot hard ceiling, jackpot reserve funding, maximum spin win cap, free-spin win cap, bet range, deposit limits, and self-exclusion rules are versioned configuration or operator settings, not hard-coded constants.
- PostgreSQL integration tests must cover Tevi JWT/auth mapping, top-up signature issuance, webhook replay idempotency, wallet credit atomicity, server spin debit/win, manual cashout request validation, post-commit cashout dispatch, cashout retry/reconciliation, message receipt failure isolation, float hard stops, and compliance gate denials.
- Manual Check Rounds from the Tevi PRD addendum are required implementation-story exit criteria for sandbox launch, SDK top-up, webhook replay, spin debit/win, manual cashout amount entry, cashout idempotency, reconciliation, receipts, simulator validation, float guardrails, and production compliance gates.

This updated boundary supersedes the old non-cash reward assumption only for the Tevi integration path. Non-Tevi deployments remain inside the original non-cash community reward boundary unless a separate PRD and architecture update changes them.

### Verified Tevi API Contracts (Sandbox, 2026-06-30)

The contracts below were confirmed end-to-end against the live Tevi sandbox during Story 8.5 and **correct several planning assumptions above**. They are authoritative for implementation; the full reference (with diagnostics and a per-game checklist) is `docs/tevi-integration-playbook.md`. The official `docs.tevi.com` shapes were repeatedly wrong — prefer runtime/playbook where they conflict.

- **Auth token shape:** `TeviJS.getUserInfo` returns the token at **top-level `userInfo.user_app_token`** (no `data` wrapper); success indicator is `call: "ok"`.
- **JWT claims are numeric, not boolean/string:** `user_is_active` and `user_anonymous` arrive as `1`/`0`, and `user_id` as a number. `TeviAuthAdapter` must coerce these (not require strict `=== true`/`typeof "string"`), and `TEVI_JWKS_URL` must be the full sandbox URL `https://developer-api.sbx.tevi.dev/api/v1/auth/jwks`.
- **Deposit-token issuance auth:** `TeviPaymentClient` must call `POST /api/v1/payments/top-up-signature` with **`Authorization: Bearer <user_app_token>`** (the end user's token, **forwarded** from the client) and body `{ amount }` — **not** the app API key/secret. This means the auth middleware must retain and thread the raw bearer token, not just the decoded identity. The deposit token is returned at **`data.token`** (not `data.deposit_token`).
- **SDK `topup()` contract:** success is `response.call === "ok"`; `channel_id` must be the **UUID decoded from the deposit-token payload**, not the numeric billing channel id. Failures carry `msg`/`response` detail (e.g. `Insufficient balance.`).
- **Webhook signature header is `X-Tevi-Signature`** (HMAC-SHA256 over the compact JSON payload) — note the casing differs from the `X-TEVI-SIGNATURE` used in the boundary notes above; use the verified casing in `TeviWebhookService`.
- **Cashout** (`POST /api/v1/payments/cashout`) authenticates with **`X-API-Key`** (server-to-server) — distinct from top-up's user-token auth.
- **Operational:** the top-up route only mounts when both Tevi auth and `TEVI_PAYMENT_ENABLED=true` are configured (missing config → silent 404); the Tevi webview caches aggressively (cache-bust client assets); and there is no in-webview console (ship a token-safe `?debugTevi=1` panel + structured `[tevi-*]` backend logs).

### Updated Structure Additions

Add or refine the API structure as follows:

```text
apps/api/
├── db/
│   ├── migrations/
│   └── test-utils/
├── src/
│   ├── composition/
│   │   ├── in-memory-dependencies.ts
│   │   └── production-dependencies.ts
│   ├── config/
│   │   └── env.ts
│   ├── db/
│   │   ├── pool.ts
│   │   ├── migrate.ts
│   │   ├── schema-readiness.ts
│   │   └── transactions.ts
│   ├── repositories/
│   │   ├── interfaces/
│   │   ├── in-memory/
│   │   └── postgres/
│   └── test-support/
│       ├── postgres-test-database.ts
│       └── persistence-fixtures.ts
└── test/
  └── integration/
    └── persistence/
```

The exact file split may evolve during implementation, but implementation agents must preserve these boundaries: production dependency composition, database connection/transaction utilities, repository interfaces, in-memory test doubles, PostgreSQL implementations, and PostgreSQL integration test support.

### Persistence Update Validation

The updated architecture covers the Database Persistence PRD addendum requirements:

- Player/provider identity persistence: covered by identity schema and repository boundaries.
- Session persistence: covered by `SessionRepository` and restart recovery requirements.
- Wallet and transaction persistence: covered by wallet schema, repository, transaction, and concurrency rules.
- Spin ledger and idempotency: covered by spin transaction and uniqueness requirements.
- Config, math report, and simulation persistence: covered by reconciled configuration repositories and migrations.
- Operator limits, metrics, alerts, budget protection, audit, and traces: covered by operations repositories and search/read models.
- Tevi top-up idempotency readiness: covered by durable future-ready provider idempotency records.
- Migration, test database, and production environment requirements: covered by migration runner, test DB strategy, and startup/readiness rules.
- Phaser client behavior and non-cash reward boundary: unchanged from the original architecture.

Updated readiness status: ready for `bmad-create-epics-and-stories` to create a dedicated Database Persistence epic and stories, followed by `bmad-check-implementation-readiness` before implementation resumes.
