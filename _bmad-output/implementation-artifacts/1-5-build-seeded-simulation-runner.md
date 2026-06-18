---
baseline_commit: 8fa3d429d7106d0f486b9e1f815303e3a4ecf1e2
---

# Story 1.5: Build Seeded Simulation Runner

Status: done

<!-- Ultimate context engine analysis completed - comprehensive developer guide created -->

## Story

As a host,
I want repeatable simulation runs,
so that I can compare observed behavior against theoretical game math.

## Acceptance Criteria

1. Given a Game Configuration, spin count, and optional seed, when the simulator runs, then it returns observed RTP, hit rate, volatility summary, largest win, total wagered, total paid, scatter count, jackpot count, and confidence notes.
2. Simulation with the same seed and inputs produces the same aggregate output.
3. Simulation does not require database access or mutate player balances.
4. Tests verify repeatability and basic convergence behavior on fixture configs.

## Tasks / Subtasks

- [x] Define serializable simulation types (AC: 1, 2, 3)
  - [x] Extend `packages/game-math/src/config-types.ts` with `SimulationInput`, `SimulationResult`, volatility summary, and confidence note types.
  - [x] Export new public types from `packages/game-math/src/index.ts`.
  - [x] Keep all result fields JSON-serializable and free of functions, classes, `Map`, `Set`, `NaN`, or `Infinity`.
- [x] Implement deterministic RNG and reel-stop sampling (AC: 2, 3)
  - [x] Add `packages/game-math/src/simulator.ts`.
  - [x] Use a small deterministic package-local PRNG seeded from a string; do not add dependencies.
  - [x] Sample one valid stop index per configured reel for each spin.
  - [x] Build windows with `buildVisibleWindow(config, reelStops)`; do not duplicate wraparound logic.
  - [x] Evaluate wins with `calculateWins(config, visibleWindow)`; do not duplicate ways, wild, scatter, or jackpot logic.
- [x] Aggregate observed simulation metrics (AC: 1)
  - [x] Validate spin count and wager inputs as positive safe integers.
  - [x] Return observed RTP, hit rate, largest win, total wagered, total paid, scatter count, jackpot count, and spin count.
  - [x] Add a volatility summary with mean payout, variance, standard deviation, and simple payout bands.
  - [x] Add confidence notes that describe low sample size and observed-vs-theoretical RTP delta when theoretical report input is available.
  - [x] Apply `payoutPolicy.useLineBetMultiplier` consistently with Story 1.4's RTP report aggregation.
- [x] Add deterministic simulation tests (AC: 1, 2, 3, 4)
  - [x] Add `packages/game-math/test/simulator.test.ts`.
  - [x] Verify same seed + same inputs produce identical aggregate output.
  - [x] Verify different seeds can produce different sampled aggregates on a non-trivial fixture.
  - [x] Verify no database, Express, browser, Phaser, or `server_examples` dependency is introduced.
  - [x] Verify output survives JSON round-trip.
- [x] Add convergence and edge-case tests (AC: 4)
  - [x] Use a compact fixture with known theoretical RTP from `calculateRtpReport`.
  - [x] Verify a sufficiently large seeded run lands within a documented tolerance of theoretical RTP.
  - [x] Cover invalid spin count, invalid wager, empty reels, and disabled scatter/jackpot behavior.
- [x] Preserve package quality gates (AC: 1-4)
  - [x] `npm run build`
  - [x] `npm run typecheck`
  - [x] `npm test`

### Review Findings

- [x] [Review][Patch] Aggregate simulation test did not assert exact fixture metrics [packages/game-math/test/simulator.test.ts] — fixed by asserting exact seeded totals, hit rate, scatter/jackpot counts, volatility buckets, and confidence notes.

## Dev Notes

### Business and Epic Context

- Epic 1 makes slot math deterministic, testable, and faithful to current 243-ways behavior before reward-bearing backend logic goes live. [Source: `_bmad-output/planning-artifacts/epics.md`]
- Story 1.5 completes the math foundation by adding repeatable sampling to compare observed behavior against the theoretical report from Story 1.4. [Source: `_bmad-output/planning-artifacts/epics.md`]
- Simulation supports future draft configuration workflows but must remain package-level and side-effect free in this story. [Source: `_bmad-output/planning-artifacts/architecture.md`]

### Current Package State

Extend the current `packages/game-math` package; do not replace it.

Existing files to update:

- `packages/game-math/src/config-types.ts`
- `packages/game-math/src/index.ts`

Expected new files:

- `packages/game-math/src/simulator.ts`
- `packages/game-math/test/simulator.test.ts`

Existing primitives to reuse:

- `buildVisibleWindow(config, reelStops)` creates validated visible windows with wraparound behavior.
- `calculateWins(config, visibleWindow)` returns canonical way, scatter, jackpot, total pay, and total free-spin output.
- `calculateRtpReport(config, options)` provides theoretical RTP for convergence comparisons in tests and confidence notes.

### Architecture Guardrails

- Domain math lives in `packages/game-math`; route handlers, future backend services, Phaser client files, and `server_examples` must consume this package rather than duplicating math logic. [Source: `_bmad-output/planning-artifacts/architecture.md`]
- The game math package must not import Express, database clients, browser APIs, Phaser, UI code, or `server_examples`. [Source: `_bmad-output/planning-artifacts/architecture.md`]
- Simulation runs must not mutate player balances or spin ledgers. [Source: `_bmad-output/planning-artifacts/architecture.md`]
- Keep all wager and payout totals as integer units. Frequency/RTP/volatility values may be decimal ratios but must be finite numbers.
- Do not implement persistence, job queues, admin APIs, or database writes in this story.

### Algorithm Guidance

Use deterministic seeded sampling:

- Accept `{ config, spinCount, seed?, wager? }` or an equivalent public function signature.
- Default seed should be stable and included in the result if omitted.
- Convert the seed string into numeric PRNG state with a deterministic hash.
- For each spin, sample a stop index in `[0, reel.symbols.length)` for every reel.
- Build the visible window with `buildVisibleWindow`.
- Calculate wins with `calculateWins`.
- Resolve payout with the same `payoutPolicy.useLineBetMultiplier` behavior used by `calculateRtpReport`.
- Track payout per spin so volatility metrics can be calculated.

Suggested volatility summary:

- `meanPayout`
- `variance`
- `standardDeviation`
- `zeroPayCount`
- `smallWinCount`
- `mediumWinCount`
- `largeWinCount`

Suggested confidence notes:

- Add a low-sample note below 1,000 spins.
- If theoretical RTP is provided or calculated, include observed-vs-theoretical RTP delta.
- Keep notes machine-readable enough for storage, for example `{ code, severity, message }`.

### Testing Requirements

Minimum test cases:

- Repeatability: same seed, spin count, wager, and config returns the exact same result.
- Seed variation: different seeds produce different aggregate output on a fixture with varied stops.
- Aggregate metrics: exact small fixture assertions for spin count, total wagered, total paid, hit rate, largest win, scatter count, jackpot count, and volatility fields.
- Convergence: larger seeded run on a compact fixture is within tolerance of `calculateRtpReport` theoretical RTP.
- Serialization: result survives JSON round-trip.
- Validation: invalid spin count, invalid wager, and empty reel config throw clear errors.
- Regression: existing `game-math.test.ts`, `ways.test.ts`, `win-calculator.test.ts`, and `rtp-calculator.test.ts` continue to pass.

Run and record:

- `npm run build`
- `npm run typecheck`
- `npm test`

### Previous Story Intelligence

Story 1.4 is done and added:

- `calculateRtpReport` in `packages/game-math/src/rtp-calculator.ts`.
- Serializable RTP report types in `config-types.ts`.
- Configuration diagnostics for missing metadata, unused metadata, scatter/jackpot consistency, unreachable paytable entries, 243-ways shape checks, and optional server-example mismatch risk.
- A code-review fix ensuring RTP report aggregation applies `lineBet` when `payoutPolicy.useLineBetMultiplier` is true.

Preserve these learnings:

- Use package primitives rather than duplicating visible-window, ways, and win logic.
- Apply line-bet payout multiplication consistently.
- Keep current-config full exhaustive reporting out of routine tests when it is too expensive; use compact fixtures for exact/convergence tests.
- Keep package source dependency-free and isolated from browser, backend, database, Phaser, and `server_examples`.

### Project Structure Notes

Do update:

- `packages/game-math/src/config-types.ts`
- `packages/game-math/src/index.ts`

Do add:

- `packages/game-math/src/simulator.ts`
- `packages/game-math/test/simulator.test.ts`

Do not update:

- `js/slot_classes.js`
- `js/slotConfig3x5.js`
- `server_examples/*`
- `apps/api`
- `apps/admin`
- database migrations
- `packages/game-math/dist/*`

### References

- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/project-context.md`
- `_bmad-output/implementation-artifacts/1-4-build-rtp-calculator-and-config-diagnostics.md`
- `packages/game-math/src/config-types.ts`
- `packages/game-math/src/ways.ts`
- `packages/game-math/src/win-calculator.ts`
- `packages/game-math/src/rtp-calculator.ts`
- `packages/game-math/test/rtp-calculator.test.ts`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm test`
- `npm run typecheck`
- `npm run build`

### Completion Notes List

- Added a pure seeded simulation runner with deterministic string-seeded PRNG and reel-stop sampling.
- Added serializable simulation result, volatility, and confidence note types.
- Aggregated observed RTP, hit rate, wager/pay totals, largest win, scatter count, jackpot count, payout volatility bands, and optional theoretical RTP delta notes.
- Added simulator tests for repeatability, seed variation, aggregation, convergence, disabled special rules, serialization, and invalid input handling.
- Resolved code review finding by tightening the aggregate fixture test to exact deterministic output.

### File List

- `_bmad-output/implementation-artifacts/1-5-build-seeded-simulation-runner.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `packages/game-math/src/config-types.ts`
- `packages/game-math/src/index.ts`
- `packages/game-math/src/simulator.ts`
- `packages/game-math/test/simulator.test.ts`
