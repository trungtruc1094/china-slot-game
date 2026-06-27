---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/prd.md
  - _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/addendum.md
  - _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/database-persistence-addendum.md
  - _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/tevi-integration-addendum.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/project-context.md
  - docs/project-overview.md
  - docs/operations/retention-policy.md
  - docs/operations/ci-quality-gates.md
  - docs/operations/launch-readiness-checklist.md
updatedAt: 2026-06-27
status: complete
completedAt: 2026-06-27
---

# China Slot Game - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for China Slot Game, decomposing the requirements from the PRD and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: Players can start or resume a backend-authenticated game session before placing reward-bearing spins.

FR2: The backend validates bet amount, line/ways policy, balance, session status, game status, and active configuration before accepting a spin.

FR3: The backend resolves reel stops, line/ways wins, scatter wins, free-spin awards, jackpot wins, and total payout from the active Game Configuration.

FR4: The client preserves the current Phaser reel animation, controls, popups, and state transitions while replacing local outcome authority with backend-approved outcomes.

FR5: The host can create draft Game Configurations containing reel strips, paytable, scatter rules, jackpot rules, bet limits, free-spin rules, prize caps, and budget limits.

FR6: The system calculates theoretical RTP, hit rate, free-spin trigger frequency, jackpot trigger frequency, maximum payout exposure, and payout distribution for a draft configuration.

FR7: The host can run simulation batches against a draft Game Configuration before activation.

FR8: The host can activate a validated Game Configuration and roll back to a prior active version when needed.

FR9: The backend stores authoritative player balance and applies all debits, credits, free-spin awards, jackpot awards, and adjustments.

FR10: The backend records every accepted spin in an append-only Spin Ledger.

FR11: The product supports an internal balance or point model for community rewards while blocking cash-equivalent redemption until compliance approval.

FR12: The host can configure max bet, min bet, per-player daily reward cap, per-player daily wager cap, campaign budget, jackpot cap, max single-spin payout, and session limits.

FR13: The host can view total wagered, total paid, observed RTP, theoretical RTP, hit rate, player count, active sessions, jackpot liability, remaining budget, and alert state.

FR14: The system alerts the host when configured thresholds are crossed, including high observed RTP, low observed RTP, budget exhaustion, suspicious activity, backend error rate, or jackpot liability.

FR15: The backend enforces campaign and operator budget limits using predefined rules without altering already accepted spin outcomes.

FR16: Admin features require authenticated operator access with role-based permissions.

FR17: Support users can search spin and balance history by player, session, spin ID, date range, configuration version, or transaction type.

FR18: The system records admin actions, configuration changes, budget-limit changes, manual adjustments, failed spin validations, and alert acknowledgments in an operational audit trail.

### NonFunctional Requirements

NFR1: Security - The backend must treat all client data as untrusted; session tokens, admin permissions, bet values, and balance changes require server validation.

NFR2: Integrity - Reward-bearing spins must be idempotent or safely recoverable so network retries do not duplicate payouts.

NFR3: Observability - Spin volume, errors, latency, RTP windows, budget use, and alert state must be measurable.

NFR4: Performance - Backend spin resolution should target p95 under 300 ms excluding client animation, pending validation during implementation.

NFR5: Availability - If the backend is unavailable, reward-bearing play must stop safely while local visual demo mode may remain available.

NFR6: Data retention - Spin Ledger, balance transactions, configuration history, and admin audit logs must have explicit retention settings before launch.

NFR7: Accessibility - Critical client states such as balance, bet, win amount, errors, and disabled play must be readable without relying only on animation or sound.

NFR8: Compliance - The product must not present real-money, cash-equivalent, crypto, or redeemable rewards until legal review defines allowed jurisdictions, terms, age restrictions, disclosures, tax handling, and any no-purchase/free-entry requirements.

NFR9: Fair-operation guardrail - The system must not silently manipulate outcomes per player, session, or budget pressure; profitability control must happen through approved configuration, bet limits, prize caps, budget controls, and campaign pause rules.

NFR10: Configuration auditability - Any adaptive game configuration must apply only to future spins, require an audit entry, and be visible in operational history.

NFR11: Player-facing claims - Player-facing copy must avoid claiming guaranteed fairness unless RNG, configuration, and audit processes support that claim.

NFR12: Metrics clarity - Admin controls must distinguish theoretical game math from live observed performance because short-term observed RTP can vary naturally.

### Additional Requirements

- Use a repo-internal TypeScript backend package while preserving the existing static Phaser client during migration.
- Target Node.js 24 LTS for backend deployment.
- Use strict TypeScript and pin the exact TypeScript version during implementation.
- Use Express 5 for new TypeScript backend work unless dependency compatibility blocks it.
- Use PostgreSQL as the authoritative data store, preferring PostgreSQL 18 for greenfield local/dev infrastructure where provider support allows it.
- Use plain SQL migrations with `node-postgres` (`pg`) for the database persistence epic.
- Keep the existing Phaser client as the presentation layer and add a production-mode backend adapter.
- Create a canonical `packages/game-math` package used by backend spin execution, RTP calculation, simulations, and deterministic tests.
- Ensure the game math package has no Express, database, or UI dependencies.
- Correct or account for current client math/config issues before canonical simulation or live backend execution: 243-ways behavior, lowercase `pay`/`freeSpins` bug, dead `Scroll` symbol, unused `10` metadata, and server example mismatch.
- Store PostgreSQL tables for players, sessions, game configuration versions, math reports, simulation runs, spins, balance transactions, operator limits, admin audit events, and alerts.
- Store money-like and point values as integer units, not JavaScript floats.
- Use a replaceable player auth adapter that maps community identity to internal `player_id`.
- Use role-based admin authorization with at least `operator`, `support`, `viewer`, and future `admin` roles.
- Validate all API input with schemas before domain logic.
- Rate limit spin endpoints by player, session, and IP.
- Apply stronger rate limits and full audit logging to admin routes.
- Use REST JSON endpoints for v1: sessions, balance, spins, active config, admin config drafts, simulation, activation, rollback, metrics, and spin ledger search.
- Use a stable API response envelope with `data`, `error`, and `requestId`.
- Use error objects with `code`, `message`, and `details`.
- Keep production client non-authoritative: no RNG, payout calculation, balance mutation, operator limit enforcement, or configuration activation in the client.
- Keep local demo mode for visual development only, and prevent demo mode from being deployed as reward-bearing mode.
- Deploy as separate units: static client, TypeScript API, future admin UI, PostgreSQL database, and job/CLI processes for simulation and reporting.
- CI should run linting, typecheck, unit tests, deterministic game math tests, API integration tests, and migration checks.
- Use database snake_case naming and API camelCase payloads.
- Use TypeScript kebab-case file names, PascalCase classes/types, and camelCase functions/variables.
- Domain services should live in `apps/api/src/domain`; API handlers in `apps/api/src/routes`; repositories in `apps/api/src/repositories`; schemas in `apps/api/src/schemas`.
- Accepted spins must be idempotent by `clientSpinId` plus `sessionId`.
- Balance updates, spin ledger writes, and transaction records must commit in the same database transaction.
- Retry with the same `clientSpinId` must return the original accepted result.
- Simulation runs must not mutate player balances.
- Draft configurations must not affect live spins.
- Every spin ledger row must include `config_version_id`.
- Implementation should begin with shared game math and deterministic tests before production spin APIs.
- Critical launch blockers remain: compliance boundary for redeemable rewards, confirmed reward model, confirmed player identity source, and deterministic math matching active 243-ways behavior.

### UX Design Requirements

No separate UX Design document was found in `_bmad-output/planning-artifacts`. UX requirements currently extracted from PRD and architecture are:

UX-DR1: The client must preserve the current Phaser reel animation, controls, popups, and state transitions while consuming backend-approved outcomes.

UX-DR2: The client must display backend-returned balance, win breakdown, free-spin state, jackpot state, and errors.

UX-DR3: The client must show disabled states or clear errors when an operator limit blocks play.

UX-DR4: The client must provide clear pending, retry, or recovery states for network failure during spin.

UX-DR5: Critical states such as balance, bet, win amount, errors, and disabled play must be readable without relying only on animation or sound.

UX-DR6: Local demo mode must be visually or operationally distinguishable from reward-bearing production mode for developers/operators.

UX-DR7: Tevi Mini App mode must expose Tevi SDK launch affordances where available, including back/close controls and Mini App layout configuration.

UX-DR8: Tevi mode must label balance, bet, win, jackpot, free-spin win totals, top-up receipts, and cashout receipts as Stars.

UX-DR9: Top-up UX must show pending, credited, failed, and retry states, and must not treat SDK top-up success as wallet credit until webhook processing commits.

UX-DR10: Tevi spin UX must show clear user-facing states for insufficient balance, deposit-limit blocks, self-exclusion, jurisdiction blocks, float hard stops, backend errors, and retryable spin conflicts.

UX-DR11: Cashout and reconciliation UX must expose payout pending, succeeded, retryable failure, terminal failure, and operator-review states where authorized.

UX-DR12: Tevi receipt UX must make top-up and manual-cashout receipt status visible without rolling back wallet or cashout state when message delivery fails.

UX-DR13: Sandbox/demo separation must be visible or operationally enforced so production Tevi players never receive the existing `defaultCoins:100000` seed behavior.

### Tevi UX State Inventory

The Tevi implementation stories and Check Rounds must use this state inventory as the shared UX baseline until a standalone UX specification exists:

- Launch states: local demo, Tevi sandbox, Tevi production blocked, SDK unavailable fallback, loading, backend unavailable, and re-authentication required.
- Identity states: unauthenticated, token exchange pending, authenticated, expired token, invalid token, wrong-app token, inactive user, and anonymous user blocked where policy requires it.
- Top-up states: amount entry, deposit token requested, SDK confirmation open, SDK canceled, SDK failed, webhook pending, credited, duplicate webhook ignored, conflicting webhook quarantined, and retry available.
- Wallet and spin states: Stars balance loaded, balance refresh pending, insufficient balance, wager out of range, spin pending, spin accepted, idempotent retry returned, idempotency conflict, win credited internally, no-win, free-spin state updated, jackpot state updated, and backend error.
- Cashout states: amount entry, validation pending, insufficient cashout balance, limit blocked, pending, dispatched, succeeded, failed retryable, failed terminal, unknown, reconciled, and operator review required.
- Receipt states: top-up receipt pending/sent/failed retryable, cashout receipt pending/sent/failed retryable, and receipt status visible in support/admin search.
- Compliance and responsible-value states: jurisdiction blocked, age gate blocked, KYC blocked, terms/privacy/responsible-gaming acknowledgment required, self-exclusion active, deposit limit reached, support/dispute flow unavailable, and production approval missing.
- Host float and economy states: float alert threshold crossed, spin hard-stopped because maximum payout exceeds available float, jackpot reserve insufficient, jackpot ceiling reached, RTP validation missing, and tuning policy blocked.

Each state must have clear user-facing or operator-facing copy where visible, must avoid implying fiat withdrawal or off-platform redemption, and must be represented in the relevant story Check Round when that story touches the state.

### Database Persistence Functional Requirements

DP-FR1: Persist internal players and provider identity mappings so returning users resolve to the same stable internal player ID after restarts.

DP-FR2: Persist sessions with create, resume, expire, lookup, and support-search behavior.

DP-FR3: Persist one authoritative wallet per player and append-only wallet transaction records for non-cash game points.

DP-FR4: Ensure wallet mutations are atomic, concurrency-safe, integer-based, and traceable by request or correlation ID.

DP-FR5: Persist every accepted spin as an immutable durable spin ledger record with enough result detail for support explanation.

DP-FR6: Commit spin idempotency, spin ledger, wallet debit, wallet credit, balance update, and related transaction records in one atomic database transaction.

DP-FR7: Preserve spin idempotency by `sessionId` plus `clientSpinId`, including original-result retries and conflict errors for changed wager fingerprints.

DP-FR8: Back existing game configuration drafts, activations, rollbacks, math reports, and simulation metadata with PostgreSQL repositories.

DP-FR9: Persist operator limit versions and budget protection actions, and enforce limits safely under concurrent spins.

DP-FR10: Persist metrics-related state, alert rules/history, admin audit events, and request traces required for launch operations and support search.

DP-FR11: Add future-ready durable Tevi top-up/webhook idempotency records without implementing Tevi top-up, SDK bridge, webhook handling, or wallet crediting.

DP-FR12: Recover production behavior from persisted state after API process restart, deployment restart, crash, or post-commit response delivery failure.

DP-FR13: Provide repeatable SQL database migrations for CI and production deployment, including reconciliation of existing partial migrations.

DP-FR14: Run persistence integration tests against an isolated PostgreSQL test database with migrated schema and data isolation.

DP-FR15: Require `DATABASE_URL` or equivalent database connection secret in production/staging persistence mode and fail safe when unavailable.

DP-FR16: Preserve existing Phaser client presentation behavior except for intentional API error or retry semantics required by persisted state.

DP-FR17: Preserve the current non-cash reward boundary; persistence must not introduce cash-out, redemption, transferable value, or currency conversion behavior.

### Database Persistence NonFunctional Requirements

DP-NFR1: Data integrity must be enforced through database uniqueness, foreign keys, non-negative balance checks where applicable, valid status transitions, and immutable ledger/audit constraints where feasible.

DP-NFR2: Wallet and accepted-spin flows must use ACID transactions and appropriate PostgreSQL isolation or locking for correctness.

DP-NFR3: Persistence errors, lock contention, migration status, and database health must be observable through structured logs, traces, health checks, and operational metrics.

DP-NFR4: Persistence must preserve game feel under expected launch traffic; exact latency targets should be validated during implementation.

DP-NFR5: Admin/support workflows must search persisted records without direct database access.

DP-NFR6: Database credentials must be supplied through environment secrets and PII-like provider data must be minimized and protected.

DP-NFR7: Existing API contracts should remain stable unless changed intentionally for persistence safety.

DP-NFR8: Persistence behavior must be verified with integration tests against PostgreSQL, not only unit tests or in-memory fakes.

### Database Persistence Acceptance Criteria

DP-AC1: Restarting the API does not lose players, sessions, wallets, wallet transactions, accepted spins, game configurations, operator limits, alerts, budget protection actions, admin audit events, request traces, or launch metrics history.

DP-AC2: Duplicate spin retries with the same `sessionId` and `clientSpinId` return the original accepted result and do not double debit or double credit.

DP-AC3: Duplicate spin retries with changed wager data return an idempotency conflict and do not mutate state.

DP-AC4: Concurrent wallet updates for the same player cannot corrupt balances or produce inconsistent transaction history.

DP-AC5: Failed spin ledger writes roll back wallet mutations.

DP-AC6: Failed wallet mutations do not create accepted spin records or successful idempotency records.

DP-AC7: A crash or restart after database commit but before HTTP response delivery can be recovered by retrying the same spin request and receiving the committed result.

DP-AC8: A crash or restart before database commit leaves no partial accepted spin, wallet mutation, or success idempotency record.

DP-AC9: Migrations can be applied from a clean database in CI and before production traffic uses the new schema.

DP-AC10: Integration tests run against an isolated PostgreSQL test database.

DP-AC11: Admin/support search works from persisted player, session, transaction, spin, config, limit, alert, audit, and trace records.

DP-AC12: Active configuration, active operator limits, and active budget protection actions load from persisted state after restart.

DP-AC13: Future Tevi top-up/webhook handling can be made idempotent using durable records before wallet crediting is implemented.

DP-AC14: Production deployment fails safe when `DATABASE_URL` or schema readiness is missing.

DP-AC15: Existing Phaser gameplay presentation remains unchanged except for intentional API error or retry semantics required by persistence.

DP-AC16: No persistence change introduces cash-out, redemption, transferable value, or real-money reward behavior.

### Database Persistence Architecture Requirements

- Use PostgreSQL with plain SQL migrations and `node-postgres` (`pg`) for the persistence epic.
- Add a production dependency composition boundary so production/staging startup constructs PostgreSQL-backed repositories and services instead of implicit in-memory defaults.
- Preserve `createApp(dependencies)` as a testable Express composition function while requiring explicit in-memory dependency injection for unit/local test modes.
- Add `apps/api/src/config/env.ts`, `apps/api/src/db/pool.ts`, `apps/api/src/db/transactions.ts`, `apps/api/src/composition/production-dependencies.ts`, and PostgreSQL repository implementations under `apps/api/src/repositories/postgres` or equivalent structure.
- Define repository interfaces for players, sessions, wallets, spin ledger, spin idempotency, game configuration, operator limits, metrics, alerts, budget protection, admin audit, request traces, and future Tevi top-up idempotency.
- Add or reconcile schema groups for `players`, `provider_identity_mappings`, `sessions`, `wallets`, `wallet_transactions`, `spins`, spin idempotency records, config/math/simulation records, operations state, audit/traces, and future provider top-up idempotency records.
- Accepted spin handling must be one database transaction covering durable idempotency reservation/completion, session validation, active config/limit reads, wallet lock/update, wallet transaction inserts, spin ledger insert, transaction linking, and committed response payload storage.
- Use ordered SQL migrations under `apps/api/db/migrations` with an applied-migrations table and scripts such as `db:migrate`, `db:check`, and `test:integration`.
- Production readiness must distinguish API liveness from database/schema readiness.
- CI must provision PostgreSQL before migration and persistence integration tests.

### Tevi Mini App Integration Functional Requirements

TEVI-FR-1: Launch the game as a Tevi Mini App with registered `app_url`, `webhook_url`, required webhook scopes, an active channel, Tevi SDK loading in Tevi mode, and strict production/demo separation.

TEVI-FR-2: Authenticate Tevi users by verifying RS256 JWTs through cached JWKS, rejecting invalid or wrong-app tokens, and mapping Tevi `user_id` to stable internal `player_id` records.

TEVI-FR-3: Support Tevi token exchange and refresh using the documented grant flow while keeping tokens out of source control and logs.

TEVI-FR-4: Issue backend top-up signatures through `POST /api/v1/payments/top-up-signature` for authenticated Tevi users and validated integer Star amounts.

TEVI-FR-5: Run SDK top-up through `window.TeviJS.topup()` in the Mini App and treat SDK success as pending until webhook crediting completes.

TEVI-FR-6: Receive Tevi `user_topup` webhooks, verify `X-TEVI-SIGNATURE`, and credit internal Stars wallets exactly once through durable idempotency records and atomic PostgreSQL wallet transactions.

TEVI-FR-7: Use Tevi Stars as the production wallet currency for balances, bets, wins, jackpots, free-spin win totals, and receipts, with `1 Tevi Star = 1 in-game credit` and production starting balance `0` unless credited by Tevi top-up or approved sandbox/admin fixture.

TEVI-FR-8: Keep every production Tevi spin server-authoritative using canonical `packages/game-math`, durable spin idempotency by `sessionId + clientSpinId`, and PostgreSQL wallet/ledger transactions.

TEVI-FR-9: Accept manual cashout requests for player-entered Star amounts and dispatch Tevi Stars cashout after the internal cashout transaction commits, using a UUIDv4-compatible idempotency key derived from the authoritative cashout request ID.

TEVI-FR-10: Reconcile post-commit cashout failures so payout state is visible, retryable where safe, auditable, and never corrupts the internal wallet ledger.

TEVI-FR-11: Send basic Tevi Message receipts for completed top-ups and manual cashout payouts, with retryable message status that never rolls back wallet or cashout state.

TEVI-FR-12: Validate the active Tevi game configuration through the `packages/game-math` simulator before sandbox real-value testing and before production exposure.

TEVI-FR-13: Enforce host float and budget guardrails, including float alert thresholds, hard stops when maximum possible payout exceeds available float, jackpot reserve funding, and jackpot hard ceiling rules.

TEVI-FR-14: Block production Tevi exposure until compliance gates are complete, including legal review, permitted-jurisdiction geo-gating, 18+ age gate, KYC where available, Terms, Privacy, Responsible-Gaming, deposit limits, self-exclusion, support/dispute workflows, audit retention, and Tevi API approval.

### Tevi Mini App Integration NonFunctional Requirements

TEVI-NFR1: Integrity - no duplicate top-up credit, duplicate cashout payout, negative wallet corruption, or unledgered Star mutation may occur under retries, crashes, webhook replay, or provider failure.

TEVI-NFR2: Security - secrets, JWTs, API keys, refresh tokens, deposit tokens, webhook secrets, and signatures must be environment-supplied and never committed or logged in full.

TEVI-NFR3: Observability - every money-path request must log request ID, correlation ID where available, Tevi event ID where available, internal player/session/spin IDs where applicable, and safe status/error codes.

TEVI-NFR4: Performance - p95 spin response remains under 300 ms excluding client animation and excluding post-commit cashout dispatch.

TEVI-NFR5: Durability - production Tevi mode requires `PERSISTENCE_MODE=postgres` and must fail safe if PostgreSQL, migrations, schema readiness, or required Tevi secrets are missing.

TEVI-NFR6: Auditability - top-ups, wallet credits, spin debits, spin wins, cashout dispatches, reconciliation actions, Message sends, float guard decisions, and compliance gates must be retained and queryable.

TEVI-NFR7: Testability - all Tevi money paths must have PostgreSQL integration tests and replayable manual Check Rounds.

TEVI-NFR8: Compliance - production deployment is treated as real-money-style gaming and cannot proceed without legal/compliance sign-off.

### Tevi Mini App Integration Architecture Requirements

- Tevi mode is sandbox-first; production Tevi exposure is blocked until legal, jurisdiction, age, KYC, responsible-gaming, deposit-limit, self-exclusion, host-float, security, Tevi API approval, and cutover gates are complete.
- Tevi Stars are integer units end to end for balance, wager, payout, jackpot, free-spin win totals, receipts, cashout, host float, and reserve accounting.
- Add `js/teviClient.js` beside `js/serverClient.js` to load `https://static.tevicdn.com/helper_tevi.js`, detect `window.TeviJS`, obtain Tevi user app tokens, request backend top-up signatures, invoke SDK top-up, and expose Mini App UI affordances.
- The client must never sign deposit tokens, verify webhooks, compute payouts, mutate production balances, or treat SDK top-up success as a wallet credit before webhook processing commits.
- Add backend boundaries for `TeviAuthAdapter`, `TeviPaymentClient`, `TeviWebhookService`, `TopupService`, `CashoutRequestService`, `CashoutDispatcher`, `CashoutReconciliationService`, `TeviReceiptService`, `ComplianceGateService`, and host-float/budget-service extension.
- Add Tevi routes for authenticated session/token exchange, top-up signature issuance, webhook receipt, readiness, and support/admin search of Tevi money-path records.
- Extend persistence for Tevi provider identity mappings, top-up signature issuance records, top-up idempotency records, wallet credits, spin ledger Star fields, cashout dispatch records, message receipt records, host float/budget records, and compliance gate records.
- Wallet credit from Tevi top-up must commit atomically with idempotency completion and wallet transaction rows.
- Spin wins commit internally before Tevi cashout dispatch; cashout failure, timeout, or retryable provider error must not roll back or rewrite the committed spin ledger.
- Duplicate `user_topup` webhook delivery must return or preserve the previously committed result and never double-credit; conflicting duplicate payloads must be rejected or quarantined for operator review without wallet mutation.
- Manual cashout idempotency uses a UUIDv4-compatible key derived from cashout request ID; reuse with a different payload is treated as conflict and escalated through reconciliation.
- Host float, jackpot hard ceiling, jackpot reserve funding, maximum spin win cap, free-spin win cap, bet range, deposit limits, and self-exclusion rules are versioned configuration or operator settings, not hard-coded constants.
- PostgreSQL integration tests must cover Tevi JWT/auth mapping, top-up signature issuance, webhook replay idempotency, wallet credit atomicity, server spin debit/win, post-commit cashout dispatch, cashout retry/reconciliation, message receipt failure isolation, float hard stops, and compliance gate denials.
- Manual Check Rounds are required implementation-story exit criteria for sandbox launch, SDK top-up, webhook replay, spin debit/win, cashout idempotency, reconciliation, receipts, simulator validation, float guardrails, and production compliance gates.

### FR Coverage Map

FR1: Epic 2 - backend-authenticated game sessions.

FR2: Epic 2 - spin request validation.

FR3: Epic 1 and Epic 2 - canonical math and backend spin resolution.

FR4: Epic 2 and Epic 6 - Phaser client integration and safe production/demo behavior.

FR5: Epic 3 - draft game configuration.

FR6: Epic 1 and Epic 3 - theoretical math and config validation.

FR7: Epic 3 - simulation runs.

FR8: Epic 3 - config activation and rollback.

FR9: Epic 2 - backend-owned balance.

FR10: Epic 2 - append-only spin ledger.

FR11: Epic 2 and Epic 6 - non-cash reward accounting and compliance guardrails.

FR12: Epic 4 - operator limits.

FR13: Epic 4 and Epic 6 - live metrics and launch observability.

FR14: Epic 4 and Epic 6 - alerts.

FR15: Epic 4 and Epic 6 - budget protection.

FR16: Epic 5 - admin access control.

FR17: Epic 5 - support search.

FR18: Epic 5 and Epic 6 - audit trail and launch readiness.

DP-FR1: Epic 7 - durable player and provider identity persistence.

DP-FR2: Epic 7 - durable session create/resume/expire/search behavior.

DP-FR3: Epic 7 - durable wallet and wallet transaction persistence.

DP-FR4: Epic 7 - atomic and concurrency-safe wallet updates.

DP-FR5: Epic 7 - durable accepted spin ledger persistence.

DP-FR6: Epic 7 - atomic accepted spin transaction boundary.

DP-FR7: Epic 7 - durable spin idempotency by session and client spin ID.

DP-FR8: Epic 7 - PostgreSQL-backed game configuration, math report, and simulation persistence.

DP-FR9: Epic 7 - persisted operator limits and budget protection state.

DP-FR10: Epic 7 - persisted metrics, alerts, audit, and request trace state.

DP-FR11: Epic 7 - future-ready Tevi top-up idempotency records without Tevi implementation.

DP-FR12: Epic 7 - restart recovery from persisted production state.

DP-FR13: Epic 7 - repeatable SQL migration requirements.

DP-FR14: Epic 7 - isolated PostgreSQL test database requirements.

DP-FR15: Epic 7 - production `DATABASE_URL`, schema readiness, and fail-safe startup behavior.

DP-FR16: Epic 7 - unchanged Phaser client presentation except intentional persistence-safe API semantics.

DP-FR17: Epic 7 - preserved non-cash reward boundary.

TEVI-FR-1: Epic 8 and Epic 10 - Tevi sandbox Mini App launch, SDK loading, production/demo separation, and later Mini App polish.

TEVI-FR-2: Epic 8 and Epic 9 - Tevi JWT verification, internal identity mapping, and production security hardening.

TEVI-FR-3: Epic 8 - Tevi token exchange and refresh.

TEVI-FR-4: Epic 8 - backend top-up signature issuance.

TEVI-FR-5: Epic 8 - SDK top-up flow and pending webhook-credit behavior.

TEVI-FR-6: Epic 8 and Epic 9 - verified webhook receipt, idempotent wallet crediting, replay safety, and production hardening.

TEVI-FR-7: Epic 8 and Epic 10 - Stars wallet accounting and Stars-focused player experience polish.

TEVI-FR-8: Epic 8 and Epic 9 - Tevi server-authoritative spin ledger, idempotency, and production reliability hardening.

TEVI-FR-9: Epic 8 and Epic 9 - manual cashout request, post-commit provider dispatch, and production cashout safety.

TEVI-FR-10: Epic 8, Epic 9, and Epic 10 - cashout reconciliation, operator-grade production handling, and visible payout state polish.

TEVI-FR-11: Epic 8 and Epic 10 - basic Tevi Message receipts and richer notification polish.

TEVI-FR-12: Epic 8, Epic 9, and Epic 10 - sandbox RTP validation, production exposure gate, and simulator-backed tuning.

TEVI-FR-13: Epic 9 and Epic 10 - host float guardrails, jackpot reserve rules, monitoring, and tuning visibility.

TEVI-FR-14: Epic 9 - production compliance gate.

## Epic List

### Epic 1: Verified Slot Math Foundation

Players and operators can trust that the game math is deterministic, testable, and matches the current 243-ways behavior before any reward-bearing backend logic goes live.

**FRs covered:** FR3, FR6

### Epic 2: Server-Authoritative Player Spin Flow

Players can start a session, place a valid spin, receive backend-approved reel stops and outcomes, and see the existing Phaser client animate that result.

**FRs covered:** FR1, FR2, FR3, FR4, FR9, FR10, FR11

### Epic 3: Versioned Game Configuration and Simulation

The host can create, validate, simulate, activate, and roll back game configurations without affecting historical spins or live play unexpectedly.

**FRs covered:** FR5, FR6, FR7, FR8

### Epic 4: Operator Budget Controls and Live Metrics

The host can configure operational limits, monitor current game economics, receive alerts, and protect campaign budget without changing already accepted outcomes.

**FRs covered:** FR12, FR13, FR14, FR15

### Epic 5: Admin, Support, and Audit Workflows

Operators and support users can access admin features, inspect spin and balance history, and review a complete operational audit trail.

**FRs covered:** FR16, FR17, FR18

### Epic 6: Launch Guardrails and Production Readiness

The game can be safely deployed as a community reward mini game with non-cash reward boundaries, observability, retention rules, CI checks, and safe failure behavior.

**FRs covered:** FR4, FR11, FR13, FR14, FR15, FR18

### Epic 7: Production-Durable Gameplay and Operations Persistence

Players, operators, and support users can rely on restart-safe PostgreSQL-backed state for gameplay, wallets, spin ledger, configuration, operational controls, audit, request traces, and future Tevi top-up idempotency before Tevi Mini App integration begins.

**FRs covered:** DP-FR1, DP-FR2, DP-FR3, DP-FR4, DP-FR5, DP-FR6, DP-FR7, DP-FR8, DP-FR9, DP-FR10, DP-FR11, DP-FR12, DP-FR13, DP-FR14, DP-FR15, DP-FR16, DP-FR17

### Epic 8: Tevi Sandbox Stars Gameplay

A Tevi sandbox user can launch the Mini App, authenticate through Tevi, top up Stars, receive idempotent webhook wallet credit, spin with server-authoritative Stars accounting, manually cash out a selected Stars amount, receive basic receipts, and complete mandatory Check Rounds.

**FRs covered:** TEVI-FR-1, TEVI-FR-2, TEVI-FR-3, TEVI-FR-4, TEVI-FR-5, TEVI-FR-6, TEVI-FR-7, TEVI-FR-8, TEVI-FR-9, TEVI-FR-10, TEVI-FR-11, TEVI-FR-12

### Epic 9: Tevi Production Gate and Responsible-Value Controls

The host can prevent unsafe production exposure through compliance gates, deposit and self-exclusion controls, host float protection, jackpot reserve rules, audit retention, security review, observability, and cutover or rollback approval.

**FRs covered:** TEVI-FR-13, TEVI-FR-14, TEVI-FR-2, TEVI-FR-6, TEVI-FR-8, TEVI-FR-9, TEVI-FR-10, TEVI-FR-12

### Epic 10: Tevi Player Experience, Receipts, Analytics, and Tuning

Players and operators get polished Mini App flows, richer Tevi Message notifications, visible payout and reconciliation states, analytics, and simulator-backed tuning for retention, jackpot, free-spin, and economy health after the core Tevi path is safe.

**FRs covered:** TEVI-FR-1, TEVI-FR-7, TEVI-FR-10, TEVI-FR-11, TEVI-FR-12, TEVI-FR-13

## Epic 1: Verified Slot Math Foundation

Players and operators can trust that the game math is deterministic, testable, and matches the current 243-ways behavior before any reward-bearing backend logic goes live.

### Story 1.1: Create Canonical Game Math Package

As a developer,
I want a standalone game math package,
So that backend spin execution, RTP calculation, and simulation use one canonical implementation.

**Requirements:** FR3, FR6, NFR2, NFR3

**Acceptance Criteria:**

**Given** the existing Phaser client config and architecture document
**When** the package skeleton is created
**Then** `packages/game-math` contains TypeScript source, package metadata, test setup, and strict type configuration
**And** the package has no Express, database, browser, Phaser, or UI dependencies
**And** exported types include Game Configuration, reel strip, visible window, win breakdown, scatter rule, jackpot rule, and spin result structures
**And** unit tests can run for the package independently from the browser client

### Story 1.2: Model 243-Ways Reel Windows

As a developer,
I want the game math package to model the current 5-reel, 3-row, 243-ways behavior,
So that backend outcomes match the existing game rules.

**Requirements:** FR3, FR6, NFR2

**Acceptance Criteria:**

**Given** a Game Configuration with five reel strips and a reel stop for each reel
**When** the math package builds the visible window
**Then** it returns the three visible symbols for each reel using wraparound behavior
**And** it can generate all 243 possible left-to-right row combinations for a 5x3 window
**And** deterministic fixture tests prove the generated ways count and symbol coordinates
**And** the implementation does not rely on Phaser classes or browser globals

### Story 1.3: Implement Win, Scatter, and Jackpot Calculation

As an operator,
I want wins, scatters, and jackpots calculated consistently,
So that every payout can be explained and audited.

**Requirements:** FR3, FR6, NFR2, NFR9

**Acceptance Criteria:**

**Given** a visible window and active Game Configuration
**When** the win calculator evaluates the spin
**Then** it returns line/ways wins, scatter wins, free-spin awards, jackpot wins, and total payout
**And** wild symbol substitution follows the configured rules
**And** payout comparisons use the canonical lowercase `pay` and `freeSpins` fields
**And** fixture tests cover wins, losses, scatter triggers, jackpot triggers, wild substitution, and no-win cases
**And** dead or unreachable paytable entries are reported rather than silently ignored

### Story 1.4: Build RTP Calculator and Config Diagnostics

As a host,
I want theoretical RTP and configuration diagnostics,
So that I can tune game economics before launch.

**Requirements:** FR6, NFR3, NFR9, NFR12

**Acceptance Criteria:**

**Given** a draft Game Configuration
**When** the RTP calculator runs
**Then** it reports theoretical RTP, hit rate, free-spin trigger frequency, jackpot trigger frequency, max payout exposure, and payout distribution summary
**And** it flags missing reel symbols, unreachable paytable entries, inconsistent scatter/jackpot settings, and unused symbol metadata
**And** the current active config issues are detected in tests: `Scroll`, `10`, 243-ways behavior, and server-example mismatch risk
**And** output is serializable for storage in a math report

### Story 1.5: Build Seeded Simulation Runner

As a host,
I want repeatable simulation runs,
So that I can compare observed behavior against theoretical game math.

**Requirements:** FR6, FR7, NFR2, NFR3

**Acceptance Criteria:**

**Given** a Game Configuration, spin count, and optional seed
**When** the simulator runs
**Then** it returns observed RTP, hit rate, volatility summary, largest win, total wagered, total paid, scatter count, jackpot count, and confidence notes
**And** simulation with the same seed and inputs produces the same aggregate output
**And** simulation does not require database access or mutate player balances
**And** tests verify repeatability and basic convergence behavior on fixture configs

## Epic 2: Server-Authoritative Player Spin Flow

Players can start a session, place a valid spin, receive backend-approved reel stops and outcomes, and see the existing Phaser client animate that result.

### Story 2.1: Scaffold TypeScript API Service

As a developer,
I want a TypeScript API service foundation,
So that backend gameplay endpoints can be implemented consistently.

**Requirements:** FR1, FR2, NFR1, NFR2, NFR3, NFR4

**Acceptance Criteria:**

**Given** the architecture document
**When** the API service is scaffolded
**Then** `apps/api` contains Express 5-compatible TypeScript app structure, strict TypeScript config, environment loading, request IDs, error handling, and test setup
**And** health and readiness endpoints return stable API envelopes
**And** API responses use `{ data, error, requestId }`
**And** errors use `{ code, message, details }`
**And** CI-ready scripts exist for typecheck and tests

### Story 2.2: Create Session and Player Identity Adapter

As a player,
I want to start or resume a game session,
So that reward-bearing spins can be tied to my backend identity and balance.

**Requirements:** FR1, FR9, FR11, NFR1

**Acceptance Criteria:**

**Given** a valid community/player identity payload
**When** the client calls `POST /api/sessions`
**Then** the backend creates or resumes a session and returns session ID, player ID, balance, and safe session metadata
**And** invalid or expired session attempts return recoverable API errors
**And** the identity adapter is replaceable for future Discord, Telegram, email, or existing-account integration
**And** tests cover new session, resumed session, and invalid identity cases

### Story 2.3: Implement Backend Wallet and Balance Transactions

As a player,
I want my balance to be backend-owned,
So that displayed rewards and spend cannot be forged by the client.

**Requirements:** FR9, FR10, FR11, NFR1, NFR2

**Acceptance Criteria:**

**Given** a player with an internal point balance
**When** debits, credits, free-spin awards, jackpot awards, or adjustments are applied
**Then** the backend records balance before, balance after, transaction type, actor/source, and timestamp
**And** all balance values are stored as integer units
**And** client-provided balance values are ignored
**And** tests cover debit, credit, insufficient balance, and transaction record creation

### Story 2.4: Implement Authoritative Spin Endpoint

As a player,
I want to place a valid spin and receive a backend-approved result,
So that the game can be played fairly and consistently.

**Requirements:** FR2, FR3, FR9, FR10, FR11, NFR1, NFR2, NFR4

**Acceptance Criteria:**

**Given** an authenticated session, active configuration, sufficient balance, and valid wager
**When** the client calls `POST /api/spins`
**Then** the backend validates the wager, resolves RNG/reel stops through the game math package, calculates payout, updates balance, and records a spin ledger entry
**And** invalid bets, inactive sessions, missing active config, or insufficient balance are rejected without mutating balance
**And** the response includes spin ID, reel stops, visible symbols, win breakdown, wager, payout, balance after, free-spin state, jackpot state, and config version ID
**And** spin ledger, balance transaction, and balance update commit in one transaction

### Story 2.5: Add Spin Idempotency and Retry Safety

As a player,
I want network retries to be safe,
So that a slow or repeated request does not duplicate a spin or payout.

**Requirements:** FR2, FR9, FR10, NFR2, NFR5

**Acceptance Criteria:**

**Given** a spin request with `clientSpinId` and `sessionId`
**When** the same accepted request is retried
**Then** the backend returns the original spin result without creating a duplicate ledger entry or balance transaction
**And** conflicting reuse of `clientSpinId` with different wager data returns a clear error
**And** transaction rollback prevents partial balance or ledger writes
**And** tests cover retry, conflict, rollback, and success paths

### Story 2.6: Integrate Phaser Client With Backend Spin Results

As a player,
I want the existing slot game to animate server-approved outcomes,
So that the game feels the same while using backend authority.

**Requirements:** FR1, FR3, FR4, FR9, FR11, NFR5, NFR7, UX-DR1, UX-DR2, UX-DR4, UX-DR5, UX-DR6

**Acceptance Criteria:**

**Given** production mode is enabled
**When** the player starts a session and spins
**Then** the client calls backend session/spin APIs and animates to the returned reel stops
**And** the client displays backend-returned balance, win breakdown, free-spin state, jackpot state, and errors
**And** production mode never runs authoritative RNG, payout calculation, or balance mutation in the client
**And** network failure shows pending, retry, or recovery state
**And** local demo mode remains available for visual development and is distinguishable from production mode

## Epic 3: Versioned Game Configuration and Simulation

The host can create, validate, simulate, activate, and roll back game configurations without affecting historical spins or live play unexpectedly.

### Story 3.1: Create Game Configuration Persistence

As a host,
I want draft and active game configurations stored separately,
So that edits cannot accidentally change live play.

**Requirements:** FR5, FR8, FR10, NFR10

**Acceptance Criteria:**

**Given** the backend database
**When** configuration persistence is implemented
**Then** draft configurations and immutable active configuration versions are stored with IDs, status, actor, timestamps, and metadata
**And** every active configuration has a unique Configuration Version
**And** draft configurations cannot be selected by the spin endpoint
**And** tests cover draft creation, draft update, activation immutability, and active config lookup

### Story 3.2: Create Draft Configuration API

As a host,
I want to create and edit draft Game Configurations,
So that I can tune reel strips, paytable, scatter, jackpot, bet limits, prize caps, and budget settings.

**Requirements:** FR5, FR12, NFR1, NFR9, NFR10

**Acceptance Criteria:**

**Given** an authorized operator
**When** they call draft configuration endpoints
**Then** they can create, update, fetch, and list draft Game Configurations
**And** schema validation rejects malformed reel strips, paytables, scatter rules, jackpot rules, and limits
**And** each draft update records actor, timestamp, and reason where supplied
**And** unauthorized users cannot create or edit drafts

### Story 3.3: Attach Math Reports to Draft Configurations

As a host,
I want every draft configuration to produce a math report,
So that I can understand RTP and risk before activation.

**Requirements:** FR5, FR6, FR8, NFR3, NFR9, NFR12

**Acceptance Criteria:**

**Given** a valid draft Game Configuration
**When** the host requests math validation
**Then** the backend runs the canonical RTP calculator and stores the math report
**And** reports include RTP, hit rate, free-spin frequency, jackpot frequency, max payout exposure, payout distribution, and diagnostics
**And** configurations with blocking diagnostics cannot be activated
**And** math reports are linked to the draft and future active Configuration Version

### Story 3.4: Run and Store Simulation Batches

As a host,
I want to simulate a draft configuration,
So that I can compare expected and observed behavior before launch.

**Requirements:** FR6, FR7, NFR2, NFR3, NFR12

**Acceptance Criteria:**

**Given** a draft Game Configuration with a valid math report
**When** the host starts a simulation
**Then** the backend runs the simulation with configured spin count and optional seed
**And** it stores simulation parameters, seed, observed RTP, hit rate, volatility summary, largest win, total wagered, total paid, and confidence notes
**And** simulation results do not mutate player balances or spin ledgers
**And** repeated simulation with the same seed and inputs is reproducible

### Story 3.5: Activate and Roll Back Configurations

As a host,
I want to activate and roll back validated configurations,
So that future spins use approved economics while historical spins remain auditable.

**Requirements:** FR5, FR6, FR8, FR10, FR18, NFR9, NFR10

**Acceptance Criteria:**

**Given** a draft configuration with passing validation and simulation results
**When** the host activates it
**Then** the backend creates an immutable active Configuration Version and logs actor, timestamp, reason, and math report reference
**And** future spins use the active Configuration Version
**And** rollback changes only future spins and creates an audit event
**And** historical spins remain linked to the configuration used at spin time

## Epic 4: Operator Budget Controls and Live Metrics

The host can configure operational limits, monitor current game economics, receive alerts, and protect campaign budget without changing already accepted outcomes.

### Story 4.1: Configure Operator Limits

As a host,
I want to configure operational limits,
So that reward exposure is bounded before players spin.

**Requirements:** FR12, FR15, NFR9, NFR10

**Acceptance Criteria:**

**Given** an authorized operator
**When** they configure limits
**Then** they can set min bet, max bet, per-player daily reward cap, per-player daily wager cap, campaign budget, jackpot cap, max single-spin payout, and session limits
**And** limit changes are versioned and audited
**And** invalid limit combinations are rejected
**And** active limits are available to spin validation

### Story 4.2: Enforce Limits During Spin Validation

As a host,
I want the backend to enforce limits before accepting a spin,
So that campaigns cannot exceed configured guardrails.

**Requirements:** FR2, FR12, FR15, NFR1, NFR2, NFR9, UX-DR3

**Acceptance Criteria:**

**Given** active operator limits and a player spin request
**When** the spin is validated
**Then** the backend rejects spins that violate bet, balance, player cap, campaign budget, jackpot cap, or session limits
**And** rejected spins do not mutate balance or spin ledger
**And** accepted spins are never changed after acceptance due to budget pressure
**And** the client receives clear error codes it can display

### Story 4.3: Build Metrics Aggregation

As a host,
I want live operating metrics,
So that I can understand game economics during a campaign.

**Requirements:** FR13, FR14, NFR3, NFR12

**Acceptance Criteria:**

**Given** spin ledger and transaction records
**When** metrics are requested
**Then** the backend returns total wagered, total paid, observed RTP, theoretical RTP, hit rate, player count, active sessions, jackpot liability, remaining budget, and alert state
**And** metrics can be filtered by time window and Configuration Version
**And** observed RTP is clearly distinguished from theoretical RTP
**And** metric values reconcile against persisted ledger data

### Story 4.4: Create Alert Rules and Alert History

As a host,
I want alerts when operational thresholds are crossed,
So that I can react before reward exposure gets out of hand.

**Requirements:** FR13, FR14, NFR3, NFR12

**Acceptance Criteria:**

**Given** configured alert thresholds
**When** high RTP, low RTP, budget exhaustion, suspicious activity, backend error rate, or jackpot liability thresholds are crossed
**Then** the backend creates an alert with metric value, threshold, time window, severity, and suggested operator action
**And** alert history is retained
**And** authorized operators can acknowledge alerts
**And** alert state appears in admin metrics

### Story 4.5: Apply Budget Protection Actions

As a host,
I want predefined budget protection actions,
So that the system can safely limit future exposure.

**Requirements:** FR12, FR14, FR15, NFR9, NFR10, UX-DR3

**Acceptance Criteria:**

**Given** campaign budget is below a configured threshold
**When** budget protection runs
**Then** the backend applies the configured future-facing action: disable paid spins, lower max bet for future spins, pause campaign, or require host approval
**And** protection actions are logged with actor/source, timestamp, metric state, and reason
**And** protection actions never alter already accepted spin outcomes
**And** players receive clear client messaging when play is paused or limited

## Epic 5: Admin, Support, and Audit Workflows

Operators and support users can access admin features, inspect spin and balance history, and review a complete operational audit trail.

### Story 5.1: Implement Admin Authentication and Roles

As an operator,
I want admin features protected by role-based access,
So that only authorized people can view or change game operations.

**Requirements:** FR16, FR18, NFR1

**Acceptance Criteria:**

**Given** an admin identity
**When** the admin accesses protected routes
**Then** the backend verifies authentication and role permissions
**And** `operator`, `support`, `viewer`, and future `admin` roles are supported
**And** unauthorized access returns stable API errors
**And** admin access attempts are logged where appropriate

### Story 5.2: Search Spin Ledger

As a support user,
I want to search spin history,
So that disputed outcomes can be explained.

**Requirements:** FR10, FR17, FR18, NFR1, NFR6

**Acceptance Criteria:**

**Given** a support user with permission
**When** they search by player, session, spin ID, date range, configuration version, or transaction type
**Then** the backend returns matching spin records with wager, reel stops, visible symbols, win breakdown, balance before/after, Configuration Version, and timestamps
**And** sensitive player information is minimized
**And** unauthorized users cannot access ledger search
**And** result pagination prevents unbounded exports

### Story 5.3: Search Balance Transactions

As a support user,
I want to inspect balance transaction history,
So that player balance changes can be reconciled.

**Requirements:** FR9, FR10, FR17, FR18, NFR1, NFR6

**Acceptance Criteria:**

**Given** a support user with permission
**When** they search balance transactions
**Then** the backend returns transaction type, amount, balance before, balance after, source spin or adjustment, actor/source, and timestamp
**And** results can be filtered by player, session, date range, and transaction type
**And** transaction records reconcile with spin ledger outcomes
**And** export access can be restricted by role

### Story 5.4: Record Admin Audit Events

As an operator,
I want admin actions recorded in an audit trail,
So that operational changes are accountable.

**Requirements:** FR16, FR18, NFR6, NFR10

**Acceptance Criteria:**

**Given** an admin changes configuration, limits, manual adjustments, alert acknowledgments, or support-visible records
**When** the action is completed
**Then** the backend records actor, timestamp, action type, before/after values where applicable, reason, and request ID
**And** audit records cannot be edited through normal admin UI
**And** failed protected actions are logged where security-relevant
**And** tests cover audit creation for representative admin actions

### Story 5.5: Provide Admin Audit Search

As an operator,
I want to search the audit trail,
So that configuration and operational decisions can be reviewed.

**Requirements:** FR16, FR17, FR18, NFR1, NFR6

**Acceptance Criteria:**

**Given** an authorized operator
**When** they search audit events
**Then** they can filter by actor, action type, entity type, entity ID, date range, and request ID
**And** results show enough detail to understand what changed and why
**And** sensitive fields are redacted where needed
**And** unauthorized users cannot access audit search

## Epic 6: Launch Guardrails and Production Readiness

The game can be safely deployed as a community reward mini game with non-cash reward boundaries, observability, retention rules, CI checks, and safe failure behavior.

### Story 6.1: Enforce Non-Cash Reward Boundary

As a host,
I want the product to stay inside a non-cash reward model for MVP,
So that launch does not accidentally imply redeemable gambling behavior.

**Requirements:** FR11, NFR8, NFR11

**Acceptance Criteria:**

**Given** MVP reward mode is configured
**When** the client and admin surfaces display balances or rewards
**Then** labels and API metadata distinguish internal points/credits from cash-equivalent value
**And** redemption-related copy and features are disabled by default
**And** cash-equivalent reward support is blocked behind an explicit compliance-ready configuration
**And** tests verify default reward mode cannot expose cash-out or redemption states

### Story 6.2: Add Safe Backend Unavailable Behavior

As a player,
I want reward-bearing play to stop safely when the backend is unavailable,
So that no local-only reward outcomes are created.

**Requirements:** FR4, FR11, NFR5, NFR7, UX-DR4, UX-DR5, UX-DR6

**Acceptance Criteria:**

**Given** production mode is enabled
**When** the backend is unavailable or session validation fails
**Then** the client disables reward-bearing spin actions and shows a clear recoverable state
**And** local demo mode remains available only if explicitly enabled for visual development
**And** no client-side balance or payout mutation occurs during backend outage
**And** the behavior is covered by client integration tests or documented manual QA steps

### Story 6.3: Add Observability and Request Tracing

As an operator,
I want backend requests and spin operations traceable,
So that production issues can be diagnosed quickly.

**Requirements:** FR10, FR13, FR14, FR18, NFR3, NFR6

**Acceptance Criteria:**

**Given** API requests and spin operations
**When** the backend handles them
**Then** each request has a request ID included in logs and API responses
**And** logs capture spin validation failures, accepted spins, transaction failures, alert creation, and admin actions
**And** logs avoid sensitive player data
**And** core metrics include spin volume, errors, latency, RTP windows, budget use, and alert state

### Story 6.4: Define Retention and Launch Data Policies

As an operator,
I want retention rules for operational data,
So that ledger, audit, and metrics storage is intentional before launch.

**Requirements:** FR10, FR18, NFR6

**Acceptance Criteria:**

**Given** spin ledger, balance transactions, configuration history, simulation runs, admin audit logs, and alerts
**When** retention policy is configured
**Then** each record type has an explicit retention rule or preserve-forever decision
**And** retention policy is documented for operations
**And** destructive retention jobs are disabled until policy is approved
**And** launch readiness checks flag missing retention configuration

### Story 6.5: Add CI Quality Gates

As a developer,
I want automated quality gates,
So that math, API, and integration regressions are caught before deployment.

**Requirements:** FR3, FR4, FR6, FR10, NFR2, NFR3

**Acceptance Criteria:**

**Given** the repo contains client, API, and game math code
**When** CI runs
**Then** it executes linting, typecheck, unit tests, deterministic game math tests, API integration tests, and migration checks where applicable
**And** CI fails on game math fixture regression
**And** CI output identifies which package or app failed
**And** docs explain how to run the same checks locally

### Story 6.6: Produce Launch Readiness Checklist

As a host,
I want a launch readiness checklist,
So that community deployment does not proceed with unresolved operational blockers.

**Requirements:** FR4, FR11, FR13, FR14, FR15, FR18, NFR5, NFR6, NFR8, NFR9, NFR10, NFR12

**Acceptance Criteria:**

**Given** the MVP is near launch
**When** readiness is reviewed
**Then** the checklist covers reward model, player identity source, compliance boundary, active Configuration Version, math report, simulation result, budget limits, alert thresholds, retention policy, backend outage behavior, and support access
**And** unresolved blockers are clearly marked
**And** the checklist links to the relevant PRD, architecture, epics, and operational docs
**And** launch is not marked ready while compliance boundary, reward model, player identity, or deterministic math matching remains unresolved

## Epic 7: Production-Durable Gameplay and Operations Persistence

Players, operators, and support users can rely on restart-safe PostgreSQL-backed state for gameplay, wallets, spin ledger, configuration, operational controls, audit, request traces, and future Tevi top-up idempotency before Tevi Mini App integration begins.

### Story 7.1: Create PostgreSQL Runtime and Migration Harness

As a developer,
I want a PostgreSQL connection, schema readiness check, and SQL migration runner,
So that production persistence can be introduced safely and repeatably.

**Requirements:** DP-FR13, DP-FR14, DP-FR15, DP-NFR3, DP-NFR6, DP-NFR8, DP-AC9, DP-AC10, DP-AC14

**Acceptance Criteria:**

**Given** the API package is installed
**When** the persistence harness is implemented
**Then** `@china-slot-game/api` includes `pg` or an equivalent node-postgres dependency, a PostgreSQL pool module, a transaction helper, and a schema readiness check
**And** ordered SQL migrations under `apps/api/db/migrations` are applied through a migration runner that records applied migrations
**And** migration execution from an empty PostgreSQL database succeeds in an isolated test database
**And** a failed migration blocks schema readiness and surfaces a structured error
**And** production or `PERSISTENCE_MODE=postgres` startup fails when `DATABASE_URL` is missing or invalid
**And** local/test modes can still inject explicit in-memory dependencies without pretending to be production

### Story 7.2: Persist Players, Provider Identity Mappings, and Sessions

As a returning player,
I want my identity and active session to survive API restarts,
So that gameplay continuity does not depend on process memory.

**Requirements:** DP-FR1, DP-FR2, DP-FR12, DP-FR15, DP-NFR1, DP-NFR6, DP-NFR7, DP-AC1, DP-AC11, DP-AC12

**Acceptance Criteria:**

**Given** PostgreSQL persistence mode is enabled
**When** a valid identity starts or resumes a session
**Then** the API persists a stable internal player record, provider plus subject mapping, session ID, status, created time, expiration time, and relevant request metadata
**And** repeated session creation for the same provider subject returns the same internal player ID
**And** resume succeeds only for the same resolved player and an unexpired persisted session
**And** expired sessions are rejected for gameplay but remain searchable for support/audit use
**And** restarting the API does not lose active unexpired sessions or make expired sessions active
**And** tests cover new player creation, existing provider mapping reuse, session resume, session expiration, restart recovery, and support search filters

### Story 7.3: Persist Configuration Versions, Math Reports, and Simulation Runs

As a host,
I want configuration drafts, activations, rollbacks, math reports, and simulation runs stored durably,
So that live economics and historical spin explanations survive restarts.

**Requirements:** DP-FR8, DP-FR12, DP-FR13, DP-NFR1, DP-NFR3, DP-NFR8, DP-AC1, DP-AC9, DP-AC12

**Acceptance Criteria:**

**Given** existing configuration, math report, and simulation APIs
**When** PostgreSQL-backed configuration persistence is implemented
**Then** drafts, active versions, retired versions, rollback state, math reports, and simulation metadata are stored in PostgreSQL repositories
**And** existing partial migrations for `game_config_versions` are reconciled with any missing math report and simulation persistence tables
**And** draft configurations remain editable until activation and never affect live spins
**And** activated versions are immutable for gameplay purposes except allowed retirement or rollback status transitions
**And** rollback changes only future spins and preserves historical references
**And** simulation persistence writes only simulation records and never mutates player wallets, sessions, or live spin ledger
**And** tests cover draft lifecycle, activation, rollback, math report attachment, simulation storage, migration-from-empty behavior, and restart recovery of active config

### Story 7.4: Persist Wallets and Wallet Transactions With Concurrency Safety

As a player,
I want my non-cash point balance to be durable and correct under concurrent requests,
So that debits, credits, and adjustments cannot be lost or duplicated.

**Requirements:** DP-FR3, DP-FR4, DP-FR12, DP-FR17, DP-NFR1, DP-NFR2, DP-NFR3, DP-NFR8, DP-AC1, DP-AC4, DP-AC5, DP-AC6, DP-AC16

**Acceptance Criteria:**

**Given** a player with a PostgreSQL-backed wallet
**When** debits, credits, jackpot awards, free-spin awards, or adjustments are applied
**Then** the wallet balance and append-only wallet transaction records are persisted with integer amounts, balance before, balance after, actor, source, timestamp, correlation ID when available, and metadata
**And** wallet creation is idempotent and safe under concurrent first use
**And** concurrent updates for the same player serialize through row-level locks, conditional atomic updates, or an equivalent PostgreSQL-enforced mechanism
**And** insufficient balance fails without writing a wallet transaction or accepted spin record
**And** failed transaction inserts roll back wallet balance changes
**And** transaction history is searchable by player, transaction type, source/session, spin ID when present, and date range
**And** tests cover debit, credit, adjustment, insufficient balance, concurrent updates, rollback after injected failure, restart recovery, and non-cash reward labels/metadata

### Story 7.5: Persist Accepted Spins and Durable Spin Idempotency Atomically

As a player,
I want accepted spins and retries to be durable and idempotent,
So that crashes, duplicate requests, or network retries cannot double debit or double credit me.

**Requirements:** DP-FR5, DP-FR6, DP-FR7, DP-FR12, DP-FR16, DP-FR17, DP-NFR1, DP-NFR2, DP-NFR3, DP-NFR7, DP-NFR8, DP-AC1, DP-AC2, DP-AC3, DP-AC5, DP-AC6, DP-AC7, DP-AC8, DP-AC15, DP-AC16

**Acceptance Criteria:**

**Given** PostgreSQL-backed sessions, wallets, and active configuration exist
**When** a valid spin request with `sessionId` and `clientSpinId` is accepted
**Then** durable idempotency reservation/completion, session validation, wallet debit, wallet credit if any, wallet transaction inserts, spin ledger insert, transaction-to-spin linking, and committed response payload storage happen in one database transaction
**And** the API returns an accepted spin response only after commit
**And** the spin ledger stores spin ID, session ID, player ID, client spin ID, config version ID, wager, reel stops, visible window, win breakdown, payout, free-spin state, jackpot award amount, balance after, accepted timestamp, request/correlation identifiers, and wallet transaction references
**And** duplicate retries with the same session, client spin ID, and wager fingerprint return the original accepted result without additional wallet mutations
**And** duplicate retries with changed wager data return an idempotency conflict without mutating state
**And** injected wallet failures prevent accepted spin and success idempotency records
**And** injected ledger failures roll back wallet mutations and idempotency completion
**And** restart after commit but before response delivery can be recovered by retrying the same spin request
**And** restart before commit leaves no partial accepted spin, wallet mutation, or success idempotency record
**And** existing Phaser presentation behavior remains unchanged except for intentional retry/conflict/error semantics

### Story 7.6: Persist Operational Controls, Metrics, Alerts, Audit, and Request Traces

As an operator or support user,
I want limits, metrics, alerts, audits, and request traces to survive restarts,
So that launch operations and incident review use one durable source of truth.

**Requirements:** DP-FR9, DP-FR10, DP-FR12, DP-FR13, DP-NFR1, DP-NFR3, DP-NFR5, DP-NFR8, DP-AC1, DP-AC11, DP-AC12

**Acceptance Criteria:**

**Given** PostgreSQL persistence mode is enabled
**When** operator limits, budget protection actions, alert rules/history, admin audit events, request traces, and metrics state are created or read
**Then** those records are persisted through PostgreSQL-backed repositories
**And** existing partial migrations for operator limits, metric buckets, alert rules/history, and budget protection are reconciled with runtime repository use
**And** active operator limits and active budget protection actions load from persisted state after restart
**And** spin validation evaluates persisted active limits and budget protection actions
**And** budget and jackpot cap checks remain safe under concurrent spins
**And** metrics are either derived from durable ledgers or stored in rebuildable buckets with ledger reconciliation as source of truth
**And** admin/support search can retrieve persisted spin, wallet transaction, config, limit, alert, audit, and trace records
**And** request traces include request ID, correlation ID where available, route/action context, status/outcome, duration, error code, and relevant player/session/spin/admin identifiers
**And** tests cover restart recovery, search filters, active limit loading, active protection loading, alert persistence, audit persistence, request trace persistence, and metrics reconciliation

### Story 7.7: Add Future Tevi Top-Up Idempotency Persistence

As a future Tevi integration developer,
I want durable provider top-up idempotency records available before webhook/top-up implementation,
So that later payment-like retries can be made safe before wallet crediting is introduced.

**Requirements:** DP-FR11, DP-FR12, DP-FR17, DP-NFR1, DP-NFR6, DP-NFR8, DP-AC1, DP-AC13, DP-AC16

**Acceptance Criteria:**

**Given** the persistence schema is migrated
**When** future-ready top-up idempotency persistence is added
**Then** the database can store provider name, provider event ID or token, normalized idempotency key, mapped player ID when known, status, amount or points metadata, raw provider metadata, first seen time, last seen time, completion time, and failure reason
**And** provider event/token uniqueness is enforced durably
**And** supported statuses include pending, completed, failed, ignored, or duplicate
**And** repository operations can create, read, mark completed, mark failed, and detect duplicates without crediting a wallet
**And** no Tevi SDK, Tevi identity, webhook handler, top-up processing, wallet crediting, cash-out, redemption, or real-money semantics are implemented in this story
**And** tests cover unique provider event enforcement, duplicate detection, status transitions, restart recovery, and non-cash metadata language

### Story 7.8: Wire Production PostgreSQL Dependencies and Fail-Safe Startup

As an operator,
I want production startup to use PostgreSQL-backed services or fail safely,
So that reward-bearing play never runs on accidental in-memory state.

**Requirements:** DP-FR12, DP-FR13, DP-FR15, DP-FR16, DP-FR17, DP-NFR3, DP-NFR6, DP-NFR7, DP-AC1, DP-AC12, DP-AC14, DP-AC15, DP-AC16

**Acceptance Criteria:**

**Given** the PostgreSQL repositories are implemented
**When** the API starts in production or `PERSISTENCE_MODE=postgres`
**Then** production dependency composition constructs PostgreSQL-backed repositories and services for player identity, sessions, wallets, spins, config, limits, metrics, alerts, budget protection, audit, request traces, and Tevi top-up idempotency
**And** production startup fails when `DATABASE_URL` is missing, unreachable, or schema readiness fails
**And** production startup does not silently fall back to in-memory repositories or process-local ledgers
**And** in-memory dependencies remain available only through explicit test/local composition
**And** `SEED_ACTIVE_CONFIG=true` cannot seed an in-memory active config in production persistence mode
**And** liveness and readiness endpoints distinguish API process health from database/schema readiness
**And** existing Phaser client behavior remains unchanged for successful persisted API responses
**And** tests cover production dependency selection, missing database URL, database unavailable, schema not ready, in-memory local composition, and readiness responses

### Story 7.9: Verify Persistence Recovery, Admin Search, and Quality Gates

As a host,
I want persistence recovery and launch gates verified end to end,
So that the game is ready for Tevi planning only after durable state is proven.

**Requirements:** DP-FR12, DP-FR13, DP-FR14, DP-FR15, DP-FR16, DP-FR17, DP-NFR3, DP-NFR5, DP-NFR8, DP-AC1, DP-AC2, DP-AC4, DP-AC7, DP-AC9, DP-AC10, DP-AC11, DP-AC12, DP-AC13, DP-AC14, DP-AC15, DP-AC16

**Acceptance Criteria:**

**Given** the persistence epic implementation is complete
**When** the persistence verification suite runs
**Then** CI can provision or connect to an isolated PostgreSQL database, apply migrations, run persistence integration tests, and report migration or database failures as a named gate
**And** tests prove restart recovery for players, sessions, wallets, transactions, accepted spins, config history, active limits, active budget protection, alerts, audit events, request traces, metrics history, and future top-up idempotency records
**And** tests prove duplicate spin retries do not double debit or double credit
**And** tests prove concurrent wallet updates do not corrupt balances
**And** tests prove admin/support search works from persisted records after restart
**And** launch readiness documentation is updated to mark database persistence as required before Tevi integration
**And** CI quality-gate documentation is updated to include migration and PostgreSQL integration checks
**And** no cash-out, redemption, transferable value, or Tevi top-up implementation is introduced

## Epic 8: Tevi Sandbox Stars Gameplay

A Tevi sandbox user can launch the Mini App, authenticate through Tevi, top up Stars, receive idempotent webhook wallet credit, spin with server-authoritative Stars accounting, manually cash out a selected Stars amount, receive basic receipts, and complete mandatory Check Rounds.

### Story 8.1: Launch Tevi Mini App Sandbox Shell

As a player,
I want the game to launch inside Tevi sandbox as a Mini App,
So that I can enter the existing slot experience through the Tevi H5 runtime without reward-bearing demo behavior leaking into production mode.

**Requirements:** TEVI-FR-1, TEVI-FR-7, TEVI-NFR2, TEVI-NFR5, UX-DR7, UX-DR8, UX-DR13

**Acceptance Criteria:**

**Given** Tevi sandbox mode is enabled with configured `TEVI_APP_ID`, sandbox `app_url`, sandbox `webhook_url`, and active channel metadata
**When** the player opens the registered Tevi Mini App URL
**Then** the existing Phaser client loads successfully inside the Tevi H5/Mini App context
**And** the page loads `https://static.tevicdn.com/helper_tevi.js` only in Tevi mode
**And** `js/teviClient.js` detects `window.TeviJS` when available and exposes safe Mini App helpers to the game
**And** Tevi SDK back/close/layout affordances are initialized where available without breaking local browser mode
**And** local/demo mode remains available only for non-reward visual development
**And** production Tevi mode cannot seed real players with the existing `defaultCoins:100000` demo balance
**And** the implementation preserves the existing Phaser reel animation, controls, popups, and state transitions
**And** the story ends with a Check Round showing sandbox app launch, SDK presence, app URL registration, webhook URL registration, active channel configuration, and local/demo mode separation.

### Story 8.2: Authenticate Tevi Users and Map Player Identity

As a player,
I want Tevi identity to authenticate me into the game,
So that my Stars wallet, session, and spin ledger are tied to a stable internal player record.

**Requirements:** TEVI-FR-2, TEVI-NFR1, TEVI-NFR2, TEVI-NFR3, TEVI-NFR5

**Acceptance Criteria:**

**Given** a Tevi runtime token or access token from the sandbox auth flow
**When** the backend authenticates the request
**Then** it verifies the RS256 JWT through cached JWKS from `GET /api/v1/auth/jwks`
**And** invalid, expired, wrong-app, inactive, anonymous-disallowed, or unverifiable tokens are rejected without creating gameplay state
**And** a valid Tevi `user_id` creates or reuses a provider identity mapping to a stable internal `player_id`
**And** sessions and wallets reference the internal `player_id`, not raw client-supplied identity
**And** JWT verification failures are logged with `requestId` and a safe diagnostic reason
**And** protected Tevi routes use the authenticated internal player context
**And** the story ends with Check Rounds for JWKS fetch plus JWT verification and auth middleware on a protected route.

### Story 8.3: Exchange and Refresh Tevi Tokens

As a player,
I want the Mini App and backend to exchange and refresh Tevi tokens safely,
So that my authenticated game session can continue without exposing secrets or forcing unnecessary relogin.

**Requirements:** TEVI-FR-3, TEVI-NFR2, TEVI-NFR3, TEVI-NFR5, UX-DR10

**Acceptance Criteria:**

**Given** `window.TeviJS.getUserInfo({ is_popup, app_id }, cb)` returns `data.userInfo.user_app_token`
**When** Tevi mode starts authentication
**Then** the integration exchanges the token through `GET /api/v1/auth/token?app_id=...` with `Authorization: Bearer <TEVI_TOKEN>`
**And** access-token and refresh-token metadata is handled only through approved secure runtime handling
**And** full tokens are never committed, returned to unsafe clients, or logged in full
**And** access tokens refresh before expiry where possible
**And** token exchange or refresh failure returns a recoverable re-authentication state
**And** game-owned responses preserve the existing `{ data, error, requestId }` envelope
**And** the story ends with a Check Round including curl examples, expected response shape, local protected route behavior, and `requestId` log correlation.

### Story 8.4: Issue Backend Top-Up Signatures

As a player,
I want the game server to issue a Tevi top-up deposit token for my requested Star amount,
So that SDK top-up can be initiated without trusting client-side signing or amount validation.

**Requirements:** TEVI-FR-4, TEVI-FR-7, TEVI-NFR2, TEVI-NFR3, TEVI-NFR5, TEVI-NFR6

**Acceptance Criteria:**

**Given** an authenticated Tevi player context and an integer Star amount
**When** the client calls `POST /api/v1/payments/top-up-signature`
**Then** the backend validates identity, amount, configured deposit limits, channel/app settings, and Tevi credential availability
**And** the backend signs or requests the deposit token using environment-supplied Tevi credentials only
**And** the response returns `{ deposit_token }` inside the existing `{ data, error, requestId }` API envelope
**And** safe issuance metadata is recorded, including amount, internal player ID, request ID, deposit-token fingerprint, status, and timestamp
**And** missing or invalid credentials, invalid amount, deposit-limit violation, or unauthorized user fails without wallet mutation
**And** full secrets, signatures, deposit tokens, access tokens, and refresh tokens are never logged in full
**And** the story ends with a Check Round for curl success and failure cases, required headers, logs, and database metadata.

### Story 8.5: Run SDK Top-Up With Pending Wallet State

As a player,
I want to top up Stars through the Tevi sandbox SDK,
So that I can initiate a funded wallet flow while the game waits for authoritative webhook crediting.

**Requirements:** TEVI-FR-5, TEVI-FR-7, TEVI-NFR1, TEVI-NFR2, TEVI-NFR3, UX-DR8, UX-DR9, UX-DR10

**Acceptance Criteria:**

**Given** Tevi sandbox mode, an authenticated player, and a backend-issued `deposit_token`
**When** the player selects a valid Star top-up amount
**Then** `js/teviClient.js` calls `window.TeviJS.topup({ amount, deposit_token, channel_id, metadata }, cb)`
**And** successful SDK callback changes the top-up to pending, not credited
**And** credited, failed, canceled, and retry states are visible and recoverable in the client
**And** missing `deposit_token` surfaces the Tevi `403` failure in the verification flow
**And** the client does not mutate the authoritative wallet balance from SDK callback alone
**And** local/demo mode remains unaffected by Tevi SDK top-up behavior
**And** the story ends with a manual sandbox-card Check Round covering SDK callback, pending UI state, failure state, and webhook follow-through.

### Story 8.6: Verify Tevi Webhooks and Credit Stars Idempotently

As a player,
I want confirmed Tevi top-ups to credit my game wallet exactly once,
So that webhook retries or duplicate provider events cannot create incorrect Stars balances.

**Requirements:** TEVI-FR-6, TEVI-FR-7, TEVI-NFR1, TEVI-NFR2, TEVI-NFR3, TEVI-NFR5, TEVI-NFR6, TEVI-NFR7, UX-DR9

**Acceptance Criteria:**

**Given** Tevi posts a `user_topup` webhook with `X-TEVI-SIGNATURE`
**When** the backend receives `POST /api/v1/webhooks/tevi`
**Then** it verifies the webhook signature before parsing effects or mutating any wallet
**And** it normalizes provider event and idempotency keys before any balance mutation
**And** top-up idempotency records store provider event ID, normalized key, mapped player, amount, status, timestamps, raw metadata, and failure reason when applicable
**And** wallet credit, idempotency completion, and wallet transaction rows commit atomically in PostgreSQL
**And** duplicate webhook replay returns or preserves the previously committed result without double-crediting the wallet
**And** duplicate webhook delivery with conflicting payload is rejected or quarantined for operator review without wallet mutation
**And** unknown users, invalid metadata, amount mismatches, and signature failures are handled without unsafe crediting
**And** the story ends with a webhook replay Check Round showing no double-credit in wallet ledger or top-up idempotency rows.

### Story 8.7: Spin With Server-Owned Stars Wallet and Ledger

As a player,
I want to spin using my Tevi Stars wallet,
So that wagers, wins, free-spin state, jackpot state, and balances are server-owned and audit-ready.

**Requirements:** TEVI-FR-7, TEVI-FR-8, TEVI-FR-12, TEVI-NFR1, TEVI-NFR3, TEVI-NFR4, TEVI-NFR5, TEVI-NFR6, TEVI-NFR7, UX-DR8, UX-DR10

**Acceptance Criteria:**

**Given** an authenticated Tevi session, credited Stars wallet, active validated configuration, and valid `clientSpinId`
**When** the player calls `POST /api/spins`
**Then** the backend validates integer Star wager, balance, session, active configuration, applicable limits, free-spin state, and Tevi mode
**And** client-provided RNG, result, win amount, jackpot award, free-spin award, or balance is ignored
**And** wallet debit, win credit if any, spin ledger, wallet transactions, idempotency record, and request trace commit before returning success
**And** duplicate retry with the same `sessionId`, `clientSpinId`, and wager fingerprint returns the original result without additional wallet mutation
**And** conflicting retry returns an idempotency conflict without mutating state
**And** the response includes Stars balance, wager, payout, free-spin state, jackpot state, updated withdrawable wallet balance, and configuration version
**And** UI labels balance, bet, win, jackpot, free-spin totals, and errors as Stars in Tevi mode
**And** the story ends with server spin debit/win Check Rounds covering curl, UI interaction, ledger SQL, idempotency retry proof, and expected response envelope.

### Story 8.8: Request Manual Tevi Stars Cashout

As a winning player,
I want to enter a Stars amount and request cashout from my game wallet,
So that I can choose when and how much available balance to transfer back through Tevi.

**Requirements:** TEVI-FR-9, TEVI-FR-10, TEVI-NFR1, TEVI-NFR2, TEVI-NFR3, TEVI-NFR6, TEVI-NFR7, UX-DR11

**Acceptance Criteria:**

**Given** an authenticated Tevi player has available internal Stars balance
**When** the player submits a manual cashout amount through the game UI
**Then** the backend validates integer Star amount, available wallet balance, cashout limits, compliance gates, self-exclusion state, host float, Tevi readiness, and player identity
**And** rejected requests for insufficient balance, invalid amount, blocked eligibility, exceeded limits, or unavailable Tevi configuration do not mutate wallet, ledger, idempotency, or provider dispatch state
**And** accepted requests create a cashout request record linked to internal player ID, Tevi user ID, requested amount, wallet debit or reservation, idempotency key, payload fingerprint, status, attempt count, and request ID
**And** the cashout request transaction commits before any Tevi provider cashout call is attempted
**And** it derives a UUIDv4-compatible `Idempotency-Key` from the authoritative cashout request ID
**And** it calls Tevi `POST /api/v1/payments/cashout` with `X-API-Key`, `Idempotency-Key`, rewards payload, and description after internal commit
**And** retry with the same idempotency key and payload does not double-payout
**And** reuse of the same idempotency key with a changed payload records a conflict for reconciliation or operator review
**And** internal wallet, spin ledger, and cashout request state remain correct when the Tevi cashout call fails, times out, or returns a retryable provider error
**And** the story ends with manual cashout amount-entry and idempotency Check Rounds, including insufficient-balance rejection, replay with the same `Idempotency-Key`, and conflict behavior for changed payloads.

### Story 8.9: Reconcile Cashout Failures Safely

As an operator,
I want failed or uncertain manual Tevi cashouts to be visible and safely retryable,
So that payout incidents can be resolved without double-paying or corrupting the game ledger.

**Requirements:** TEVI-FR-10, TEVI-NFR1, TEVI-NFR3, TEVI-NFR6, TEVI-NFR7, UX-DR11

**Acceptance Criteria:**

**Given** a manual cashout request record in `pending`, `dispatched`, `failed_retryable`, `failed_terminal`, `unknown`, or equivalent state
**When** reconciliation runs or an operator or support user inspects payout status
**Then** status, attempt count, provider response summary, last error, reconciliation state, related spin ID, related wallet transaction IDs, and request ID are visible
**And** retryable failures can be retried with the original idempotency key and payload fingerprint
**And** terminal failures require operator review and cannot silently mutate wallet or spin ledger state
**And** a simulated provider timeout or failure leaves the internal spin ledger, cashout request record, and internal Stars wallet correct
**And** logs and database rows expose pass/fail criteria without full secrets, tokens, or signatures
**And** the story ends with a simulated payout failure Check Round including logs, SQL, retry command, and expected state transitions.

### Story 8.10: Send Basic Tevi Top-Up and Cashout Receipts

As a player,
I want receipt messages for completed top-ups and manual cashout payouts,
So that I can confirm important Stars events outside the slot animation alone.

**Requirements:** TEVI-FR-11, TEVI-NFR2, TEVI-NFR3, TEVI-NFR6, TEVI-NFR7, UX-DR12

**Acceptance Criteria:**

**Given** a completed top-up credit or manual cashout dispatch state
**When** receipt dispatch runs
**Then** top-up receipts include credited Stars amount and correlation ID
**And** cashout receipts include cashout request ID, Stars amount, and cashout status
**And** message dispatch records store message type, recipient, source event, status, attempt count, provider response summary, and retry state
**And** message dispatch failures do not roll back wallet, spin, cashout, or reconciliation state
**And** receipt status is visible through logs and support/admin search where authorized
**And** full secrets, tokens, signatures, and sensitive player data are not logged in full
**And** the story ends with a Message receipts Check Round with request/response examples and user-visible receipt verification.

### Story 8.11: Verify RTP and Sandbox Money-Path Check Rounds

As a host,
I want the Tevi sandbox money path and active game configuration verified before real-value testing,
So that sandbox rollout is evidence-backed and replayable.

**Requirements:** TEVI-FR-12, TEVI-NFR1, TEVI-NFR3, TEVI-NFR5, TEVI-NFR6, TEVI-NFR7

**Acceptance Criteria:**

**Given** the Tevi sandbox integration path exists
**When** final Epic 8 verification runs
**Then** the `packages/game-math` simulator validates the active Tevi configuration against target RTP, hit rate, largest win, free-spin trigger frequency, jackpot trigger frequency, and max exposure tolerance
**And** known math or configuration issues are fixed or explicitly neutralized before sandbox real-value testing
**And** `_bmad-output/verification-playbook.md` records Check Rounds for sandbox launch, JWT verification, token exchange, top-up signature, SDK top-up, webhook replay, server spin debit/win, manual cashout amount entry, cashout idempotency, reconciliation, receipts, and RTP simulation
**And** each Check Round includes changed files, exact commands, curl examples, UI steps, logs to watch, SQL to inspect, pass/fail criteria, and idempotency proof where relevant
**And** PostgreSQL integration tests cover Tevi JWT/auth mapping, top-up signature issuance, webhook replay idempotency, wallet credit atomicity, server spin debit/win, manual cashout request validation, post-commit cashout dispatch, cashout retry/reconciliation, and message receipt failure isolation
**And** no production Tevi exposure is enabled by this epic
**And** the story ends with Donnie acceptance of all Epic 8 Check Rounds.

## Epic 9: Tevi Production Gate and Responsible-Value Controls

The host can prevent unsafe production exposure through compliance gates, deposit and self-exclusion controls, host float protection, jackpot reserve rules, audit retention, security review, observability, and cutover or rollback approval.

### Story 9.1: Fail Safe Tevi Production Startup Until Required Gates Pass

As an operator,
I want Tevi production mode to fail safe until required runtime, database, secret, and approval gates pass,
So that real-value-style play cannot start from incomplete configuration or accidental sandbox settings.

**Requirements:** TEVI-FR-14, TEVI-NFR2, TEVI-NFR5, TEVI-NFR8

**Acceptance Criteria:**

**Given** `TEVI_MODE=production` or an equivalent production Tevi runtime flag is configured
**When** the API starts or readiness is checked
**Then** startup or readiness fails unless `PERSISTENCE_MODE=postgres`, `DATABASE_URL`, applied migrations, schema readiness, and required Tevi secrets are present
**And** production Tevi mode cannot use sandbox API bases, sandbox JWKS URLs, sandbox app IDs, or demo balance seeding
**And** production readiness requires recorded approval state for legal review, Tevi API key/secret approval, security review, and production cutover approval
**And** Story 9.1 establishes the shared production gate state model for later Epic 9 stories, including approval records, compliance gate records, deposit-limit settings, self-exclusion records, host-float settings, readiness gate status, actor, reason, timestamp, and request ID
**And** production gate state is persisted in PostgreSQL or equivalent durable storage and is searchable through authorized support/admin workflows without direct database access
**And** later Epic 9 stories consume this shared gate state model rather than creating parallel approval, compliance, deposit-limit, self-exclusion, or float records
**And** failure responses identify missing gate categories without exposing secret values
**And** liveness remains separate from readiness so the process can report blocked production exposure safely
**And** tests cover missing database, missing migrations, missing Tevi secrets, sandbox config in production, missing approval records, gate-state persistence, gate-state support search, and audit records
**And** the story ends with a Check Round covering changed files, exact commands, readiness responses, missing-gate curl examples where relevant, logs/support-search checks, pass/fail criteria, and production gate denial proof.

### Story 9.2: Gate Production Access by Jurisdiction, Age, KYC, and Terms

As a compliance owner,
I want production Tevi access blocked until player eligibility gates pass,
So that only permitted users can enter value-bearing gameplay.

**Requirements:** TEVI-FR-14, TEVI-NFR1, TEVI-NFR3, TEVI-NFR6, TEVI-NFR8, UX-DR10

**Acceptance Criteria:**

**Given** a Tevi-authenticated user attempts to start or resume a production Tevi session
**When** compliance gates evaluate the user
**Then** permitted jurisdiction, 18+ age gate, KYC status where available, Terms acceptance, Privacy acknowledgment, Responsible-Gaming acknowledgment, and support/dispute availability are checked before gameplay state is created
**And** blocked states return stable API error codes and clear client states without revealing sensitive eligibility details
**And** compliance decisions are logged and persisted with request ID, safe reason code, actor/source, and timestamp
**And** denied users cannot top up, spin, receive cashout, or bypass gates through direct API calls
**And** support/admin search can inspect gate denials where authorized
**And** tests cover blocked and allowed users for each eligibility gate
**And** the story ends with a Check Round covering changed files, exact commands, allowed/blocked curl examples, UI/manual blocked-state observations, logs/support-search checks, pass/fail criteria, and gate-denial proof.

### Story 9.3: Enforce Deposit Limits and Self-Exclusion

As a player,
I want deposit limits and self-exclusion to be enforced consistently,
So that responsible-gaming controls apply before I add or spend Stars.

**Requirements:** TEVI-FR-4, TEVI-FR-7, TEVI-FR-14, TEVI-NFR1, TEVI-NFR3, TEVI-NFR6, TEVI-NFR8, UX-DR9, UX-DR10

**Acceptance Criteria:**

**Given** production Tevi mode has configured deposit limits and self-exclusion records
**When** a player requests a top-up signature, starts a session, refreshes balance, or attempts a spin
**Then** active self-exclusion blocks top-up, spin, and value-bearing session access
**And** deposit-limit checks reject top-up signature requests that would exceed configured per-transaction, daily, campaign, or player limits
**And** limit and self-exclusion changes are persisted as audit records with actor, reason, before/after values, and timestamp
**And** player-facing errors are clear and recoverable without exposing private policy details
**And** rejected top-up or spin attempts do not mutate wallet, ledger, idempotency, or cashout state
**And** tests cover active self-exclusion, expired self-exclusion, deposit-limit success, deposit-limit rejection, and direct API bypass attempts
**And** the story ends with a Check Round covering changed files, exact commands, top-up/spin denial curl examples, UI/manual blocked-state observations, logs/SQL/support-search checks, pass/fail criteria, and no-mutation proof for rejected attempts.

### Story 9.4: Enforce Host Float, Jackpot Reserve, and Payout Exposure Hard Stops

As a host,
I want Stars float and jackpot reserve rules to block unsafe exposure before spins are accepted,
So that accepted wagers cannot create payouts the host account cannot cover.

**Requirements:** TEVI-FR-13, TEVI-FR-14, TEVI-NFR1, TEVI-NFR3, TEVI-NFR6, TEVI-NFR7, UX-DR10

**Acceptance Criteria:**

**Given** production or sandbox-real-value Tevi mode has host float, jackpot reserve, bet range, max win cap, jackpot ceiling, and free-spin win cap settings
**When** a player requests a spin
**Then** the backend calculates maximum possible payout exposure for the requested spin before accepting it
**And** spins are hard-stopped when maximum possible payout exceeds remaining available host float
**And** alerts are created when host float falls below the configured threshold, defaulting to 20% of target float unless overridden
**And** jackpot reserve funding and jackpot hard ceiling are accounted for in integer Stars
**And** guardrail decisions are persisted with request ID, player/session/spin context when available, metric state, reason code, and timestamp
**And** blocked spins do not mutate wallet, spin ledger, idempotency, cashout, or jackpot state
**And** the story ends with a float guardrails Check Round showing alert threshold, hard-stop behavior, UI error, logs, and database state.

### Story 9.5: Harden Tevi Money-Path Security and Idempotency

As a security reviewer,
I want Tevi auth, webhook, top-up, spin, cashout, and receipt paths reviewed and hardened,
So that production exposure does not rely on unsafe token handling, weak signature checks, or incomplete idempotency.

**Requirements:** TEVI-FR-2, TEVI-FR-6, TEVI-FR-8, TEVI-FR-9, TEVI-FR-10, TEVI-FR-14, TEVI-NFR1, TEVI-NFR2, TEVI-NFR3, TEVI-NFR7, TEVI-NFR8

**Acceptance Criteria:**

**Given** the Epic 8 sandbox money paths are implemented
**When** security hardening is performed for production readiness
**Then** JWT verification enforces issuer, audience/app ID, expiry, active-user status, JWKS cache behavior, and key rotation handling
**And** webhook signature verification happens before effects and uses a documented Tevi-approved algorithm or library
**And** Tevi API keys, secret keys, webhook secrets, access tokens, refresh tokens, deposit tokens, and signatures are supplied by environment or approved secret storage only
**And** logs redact full secrets, full tokens, signatures, and sensitive player data
**And** idempotency conflict behavior is tested for top-up webhook replay, spin retry, cashout retry, and changed-payload conflict cases
**And** rate limits and request validation protect Tevi auth, top-up, webhook, spin, cashout, and admin/support routes
**And** the story produces a security review checklist with pass/fail status and remediation notes
**And** the story ends with a Check Round covering changed files, exact commands, security checklist location, representative failure curl examples, log redaction checks, idempotency conflict proof, pass/fail criteria, and remediation handoff if any item fails.

### Story 9.6: Add Tevi Observability, Audit Retention, and Support Search

As an operator or support user,
I want Tevi money-path state observable, retained, and searchable,
So that incidents, disputes, and production operations can be investigated without direct database access.

**Requirements:** TEVI-FR-6, TEVI-FR-9, TEVI-FR-10, TEVI-FR-11, TEVI-FR-13, TEVI-FR-14, TEVI-NFR3, TEVI-NFR6, TEVI-NFR7, TEVI-NFR8, UX-DR11, UX-DR12

**Acceptance Criteria:**

**Given** Tevi production-readiness observability is enabled
**When** top-ups, wallet credits, spins, cashout dispatches, reconciliation actions, message sends, float guard decisions, and compliance gates occur
**Then** each event records request ID, correlation ID where available, provider event ID where available, internal player/session/spin IDs where applicable, status, safe error code, and timestamp
**And** support/admin search can query top-up idempotency records, wallet credits, spin ledger rows, manual cashout requests, cashout dispatch attempts, reconciliation status, message receipt status, float guard decisions, and compliance denials
**And** retention policies are documented and implemented for Tevi-specific ledger, audit, trace, message, cashout, compliance, and guardrail records
**And** dashboards or metrics expose money-path success/failure rates, webhook replay/conflict counts, cashout retry backlog, float threshold alerts, compliance denial counts, and p95 spin latency excluding cashout dispatch
**And** sensitive fields are redacted in logs, search results, exports, and dashboards according to role
**And** tests cover search authorization, retention configuration presence, trace creation, metric emission, and redaction
**And** the story ends with a Check Round covering changed files, exact commands, support/admin search examples, metrics/log inspection, retention evidence, redaction checks, pass/fail criteria, and money-path observability proof.

### Story 9.7: Approve Production Cutover and Rollback Playbook

As a host,
I want a production cutover and rollback playbook approved before launch,
So that Tevi production exposure can be started, monitored, paused, and rolled back deliberately.

**Requirements:** TEVI-FR-12, TEVI-FR-13, TEVI-FR-14, TEVI-NFR3, TEVI-NFR5, TEVI-NFR6, TEVI-NFR7, TEVI-NFR8

**Acceptance Criteria:**

**Given** Epic 8 sandbox verification and Epic 9 production gates are complete
**When** production cutover readiness is reviewed
**Then** the playbook includes required environment variables, secret approval, migration status, readiness checks, Tevi app registration, webhook URL verification, active channel confirmation, active game configuration, RTP simulator artifact, float settings, jackpot reserve settings, deposit limits, self-exclusion controls, compliance approvals, observability links, and support contacts
**And** rollback steps cover disabling Tevi production readiness, pausing value-bearing spins, preserving ledger integrity, stopping top-up signature issuance, draining or pausing cashout retries, and communicating support status
**And** production launch remains blocked until legal, security, Tevi API approval, simulator validation, host float approval, and Donnie acceptance are recorded
**And** the playbook includes smoke-test Check Rounds for session start, top-up signature denial/approval, webhook verification, spin hard-stop, cashout dispatch, reconciliation visibility, and receipt status
**And** tests or scripted checks verify readiness fails before approval and passes only after required approvals are recorded.

## Epic 10: Tevi Player Experience, Receipts, Analytics, and Tuning

Players and operators get polished Mini App flows, richer Tevi Message notifications, visible payout and reconciliation states, analytics, and simulator-backed tuning for retention, jackpot, free-spin, and economy health after the core Tevi path is safe.

### Story 10.1: Polish Tevi Mini App Launch and Navigation UX

As a player,
I want the Tevi Mini App experience to feel native and clear,
So that launch, navigation, balance, top-up, and game controls are understandable inside Tevi.

**Requirements:** TEVI-FR-1, TEVI-FR-7, TEVI-NFR3, TEVI-NFR7, UX-DR7, UX-DR8, UX-DR10, UX-DR13

**Acceptance Criteria:**

**Given** the Tevi sandbox and production-gated paths exist
**When** the player launches the Mini App in Tevi mode
**Then** Tevi back, close, layout, and option-menu affordances are configured where available without breaking the existing Phaser controls
**And** balance, bet, win, jackpot, free-spin, top-up, and receipt labels consistently use Stars terminology
**And** local/demo mode, sandbox mode, and production Tevi mode are operationally distinguishable in configuration and user-visible state where appropriate
**And** loading, unavailable backend, re-authentication, insufficient balance, deposit-limit, self-exclusion, jurisdiction, and float-hard-stop states are clear and recoverable
**And** the polished flow preserves existing reel animation, audio, popups, and core game feel
**And** manual QA covers desktop browser fallback, Tevi sandbox H5, narrow mobile viewport, and SDK-unavailable fallback
**And** the story ends with a Check Round covering changed files, exact commands, desktop/mobile manual UI observations, SDK-unavailable fallback, screenshots or equivalent observations where practical, pass/fail criteria, and confirmation that production compliance gates remain enforced.

### Story 10.2: Add Richer Tevi Message Receipts and Notification Preferences

As a player,
I want clearer Tevi Message receipts for top-ups and wins,
So that I can understand important Stars events without relying only on the game screen.

**Requirements:** TEVI-FR-11, TEVI-FR-7, TEVI-NFR2, TEVI-NFR3, TEVI-NFR6, UX-DR12

**Acceptance Criteria:**

**Given** basic Tevi receipt dispatch exists
**When** a top-up credit, manual cashout success, cashout retryable failure, or cashout terminal failure occurs
**Then** receipt content includes the event type, Stars amount, correlation ID or spin ID, safe status, and support reference where applicable
**And** richer receipt templates avoid misleading fairness, guaranteed payout, fiat conversion, or off-platform redemption claims
**And** notification dispatch status, retries, and failures remain visible in support/admin search
**And** message delivery failure does not roll back wallet, spin, cashout, reconciliation, or compliance state
**And** player notification preferences or future opt-out hooks are represented without weakening required compliance/support messaging
**And** tests cover template rendering, redaction, dispatch failure isolation, retry state, and support search visibility
**And** the story ends with a Check Round covering changed files, exact commands, receipt template examples, dispatch success/failure evidence, support-search visibility, pass/fail criteria, and proof that receipt failure does not roll back money-path state.

### Story 10.3: Surface Payout, Cashout, and Reconciliation Status Clearly

As a player or support user,
I want payout and reconciliation status to be visible and understandable,
So that delayed or failed cashouts can be resolved without confusion or duplicate action.

**Requirements:** TEVI-FR-10, TEVI-FR-11, TEVI-NFR3, TEVI-NFR6, TEVI-NFR7, UX-DR11, UX-DR12

**Acceptance Criteria:**

**Given** a Tevi spin creates cashout and receipt state
**When** the player views the current win state or support inspects spin details
**Then** payout status distinguishes pending, dispatched, succeeded, failed retryable, failed terminal, reconciled, and operator review states
**And** player-facing copy avoids exposing provider internals while giving a clear next step or wait state
**And** support/admin details include linked spin ID, wallet transactions, cashout dispatch records, receipt records, request IDs, attempt counts, and safe provider response summaries
**And** retry or operator-review actions are role-protected and audited
**And** stale pending states are detectable through metrics or support search
**And** tests cover status rendering, role-based detail visibility, redaction, stale pending detection, and retry/action audit records
**And** the story ends with a Check Round covering changed files, exact commands, UI/support-search examples for each payout state, logs/SQL checks, pass/fail criteria, and role-protected retry/operator-review proof.

### Story 10.4: Add Tevi Funnel, Economy, and Operational Analytics

As a host,
I want Tevi analytics for player flow, economy health, and operational risk,
So that I can tune the Mini App and monitor real-value-style operations responsibly.

**Requirements:** TEVI-FR-10, TEVI-FR-12, TEVI-FR-13, TEVI-NFR3, TEVI-NFR6, TEVI-NFR7

**Acceptance Criteria:**

**Given** Tevi sandbox or production-gated data is available
**When** analytics are requested for a time window, configuration version, or campaign
**Then** the system reports launch count, authenticated users, top-up starts, top-up completions, webhook failures, spin count, total wagered Stars, total won Stars, manual cashout request count, manual cashout Stars amount, observed RTP, theoretical RTP, cashout success rate, cashout retry backlog, receipt success rate, float alerts, compliance denials, and self-exclusion/deposit-limit blocks
**And** observed RTP remains clearly distinguished from theoretical RTP
**And** analytics reconcile against durable ledger, wallet, cashout, message, and compliance records
**And** dashboards or exports redact sensitive player/provider data according to role
**And** alerts can be configured for key Tevi funnel, economy, float, webhook, cashout, and receipt anomalies
**And** tests cover metric calculation, filtering, reconciliation, redaction, and alert threshold behavior
**And** the story ends with a Check Round covering changed files, exact commands, analytics query examples, dashboard/export observations where practical, reconciliation checks, redaction checks, pass/fail criteria, and alert threshold proof.

### Story 10.5: Tune RTP, Free Spins, Jackpot, and Bet Defaults With Simulator Evidence

As a host,
I want simulator-backed tuning for Tevi Stars economics,
So that RTP, volatility, jackpot exposure, and free-spin behavior are intentional before wider rollout.

**Requirements:** TEVI-FR-12, TEVI-FR-13, TEVI-NFR1, TEVI-NFR3, TEVI-NFR7

**Acceptance Criteria:**

**Given** a draft Tevi game configuration with Stars bet range, target RTP, max win cap, jackpot start, jackpot ceiling, reserve percentage, and free-spin cap
**When** the host runs simulator-backed tuning
**Then** reports include theoretical RTP, observed RTP, confidence or tolerance, hit rate, volatility summary, largest win, max exposure, free-spin trigger frequency, jackpot trigger frequency, and jackpot reserve impact
**And** known math/config issues are either fixed or explicitly neutralized before any tuned configuration can be activated
**And** tuning output compares candidate configurations against host float and jackpot reserve constraints
**And** activation remains blocked when target RTP, max exposure, jackpot ceiling, free-spin cap, or diagnostics fall outside approved policy
**And** all tuning artifacts link to the draft or active configuration version and remain auditable
**And** tests cover deterministic seeds, repeatability, policy-blocking diagnostics, and activation linkage
**And** the story ends with a Check Round covering changed files, exact simulator commands, seed/config version/result artifacts, logs or stored report checks, pass/fail tolerance, and policy-blocking proof.

### Story 10.6: Complete Tevi Polish and Tuning Verification

As a host,
I want the Tevi polish, analytics, and tuning work verified end to end,
So that the post-MVP improvements are ready without weakening safety gates.

**Requirements:** TEVI-FR-1, TEVI-FR-7, TEVI-FR-10, TEVI-FR-11, TEVI-FR-12, TEVI-FR-13, TEVI-NFR3, TEVI-NFR6, TEVI-NFR7, TEVI-NFR8

**Acceptance Criteria:**

**Given** Epic 10 implementation is complete
**When** final polish and tuning verification runs
**Then** Check Rounds prove Mini App launch polish, Stars labeling, top-up and spin UX states, payout/reconciliation visibility, richer receipts, analytics, and simulator-backed tuning
**And** verification includes commands, screenshots or manual UI observations, curl examples where relevant, SQL or support-search checks, log markers, metric checks, and pass/fail criteria
**And** production compliance, readiness, secret, persistence, and float gates from Epic 9 remain enforced
**And** no Epic 10 story introduces fiat withdrawal, crypto withdrawal, off-platform redemption, client-side RNG, client-authoritative balance, or production Tevi bypass behavior
**And** `_bmad-output/verification-playbook.md` is updated with Epic 10 Check Rounds and residual risks
**And** Donnie acceptance is recorded for the Epic 10 verification package.

