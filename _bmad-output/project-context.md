# Project Context: China Slot Game

## Product Direction

This repository is an existing browser-based Chinese-themed slot game intended to evolve into a community mini game. Product planning should treat the current code as a prototype and focus on controlled, transparent reward economics, user engagement, and a clean path toward server-authoritative gameplay.

Primary product goals:

- Keep players engaged with frequent small rewards and occasional larger events.
- Give the host predictable budget exposure through explicit RTP, prize caps, and operational limits.
- Separate frontend animation/presentation from backend outcome authority.
- Track feature development through BMAD PRD, architecture, epics, stories, sprint status, and reviews.

## Current System

Current frontend:

- Static `index.html` loads Phaser and scripts from `js/`.
- `js/slotConfig3x5.js` contains slot configuration, reel strips, paytable, scatter rules, jackpot settings, controls, and assets.
- `js/slotGame.js` creates the Phaser scene, preloads assets, initializes controllers, runs spins, and applies outcomes.
- `js/slot_classes.js` contains reel mechanics, 243-ways line generation, win detection, player balance, slot controls, jackpot state, and UI helpers.
- `js/state_machine.js` controls pre-spin, spin, auto-spin, free-spin, win, and lose states.

Current backend examples:

- `server_examples/server.js` is an Express sketch for sessions, server RNG, spin API, balance, history, health, and RTP.
- `server_examples/database_schema.sql` sketches players, sessions, spins, balance transactions, game config, RTP tracking, and reporting views.
- These server examples are not yet canonical and do not fully match the client-side 243-ways math.

## Key Technical Constraints

- Do not trust client-side RNG for production or reward-bearing deployment.
- Server must become the source of truth for RNG, bet validation, outcome calculation, balance updates, and audit records.
- Client should receive server-approved reel stops/outcomes and only animate/display them.
- RTP, hit rate, free-spin frequency, and jackpot EV should be computed from configuration before release.
- Use deterministic tests or simulation scripts for probability math before changing game economics.
- Treat any real-money, cash-equivalent, crypto, or redeemable reward deployment as requiring legal/compliance review.

## Product Planning Priorities

Recommended BMAD planning themes:

- Product model: community mini game, reward economy, wallet/balance model, prize redemption, budget controls.
- Game math: target RTP, hit rate, volatility, free-spin cadence, jackpot cadence, caps, monitoring.
- FE/BE split: frontend animation shell, backend spin engine, API contract, state sync, failure handling.
- Trust and audit: server RNG, seeded/provably fair options if needed, spin ledger, admin reporting.
- Operations: host budget, daily limits, abuse prevention, monitoring, rollback, support tooling.
- Compliance: jurisdiction review, terms, disclosures, no-purchase/free-entry alternatives if sweepstakes-like.

## Known Issues To Address

- Current RTP estimate is roughly 30.8 percent under current 243-ways math, which is likely too low for engagement.
- `LineBehavior.findWin()` compares `Pay` and `FreeSpins`, but `WinData` fields are lowercase `pay` and `freeSpins`; this can make paytable ordering affect wins.
- `Scroll` appears in the paytable but is not present on reel strips.
- `10` appears in symbol metadata but is not meaningfully part of the active paytable.
- Current server example uses simplified paylines and does not match the frontend math.

## Preferred Implementation Approach

- First create a PRD for the community mini game and reward economy.
- Then create architecture for server-authoritative gameplay and FE/BE boundaries.
- Then create epics and stories for phases: math calculator, spin engine API, persistence, frontend integration, admin/RTP dashboard, abuse controls, launch readiness.
- Keep current static game playable while introducing backend behavior behind a clear integration seam.
- Prefer small, testable changes over broad rewrites.
