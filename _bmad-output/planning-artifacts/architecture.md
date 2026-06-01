---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/prd.md
  - _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/addendum.md
  - _bmad-output/project-context.md
  - docs/project-overview.md
workflowType: architecture
project_name: China Slot Game
user_name: Donnie
date: 2026-06-01
lastStep: 8
status: complete
completedAt: 2026-06-01
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
