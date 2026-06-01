---
title: China Slot Game Backend Separation and Operator Controls
status: draft
created: 2026-06-01
updated: 2026-06-01
---

# PRD: China Slot Game Backend Separation and Operator Controls

## 0. Document Purpose

This PRD defines the product requirements for evolving the current browser-only China Slot Game prototype into a community mini game with server-authoritative gameplay and configurable operating metrics. It is written for the product owner, engineering, and downstream BMAD architecture, epics, stories, and sprint planning workflows. Technical implementation details and source-code observations are captured in `addendum.md`; this PRD focuses on product behavior, requirements, constraints, and launch readiness.

## 1. Vision

China Slot Game should become a lightweight community reward experience where players get a fast, polished slot-game session and the host can manage reward exposure with clear operating controls. The game should keep the existing visual/animation experience, but reward-bearing decisions must move out of the browser.

The core product shift is from a client-side prototype to a server-authoritative mini game. The backend determines the spin result, validates the wager, updates balance, records audit data, and reports operational metrics. The client displays balance, controls, reels, win states, and animations based on backend-approved results.

The host needs predictable economics. The product should support pre-release math validation, versioned game configurations, live monitoring, and budget controls. It should not depend on silent manipulation of individual outcomes. [ASSUMPTION: The host wants a community reward game rather than a regulated casino product.]

## 2. Target User

### 2.1 Jobs To Be Done

- As a player, I want a quick slot session that feels responsive, fair, and rewarding.
- As a player, I want my balance, wins, free spins, and jackpot events to be clear and trustworthy.
- As the host, I want to configure game economics so rewards are engaging without exceeding my budget.
- As the host, I want to monitor RTP, total wagered, total paid, jackpot exposure, active sessions, and suspicious activity.
- As the operator, I want every reward-bearing action logged so disputes and bugs can be investigated.
- As the developer, I want a clean FE/BE contract so the game can evolve without duplicating math across the client and server.

### 2.2 Non-Users (v1)

- Real-money casino operators are not the v1 target without separate legal, licensing, compliance, and payment requirements.
- Third-party game studios embedding a generic slot engine are not the v1 target.
- Players expecting cash-out, crypto payout, or legally redeemable prizes are not supported until compliance review approves that model.

### 2.3 Key User Journeys

- **UJ-1. Lina plays a community reward spin.** Lina opens the mini game from the community channel, sees her current balance, picks an allowed bet, and taps spin. The backend validates the session and bet, returns reel stops and the outcome, and the client animates to that result. Lina sees a small win, her new balance, and a clear win breakdown.

- **UJ-2. Donnie tunes launch economics before opening the game.** Donnie edits a draft game configuration with target RTP, hit rate, max bet, free-spin cadence, jackpot cap, and daily operator budget. The system simulates the configuration, shows expected payout behavior, warns about risky settings, and only allows activation after the configuration passes validation.

- **UJ-3. Donnie monitors the game during a campaign.** Donnie opens an admin view and sees total wagered, total paid, observed RTP, active players, jackpot liability, remaining campaign budget, and alert status. When the campaign approaches the budget threshold, the system applies configured limits and surfaces the reason.

- **UJ-4. Support investigates a disputed win.** A player reports that their displayed win was wrong. Support searches the spin ledger by player/session/spin ID, sees the exact config version, wager, RNG metadata, reel stops, win calculation, balance before/after, and client acknowledgment state.

## 3. Glossary

- **Backend Authority** - The backend services responsible for RNG, bet validation, outcome calculation, balance updates, and audit records.
- **Client** - The browser-based Phaser game responsible for input, display, animation, sound, and non-authoritative UI state.
- **Game Configuration** - A versioned set of reel strips, paytable, scatter rules, jackpot rules, bet limits, prize caps, and operating limits.
- **RTP** - Return to player, calculated as total payouts divided by total wagers for a defined configuration or observation window.
- **Hit Rate** - Percentage of spins returning any positive payout.
- **Volatility** - Distribution shape of payouts, especially the balance between frequent small wins and rare large wins.
- **Spin Engine** - Backend component that accepts a valid wager, generates or receives RNG, resolves the outcome, and returns display-ready result data.
- **Spin Ledger** - Append-only record of each spin, including player, session, configuration version, wager, result, payouts, balance changes, and timestamps.
- **Operator Budget** - Host-defined limit for total reward exposure over a campaign or time window.
- **Prize Cap** - Maximum allowed payout for a spin, player, day, campaign, jackpot, or other configured scope.
- **Configuration Version** - Immutable identifier assigned to an activated Game Configuration.

## 4. Features

### 4.1 Server-Authoritative Spin Flow

**Description:** Reward-bearing play must use the backend as the source of truth. The client requests a spin, the backend validates it, calculates the result, persists the ledger entry, and returns the exact reel stops and win data for animation. Realizes UJ-1 and UJ-4.

**Functional Requirements:**

#### FR-1: Start authenticated game session

Players can start or resume a game session through the backend before placing reward-bearing spins.

**Consequences (testable):**
- The backend returns a session identifier and current balance for valid users.
- The client cannot place a reward-bearing spin without a valid session.
- Expired or invalid sessions produce a recoverable client error state.

#### FR-2: Validate spin request

The backend validates bet amount, line/ways policy, balance, session status, game status, and active configuration before accepting a spin.

**Consequences (testable):**
- Invalid bets are rejected without mutating balance.
- Insufficient balance is rejected without mutating balance.
- Accepted spins store the active Configuration Version.

#### FR-3: Resolve authoritative spin result

The backend resolves reel stops, line/ways wins, scatter wins, free-spin awards, jackpot wins, and total payout from the active Game Configuration.

**Consequences (testable):**
- Backend result data contains reel stops, visible symbols, win breakdown, total wager, total payout, and balance after spin.
- The client can animate the returned stops without running authoritative RNG.
- The same input configuration and controlled RNG seed produce deterministic test results.

#### FR-4: Preserve current visual game loop

The client keeps the existing Phaser reel animation, controls, popups, and state transitions while replacing local outcome authority with backend-approved outcomes.

**Consequences (testable):**
- Existing static demo mode remains available for local visual development. [ASSUMPTION: The team wants to preserve a non-reward local mode.]
- Production mode never updates balance from client-only math.
- Network failure during spin produces a clear pending, retry, or recovery state.

### 4.2 Game Math and Configuration Management

**Description:** The host can tune economics through versioned game configurations. Configuration changes must be validated through math calculation and simulation before activation. Realizes UJ-2.

**Functional Requirements:**

#### FR-5: Define editable game configuration

The host can create draft Game Configurations containing reel strips, paytable, scatter rules, jackpot rules, bet limits, free-spin rules, prize caps, and budget limits.

**Consequences (testable):**
- Draft configurations do not affect live spins until activated.
- Each activated configuration becomes immutable.
- Every spin references exactly one Configuration Version.

#### FR-6: Calculate theoretical metrics

The system calculates theoretical RTP, hit rate, free-spin trigger frequency, jackpot trigger frequency, maximum payout exposure, and payout distribution for a draft configuration.

**Consequences (testable):**
- Configurations cannot be activated without a completed math report.
- Math reports are stored with the configuration version.
- The report flags missing symbols, unreachable paytable entries, and inconsistent jackpot/scatter settings.

#### FR-7: Simulate configuration behavior

The host can run simulation batches against a draft Game Configuration before activation.

**Consequences (testable):**
- Simulation output includes observed RTP, hit rate, volatility summary, largest win, total wagered, total paid, and confidence notes.
- Simulation can be repeated with a recorded seed.
- Simulation results do not mutate player balances or live ledgers.

#### FR-8: Activate and rollback configuration

The host can activate a validated Game Configuration and roll back to a prior active version when needed.

**Consequences (testable):**
- Activation is logged with actor, timestamp, reason, and math report reference.
- Rollback creates an audit event and changes only future spins.
- Historical spins continue to point to the configuration used at spin time.

### 4.3 Wallet, Balance, and Reward Ledger

**Description:** Player balances and reward records must be backend-owned. The client displays balances returned by the backend but never independently mutates the authoritative value. Realizes UJ-1 and UJ-4.

**Functional Requirements:**

#### FR-9: Store authoritative player balance

The backend stores player balance and applies all debits, credits, free-spin awards, jackpot awards, and adjustments.

**Consequences (testable):**
- Every balance change has a transaction record.
- Balance before and after are stored for every accepted spin.
- Client refresh returns backend balance even if local UI state is stale.

#### FR-10: Record complete spin ledger

The backend records every accepted spin in an append-only Spin Ledger.

**Consequences (testable):**
- Each ledger entry includes player ID, session ID, wager, result, win breakdown, balance before/after, Configuration Version, and timestamps.
- Failed validation attempts are logged separately for abuse and support analysis.
- Ledger records can be exported for audit or analysis.

#### FR-11: Support non-cash reward accounting

The product supports an internal balance or point model for community rewards. [ASSUMPTION: v1 rewards are points, credits, or community perks rather than cash-equivalent balances.]

**Consequences (testable):**
- Balance labels and admin reports distinguish internal credits from redeemable monetary value.
- Terms and admin configuration can disable redemption-related copy.
- Any cash-equivalent redemption remains blocked until compliance approval.

### 4.4 Operator Metrics and Controls

**Description:** The host needs operational controls that keep the game engaging while bounding financial exposure. Controls must be explicit, visible, auditable, and applied through configuration or budget rules. Realizes UJ-2 and UJ-3.

**Functional Requirements:**

#### FR-12: Configure operator limits

The host can configure max bet, min bet, per-player daily reward cap, per-player daily wager cap, campaign budget, jackpot cap, max single-spin payout, and session limits.

**Consequences (testable):**
- Limit changes are versioned and audited.
- The backend enforces limits before accepting a spin.
- The client displays disabled states or clear errors when a limit blocks play.

#### FR-13: Monitor live operating metrics

The host can view total wagered, total paid, observed RTP, theoretical RTP, hit rate, player count, active sessions, jackpot liability, remaining budget, and alert state.

**Consequences (testable):**
- Metrics can be filtered by configuration version and time window.
- Observed RTP is clearly distinguished from theoretical RTP.
- Dashboard values reconcile against the Spin Ledger.

#### FR-14: Trigger operating alerts

The system alerts the host when configured thresholds are crossed, including high observed RTP, low observed RTP, budget exhaustion, suspicious activity, backend error rate, or jackpot liability.

**Consequences (testable):**
- Alert thresholds are configurable.
- Alerts include metric value, threshold, time window, and suggested operator action.
- Alert history is retained.

#### FR-15: Enforce budget protection

The backend enforces campaign and operator budget limits using predefined rules.

**Consequences (testable):**
- When remaining budget is below the configured threshold, the system follows the configured action: disable paid spins, lower max bet for future spins, pause campaign, or require host approval. [ASSUMPTION: Lowering max bet for future spins is acceptable if displayed and logged.]
- Budget enforcement never alters the outcome of an already accepted spin.
- Players receive clear client messaging when play is paused or limited.

### 4.5 Admin and Support Workflows

**Description:** Admin and support workflows allow trusted operators to manage configuration, inspect game health, and resolve player issues. Realizes UJ-3 and UJ-4.

**Functional Requirements:**

#### FR-16: Provide admin access controls

Admin features require authenticated operator access with role-based permissions.

**Consequences (testable):**
- Only authorized admins can create, approve, activate, or roll back Game Configurations.
- Support users can inspect ledgers without editing live economics unless granted permission.
- Admin actions are logged.

#### FR-17: Search spin and balance history

Support users can search by player, session, spin ID, date range, configuration version, or transaction type.

**Consequences (testable):**
- Search results show enough detail to explain a payout.
- Sensitive player information is minimized in support views.
- Export access can be restricted by role.

#### FR-18: Maintain operational audit trail

The system records admin actions, configuration changes, budget-limit changes, manual adjustments, failed spin validations, and alert acknowledgments.

**Consequences (testable):**
- Audit records include actor, timestamp, before/after values, and reason where applicable.
- Audit records cannot be edited through normal admin UI.
- Audit data is retained according to the configured retention policy.

## 5. Cross-Cutting Non-Functional Requirements

- **Security:** The backend must treat all client data as untrusted. Session tokens, admin permissions, bet values, and balance changes require server validation.
- **Integrity:** Reward-bearing spins must be idempotent or safely recoverable so network retries do not duplicate payouts.
- **Observability:** Spin volume, errors, latency, RTP windows, budget use, and alert state must be measurable.
- **Performance:** Spin response should be fast enough to preserve game feel; target p95 backend spin resolution under 300 ms excluding animation. [ASSUMPTION: This is acceptable for v1 community deployment.]
- **Availability:** If the backend is unavailable, reward-bearing play should stop safely while local visual demo mode may remain available.
- **Data retention:** Spin Ledger, balance transactions, configuration history, and admin audit logs must have explicit retention settings before launch.
- **Accessibility:** Critical client states such as balance, bet, win amount, errors, and disabled play must be readable without relying only on animation or sound.

## 6. Compliance and Guardrails

- The product must not present real-money, cash-equivalent, crypto, or redeemable rewards until legal review defines allowed jurisdictions, terms, age restrictions, disclosures, tax handling, and any no-purchase/free-entry requirements.
- The system must not silently manipulate outcomes per player, session, or budget pressure. Profitability control must happen through published or internally approved configuration, bet limits, prize caps, budget controls, and campaign pause rules.
- Any adaptive game configuration must apply only to future spins, require an audit entry, and be visible in operational history.
- Player-facing copy must avoid claiming guaranteed fairness unless RNG, configuration, and audit processes support that claim.
- Admin controls must distinguish theoretical game math from live observed performance, because short-term observed RTP can vary naturally.

## 7. Non-Goals (Explicit)

- The MVP will not implement cash-out, crypto rewards, gambling payments, or external prize redemption.
- The MVP will not support per-player odds manipulation or hidden individual outcome control.
- The MVP will not become a generic multi-game casino platform.
- The MVP will not support third-party admin tenants.
- The MVP will not require replacing the existing Phaser client before backend integration begins.

## 8. MVP Scope

### 8.1 In Scope

- Server-authoritative spin endpoint.
- Backend wallet/balance ownership.
- Shared or backend-owned slot math implementation.
- Versioned Game Configuration.
- Theoretical RTP/probability calculator.
- Simulation runner for draft configurations.
- Spin Ledger and balance transaction records.
- Frontend integration that animates backend-approved outcomes.
- Operator controls for bet limits, prize caps, jackpot cap, campaign budget, and play pause.
- Basic admin reporting for RTP, wagers, payouts, budget, jackpot liability, and alerts.
- Support lookup for spin and balance history.

### 8.2 Out of Scope for MVP

- Real-money deposits, withdrawals, or prize redemption.
- Multi-currency wallet.
- Multi-game framework.
- Advanced player segmentation.
- Native mobile apps.
- Public provably-fair verification UI. [NOTE FOR PM: This may become important if community trust becomes a launch blocker.]
- Automated marketing campaigns or CRM integrations.

## 9. Success Metrics

**Primary**

- **SM-1:** Reward-bearing spins are backend-authoritative: 100 percent of production spins have a Spin Ledger record with Configuration Version, wager, result, payout, and balance before/after. Validates FR-1 through FR-4 and FR-10.
- **SM-2:** Configuration readiness: 100 percent of activated Game Configurations have theoretical math reports and simulation results. Validates FR-5 through FR-8.
- **SM-3:** Budget protection: campaign spend never exceeds configured operator budget by more than one accepted spin's maximum possible payout. Validates FR-12 and FR-15.
- **SM-4:** Operational visibility: host can see observed RTP, theoretical RTP, total wagered, total paid, jackpot liability, and remaining budget for the active campaign. Validates FR-13 and FR-14.

**Secondary**

- **SM-5:** Spin reliability: fewer than 1 percent of accepted spins require manual support investigation because of client/backend state mismatch. Validates FR-3, FR-4, FR-9, and FR-10.
- **SM-6:** Config quality: draft configurations with unreachable symbols or inconsistent paytable entries are blocked before activation. Validates FR-6.
- **SM-7:** Player experience: median spin request plus animation start delay remains below the threshold that feels broken to players. [ASSUMPTION: target threshold to be confirmed during UX/architecture.]

**Counter-metrics**

- **SM-C1:** Do not optimize short-term profit by silently lowering player odds. This would violate the trust and audit goals.
- **SM-C2:** Do not optimize hit rate so aggressively that payouts become economically unsustainable.
- **SM-C3:** Do not optimize for low support volume by hiding ledger detail from admins.

## 10. Open Questions

1. What exact reward model is intended for v1: points only, community perks, gift cards, cash-equivalent prizes, or another model?
2. What target RTP range should the first production configuration use?
3. What target hit rate and volatility profile should the host prefer: frequent small wins, balanced, or rare larger wins?
4. What is the initial operator budget for the first campaign?
5. What are acceptable per-player daily and campaign-level reward caps?
6. Should free spins use separate math, the same math, or a capped bonus table?
7. Should the jackpot be fixed, progressive, capped progressive, or disabled for MVP?
8. What admin roles are needed for v1?
9. What player identity source will the game use in the community: anonymous session, Discord/Telegram identity, email login, or existing account system?
10. Which jurisdictions and compliance constraints apply before any redeemable reward launch?

## 11. Assumptions Index

- §1 Vision: The host wants a community reward game rather than a regulated casino product.
- §4.1 FR-4: The team wants to preserve a non-reward local mode.
- §4.3 FR-11: v1 rewards are points, credits, or community perks rather than cash-equivalent balances.
- §4.4 FR-15: Lowering max bet for future spins is acceptable if displayed and logged.
- §5 Cross-Cutting NFRs: p95 backend spin resolution under 300 ms excluding animation is acceptable for v1 community deployment.
- §9 Success Metrics: Player experience delay threshold should be confirmed during UX/architecture.
