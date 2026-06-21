---
title: Database Persistence PRD Addendum - China Slot Game
status: draft
created: 2026-06-21
updated: 2026-06-21
parent_prd: prd-china-slot-game-2026-06-01
---

# Database Persistence PRD Addendum: China Slot Game

## Purpose

This addendum defines product requirements for converting the China Slot Game API from process-local in-memory state to durable PostgreSQL-backed persistence before Tevi Mini App integration begins.

The current implementation has completed the original BMad implementation track through Epics 1-6 and now includes server-authoritative gameplay, wallet concepts, spin ledger concepts, configuration/versioning, admin controls, audit, metrics, alerts, and launch-readiness artifacts. However, core runtime state is still wired mostly through in-memory services, especially in `apps/api/src/app.ts`. That is acceptable for implementation validation, but not for a production launch path.

Database persistence must be completed before Tevi identity, Stars top-ups, deposit/top-up tokens, SDK `topup()`, webhooks, or duplicate/retry payment-like flows are implemented. Those flows require durable idempotency, atomic wallet credits, audit history, and restart recovery.

## Scope

### In Scope

- Persist players and provider identity mappings.
- Persist sessions with create, resume, expire, and lookup behavior.
- Persist wallets and append-only wallet transactions.
- Make wallet updates atomic and safe under concurrent requests.
- Persist accepted spins and spin ledger entries.
- Commit spin resolution, balance mutation, idempotency records, and ledger writes atomically.
- Preserve spin idempotency by `clientSpinId` plus `sessionId`.
- Persist game configuration drafts, activations, rollbacks, math reports, and simulation metadata.
- Persist operator limits, metrics-related state, alerts, budget protection actions, admin audit events, and request traces needed for production launch.
- Add future-ready durable idempotency records for Tevi top-up/webhook handling, without implementing Tevi flows yet.
- Define restart recovery, migration, test database, and production environment requirements.
- Preserve the current Phaser client behavior except where persisted API state requires clearer responses or error semantics.
- Preserve the current non-cash reward boundary until Tevi Stars/game-point policy is clarified.

### Out of Scope

- Tevi identity implementation.
- Tevi top-up, webhook, SDK bridge, or Stars purchase implementation.
- Game math redesign.
- Phaser client rewrite.
- Cash-out, redeemable rewards, real-money redemption, or crypto behavior.
- Multi-currency wallet support beyond schema choices that avoid blocking later policy decisions.

## Product Principles

- The backend remains the authority for reward-bearing play: identity resolution, session validity, RNG, wager validation, outcome calculation, wallet state, ledger state, operator limit enforcement, and audit history.
- Persistence must protect player balances and operator budget exposure across crashes, deploys, retries, duplicate requests, and concurrent play.
- Accepted gameplay events are durable historical facts. Support and admin tools must be able to reconstruct what happened from stored records.
- Idempotency is a product safety feature, not only a technical optimization. Retrying a previously accepted spin must not change player balance or outcome.
- Tevi readiness means the database can support payment-like top-up idempotency later; it does not mean the product has accepted redeemable value or cash-out behavior.

## Functional Requirements

### DP-FR-1: Player And Provider Identity Persistence

- DP-FR-1.1 The API must persist an internal player record for each resolved player.
- DP-FR-1.2 The API must persist provider identity mappings from provider plus subject to internal player ID.
- DP-FR-1.3 Provider identity mapping creation must be idempotent so repeated session creation for the same provider subject returns the same player.
- DP-FR-1.4 Provider display names or profile metadata may be updated when present, but historical gameplay records must continue to reference the stable internal player ID.
- DP-FR-1.5 The persistence model must allow a future Tevi provider mapping without changing existing internal player IDs.

### DP-FR-2: Session Persistence

- DP-FR-2.1 Session creation must persist session ID, player ID, status, creation time, expiration time, and relevant request metadata.
- DP-FR-2.2 Session resume must read from persisted session records and return the existing active session when the requester maps to the same player.
- DP-FR-2.3 Expired sessions must remain discoverable for support and audit history while being rejected for gameplay.
- DP-FR-2.4 API restart or redeploy must not invalidate active unexpired sessions solely because process memory was lost.
- DP-FR-2.5 Session records must support admin/support search by player, session ID, status, and date range.

### DP-FR-3: Wallet Persistence

- DP-FR-3.1 Each player must have a durable wallet record for the current non-cash points balance.
- DP-FR-3.2 Wallet balances must be stored as integer minor units, not floating point values.
- DP-FR-3.3 Wallet transaction records must be append-only and include transaction ID, player ID, type, amount, balance before, balance after, actor, source, created time, correlation ID when available, and metadata.
- DP-FR-3.4 Wallet creation must be idempotent and safe under concurrent first use.
- DP-FR-3.5 Manual or admin adjustments, where allowed by existing admin controls, must persist as auditable wallet transactions.
- DP-FR-3.6 Wallet transaction history must remain searchable by player, transaction type, source, date range, and spin ID when applicable.

### DP-FR-4: Atomic Wallet Updates And Concurrency Safety

- DP-FR-4.1 Wallet mutations must execute inside database transactions.
- DP-FR-4.2 Concurrent wallet updates for the same player must not produce lost updates, negative balances, duplicate credits, or impossible balance-before/balance-after chains.
- DP-FR-4.3 The implementation must use PostgreSQL concurrency controls appropriate for wallet correctness, such as row-level locking or equivalent conditional atomic updates.
- DP-FR-4.4 Insufficient-balance failures must roll back the entire attempted operation and leave no accepted spin or wallet transaction records.
- DP-FR-4.5 Wallet update failures must return clear API errors and must be traceable by request ID or correlation ID.

### DP-FR-5: Spin Ledger Persistence

- DP-FR-5.1 Every accepted spin must persist a durable spin ledger record.
- DP-FR-5.2 The spin ledger record must include spin ID, session ID, player ID, client spin ID, config version ID, wager, reel stops, visible window, win breakdown, payout, free-spin state, jackpot award amount, balance after, accepted timestamp, request/correlation identifiers, and wallet transaction references.
- DP-FR-5.3 Spin ledger records must be immutable after acceptance except for narrowly defined operational metadata that does not change the player-visible outcome or financial accounting.
- DP-FR-5.4 Spin ledger records must support admin/support search by spin ID, player, session, client spin ID, config version, date range, payout range, and request/correlation ID.
- DP-FR-5.5 Accepted spin records must retain enough configuration and outcome data for support to explain the result even after later config activation or rollback.

### DP-FR-6: Atomic Spin Acceptance

- DP-FR-6.1 Spin acceptance must commit spin idempotency, spin ledger, wallet debit, wallet credit, balance update, and related transaction records in one atomic database transaction.
- DP-FR-6.2 If the spin ledger write fails, all wallet mutations for that spin must roll back.
- DP-FR-6.3 If any wallet mutation fails, no accepted spin record or idempotency success record may be created.
- DP-FR-6.4 The API must not return an accepted spin response until the database transaction has committed.
- DP-FR-6.5 Post-commit response delivery failure must be safe to retry through durable idempotency lookup.

### DP-FR-7: Spin Idempotency

- DP-FR-7.1 The API must enforce uniqueness for accepted spin attempts by `sessionId` plus `clientSpinId`.
- DP-FR-7.2 A retry with the same `sessionId`, same `clientSpinId`, and same wager fingerprint must return the original accepted spin result without applying additional wallet mutations.
- DP-FR-7.3 A retry with the same `sessionId` and `clientSpinId` but different wager fingerprint must return an idempotency conflict and must not mutate state.
- DP-FR-7.4 Idempotency records must survive process restarts and deployments.
- DP-FR-7.5 The idempotency retention window must be long enough to cover client retries, mobile reconnects, and support investigation for launch; the exact retention policy may be finalized during architecture.

### DP-FR-8: Configuration, Math Report, And Simulation Persistence

- DP-FR-8.1 Existing game configuration draft, activation, rollback, math report, and simulation concepts must be backed by PostgreSQL repositories rather than in-memory repositories.
- DP-FR-8.2 Activated configuration versions must be immutable for gameplay purposes.
- DP-FR-8.3 Every accepted spin must reference the active configuration version used at spin resolution.
- DP-FR-8.4 Rollback must affect only future spins and must not alter prior spin records.
- DP-FR-8.5 Math reports and simulation metadata must remain linked to the draft or configuration version they evaluated.
- DP-FR-8.6 Simulation persistence must not write to player wallets, live spin ledger, or live session state.

### DP-FR-9: Operator Limits And Budget Protection Persistence

- DP-FR-9.1 Operator limit versions must be durable and auditable.
- DP-FR-9.2 Spin validation must evaluate persisted active limits and budget protection actions.
- DP-FR-9.3 Limit changes, budget protection actions, reversions, and reasons must be recorded in persistent audit history.
- DP-FR-9.4 Budget and jackpot cap enforcement must remain safe under concurrent spins.
- DP-FR-9.5 Support and admin users must be able to reconstruct which limits were active when a spin was accepted or rejected.

### DP-FR-10: Metrics, Alerts, Audit, And Request Trace Persistence

- DP-FR-10.1 Metrics-related state needed for observed RTP, hit rate, spend, jackpot liability, active sessions, and budget status must be persisted or reproducibly derived from persisted source records.
- DP-FR-10.2 Alert rules, alert history, acknowledgments, and resolved states must survive API restarts.
- DP-FR-10.3 Admin audit events must be durable, searchable, and append-only for production operations.
- DP-FR-10.4 Request traces needed for incident investigation must be persisted with request ID, correlation ID where available, route/action context, status/outcome, timing, and relevant actor/session/player references.
- DP-FR-10.5 Production support search must continue to work from persisted records rather than process-local arrays.

### DP-FR-11: Future Tevi Top-Up Idempotency Records

- DP-FR-11.1 The database model must include future-ready durable records for Tevi top-up or webhook idempotency, even though Tevi implementation remains out of scope.
- DP-FR-11.2 Future top-up idempotency records must be able to store provider name, provider event ID or token, mapped player ID when known, status, amount in non-cash game units or policy-defined units, raw provider metadata, first seen time, last seen time, completion time, and failure reason.
- DP-FR-11.3 The persistence model must support duplicate webhook or SDK retry detection before wallet crediting.
- DP-FR-11.4 No Tevi record may imply cash-out, redemption, or real-money value until reward policy is explicitly clarified.

### DP-FR-12: Restart Recovery

- DP-FR-12.1 Restarting the API must not lose players, sessions, wallets, wallet transactions, accepted spins, configuration history, operator limits, alerts, audit events, budget protection actions, metrics history, request traces, or future top-up idempotency records.
- DP-FR-12.2 After restart, active configuration, active operator limits, active budget protection actions, and unexpired sessions must be loaded from persisted state.
- DP-FR-12.3 The API must recover safely from a restart that happens after database commit but before response delivery by returning the previously accepted result on retry.
- DP-FR-12.4 The API must recover safely from a restart before database commit by returning no accepted result and leaving no partial wallet or ledger mutation.

### DP-FR-13: Migration Requirements

- DP-FR-13.1 Database migrations must be repeatable in CI and production deployment.
- DP-FR-13.2 Migrations must create all tables, constraints, indexes, enums, and triggers required for production persistence.
- DP-FR-13.3 Migration execution must be part of the deployment path before the API version that depends on the migrated schema starts serving traffic.
- DP-FR-13.4 Migration rollback strategy must be documented for each migration where rollback is safe; destructive rollback of production ledgers must not be assumed.
- DP-FR-13.5 Existing partial migrations for game configurations, operator limits, metric buckets, alerts, and budget protection must be reconciled with the complete persistence model.

### DP-FR-14: Test Database Requirements

- DP-FR-14.1 Integration tests must run against an isolated PostgreSQL test database rather than in-memory substitutes for persistence behavior.
- DP-FR-14.2 Test setup must apply migrations from a clean database state.
- DP-FR-14.3 Test teardown must isolate data between test cases or test suites.
- DP-FR-14.4 CI must be able to run migration tests and API integration tests without depending on a developer's local database.
- DP-FR-14.5 Tests must cover idempotency, wallet concurrency, atomic rollback, restart recovery, migration repeatability, and admin/support search behavior.

### DP-FR-15: Production Environment Requirements

- DP-FR-15.1 Production API startup must require `DATABASE_URL` or an equivalent configured database connection secret.
- DP-FR-15.2 Production mode must not silently fall back to in-memory persistence for player, session, wallet, spin, config, limit, alert, audit, trace, or idempotency state.
- DP-FR-15.3 Development and test modes may retain in-memory implementations only where explicitly selected and clearly marked as non-production.
- DP-FR-15.4 Database connection failures in production must fail health checks and prevent unsafe reward-bearing play.
- DP-FR-15.5 Deployment documentation must explain how migrations are executed and how the API verifies schema readiness.

### DP-FR-16: Client Behavior Boundary

- DP-FR-16.1 Existing Phaser client presentation and spin animation behavior should remain unchanged.
- DP-FR-16.2 API responses may become clearer about resumed sessions, persisted balances, idempotency conflicts, expired sessions, or retry-safe accepted results.
- DP-FR-16.3 The client must not need to understand database implementation details.
- DP-FR-16.4 Any client-visible behavior change caused by persistence must be documented as an API contract change before implementation.

### DP-FR-17: Non-Cash Reward Boundary

- DP-FR-17.1 Persisted balances and transactions must continue to represent non-cash game points unless and until Tevi Stars/game-point policy is clarified.
- DP-FR-17.2 The persistence layer must not introduce cash-out, redemption, transferable value, or currency conversion behavior.
- DP-FR-17.3 Admin/support labels, transaction metadata, and documentation must avoid implying redeemable value.

## Non-Functional Requirements

- DP-NFR-1 Data Integrity: The database must enforce uniqueness, foreign keys, non-negative balances where applicable, valid status transitions, and immutable ledger/audit constraints where feasible.
- DP-NFR-2 Transaction Safety: Wallet and spin acceptance flows must use ACID transactions and appropriate isolation or locking for correctness.
- DP-NFR-3 Observability: Persistence errors, contention, migration status, and database health must be visible through logs, request traces, health checks, and operational metrics.
- DP-NFR-4 Performance: Persistence must support expected launch traffic without materially degrading spin response time; exact targets should be set during architecture based on hosting assumptions.
- DP-NFR-5 Supportability: Admin/support workflows must be able to search persisted records without requiring direct database access.
- DP-NFR-6 Security: Database credentials must be supplied through environment secrets and never committed. PII-like provider data must be minimized and protected.
- DP-NFR-7 Compatibility: Existing API contracts should remain stable unless changed intentionally for persistence safety.
- DP-NFR-8 Testability: Persistence behavior must be verified with integration tests against PostgreSQL, not only unit tests with mocks.

## Acceptance Criteria

- DP-AC-1 Restarting the API does not lose players, sessions, wallets, wallet transactions, accepted spins, game configurations, operator limits, alerts, budget protection actions, admin audit events, request traces, or metrics history required for launch operations.
- DP-AC-2 Duplicate spin retries with the same `sessionId` and `clientSpinId` return the original accepted result and do not double debit or double credit.
- DP-AC-3 Duplicate spin retries with changed wager data return an idempotency conflict and do not mutate state.
- DP-AC-4 Concurrent wallet updates for the same player cannot corrupt balances or produce inconsistent transaction history.
- DP-AC-5 Failed spin ledger writes roll back wallet mutations.
- DP-AC-6 Failed wallet mutations do not create accepted spin records or successful idempotency records.
- DP-AC-7 A crash or restart after database commit but before HTTP response delivery can be recovered by retrying the same spin request and receiving the committed result.
- DP-AC-8 A crash or restart before database commit leaves no partial accepted spin, wallet mutation, or success idempotency record.
- DP-AC-9 Migrations can be applied from a clean database in CI and during production deployment.
- DP-AC-10 Integration tests can run against an isolated PostgreSQL test database.
- DP-AC-11 Admin/support search continues to work from persisted player, session, transaction, spin, config, limit, alert, audit, and trace records.
- DP-AC-12 Active configuration, active operator limits, and active budget protection actions are loaded from persisted state after restart.
- DP-AC-13 Future Tevi top-up/webhook handling can be made idempotent using durable records before wallet crediting is implemented.
- DP-AC-14 Production deployment fails safe when `DATABASE_URL` or schema readiness is missing.
- DP-AC-15 Existing Phaser gameplay presentation remains unchanged except for intentional API error or retry semantics required by persistence.
- DP-AC-16 No persistence change introduces cash-out, redemption, transferable value, or real-money reward behavior.

## Architecture And Epic Handoff Notes

The architecture phase should translate these requirements into repository interfaces, PostgreSQL schema, transaction boundaries, migration tooling, deployment steps, and test strategy. The expected implementation epic can be split into stories roughly along these boundaries:

1. Database connection, migration runner, environment validation, and production startup safeguards.
2. PostgreSQL repositories for players, provider identity mappings, and sessions.
3. PostgreSQL wallet repository with atomic transactions and concurrency tests.
4. PostgreSQL spin ledger and durable spin idempotency with atomic spin acceptance.
5. PostgreSQL-backed game configuration, math report, and simulation repositories reconciled with existing migrations.
6. PostgreSQL-backed operator limits, metrics state, alerts, budget protection, admin audit, and request traces.
7. Future Tevi top-up idempotency table and repository contract without Tevi SDK/webhook behavior.
8. Integration test harness with isolated PostgreSQL database and migration application in CI.
9. Restart recovery, failure injection, and admin/support search verification.

Architecture should decide the exact schema, locking strategy, migration tool, database access library, and deployment mechanics. The PRD-level requirement is that production behavior is durable, atomic, retry-safe, searchable, and restart-safe.

## Open Questions

- What launch traffic assumptions should set database performance targets for spin latency, admin search, and metrics aggregation?
- What retention windows are required for request traces, sessions, alert history, admin audit events, and spin ledger records before Tevi policy review?
- Should free-spin state be fully ledger-derived, stored as durable session/player state, or both with reconciliation checks?
- Should observed metrics be persisted as aggregate buckets only, derived on demand from spin ledger, or both?
- What deployment platform will own migration execution before API startup in production?
