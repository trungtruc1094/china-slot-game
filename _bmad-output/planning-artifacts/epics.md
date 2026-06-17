---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/prd.md
  - _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/addendum.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/project-context.md
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
- Decide Prisma versus plain SQL migrations before database implementation stories begin.
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
