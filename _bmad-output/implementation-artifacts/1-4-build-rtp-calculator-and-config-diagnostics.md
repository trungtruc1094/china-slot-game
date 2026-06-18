---
baseline_commit: 798b7b32357d9fe1065f7b0404325bb667093d27
---

# Story 1.4: Build RTP Calculator and Config Diagnostics

Status: done

<!-- Ultimate context engine analysis completed - comprehensive developer guide created -->

## Story

As a host,
I want theoretical RTP and configuration diagnostics,
so that I can tune game economics before launch.

## Acceptance Criteria

1. Given a draft Game Configuration, when the RTP calculator runs, then it reports theoretical RTP, hit rate, free-spin trigger frequency, jackpot trigger frequency, max payout exposure, and payout distribution summary.
2. It flags missing reel symbols, unreachable paytable entries, inconsistent scatter/jackpot settings, and unused symbol metadata.
3. The current active config issues are detected in tests: `Scroll`, `10`, 243-ways behavior, and server-example mismatch risk.
4. Output is serializable for storage in a math report.

## Tasks / Subtasks

- [x] Define serializable RTP report and diagnostic types (AC: 1, 2, 4)
  - [x] Extend `packages/game-math/src/config-types.ts` with report types for RTP, hit rate, free-spin trigger frequency, jackpot trigger frequency, max payout exposure, payout distribution summary, and diagnostics.
  - [x] Reuse existing `MathDiagnostic` and extend `MathDiagnosticCode` only where needed.
  - [x] Export the new public types from `packages/game-math/src/index.ts`.
- [x] Implement exhaustive theoretical RTP calculation (AC: 1, 4)
  - [x] Add `packages/game-math/src/rtp-calculator.ts`.
  - [x] Enumerate every reel-stop combination from the configured reel strips.
  - [x] Build each visible window with `buildVisibleWindow(config, reelStops)`; do not duplicate wraparound window logic.
  - [x] Evaluate each window with `calculateWins(config, visibleWindow)`; do not duplicate payout, scatter, jackpot, or wild logic.
  - [x] Return total outcomes, theoretical RTP, hit rate, free-spin trigger frequency, jackpot trigger frequency, max payout exposure, and payout distribution buckets.
  - [x] Keep output plain JSON-serializable data with finite numbers and arrays/objects only.
- [x] Implement configuration diagnostics (AC: 2, 3)
  - [x] Add a public helper such as `findConfigurationDiagnostics(config, options?)`.
  - [x] Include existing unreachable paytable diagnostics from `findWinCalculationDiagnostics(config)`.
  - [x] Flag symbols referenced by reel strips, paytable, wild, scatter, or jackpot rules that are missing from `config.symbols`.
  - [x] Flag symbol metadata entries that are not used by reel strips or configured rules; current config must report `10`.
  - [x] Flag inconsistent scatter settings such as enabled scatter with no pays or a scatter symbol unavailable in visible reels.
  - [x] Flag inconsistent jackpot settings such as enabled jackpot with unavailable symbol, non-positive required count, or invalid default amount.
  - [x] Include a `SERVER_EXAMPLE_MISMATCH` diagnostic when requested by options for current repo compatibility reporting; do not import from `server_examples`.
- [x] Add current-client report coverage (AC: 1, 2, 3, 4)
  - [x] Add `packages/game-math/test/rtp-calculator.test.ts`.
  - [x] Prove the current config enumerates all 5-reel stop combinations and preserves 243-ways behavior per visible window.
  - [x] Assert diagnostics include unreachable `Scroll` paytable entries, unused `10` metadata, and server-example mismatch risk.
  - [x] Assert the report can be `JSON.stringify`/`JSON.parse` round-tripped.
- [x] Add small fixture tests with exact expected math (AC: 1, 4)
  - [x] Use compact deterministic configs so exact RTP, hit rate, free-spin frequency, jackpot frequency, max payout exposure, and distribution can be asserted.
  - [x] Cover a no-win distribution bucket, a paid-win bucket, a free-spin trigger, and a jackpot trigger.
  - [x] Cover validation failures for malformed wager or impossible config values where the calculator cannot produce a meaningful report.
- [x] Preserve package quality gates (AC: 1-4)
  - [x] `npm run build`
  - [x] `npm run typecheck`
  - [x] `npm test`

### Review Findings

- [x] [Review][Patch] RTP report aggregation ignored configured line-bet multiplication [packages/game-math/src/rtp-calculator.ts] — fixed by applying `payoutPolicy.useLineBetMultiplier` before accumulating `totalPaid`, `maxPayoutExposure`, hit detection, and payout distribution.

## Dev Notes

### Business and Epic Context

- Epic 1 makes slot math deterministic, testable, and faithful to current 243-ways behavior before reward-bearing backend logic goes live. [Source: `_bmad-output/planning-artifacts/epics.md`]
- Story 1.4 is the host-facing math report foundation for later draft configuration validation and admin reporting. It supports FR6, NFR3, NFR9, and NFR12. [Source: `_bmad-output/planning-artifacts/epics.md`]
- The report must separate theoretical game math from later live observed performance; admin controls must distinguish these concepts. [Source: `_bmad-output/planning-artifacts/architecture.md`]

### Current Package State

Extend the current `packages/game-math` package; do not replace it.

Existing files to update:

- `packages/game-math/src/config-types.ts`
- `packages/game-math/src/index.ts`
- `packages/game-math/test/fixtures/current-client-config.ts` only if expectations need to reference new diagnostic codes or report helpers

Expected new files:

- `packages/game-math/src/rtp-calculator.ts`
- `packages/game-math/test/rtp-calculator.test.ts`

Existing primitives to reuse:

- `buildVisibleWindow(config, reelStops)` creates validated 5x3 visible windows with wraparound behavior.
- `generateWays(visibleWindow)` returns deterministic 243-way combinations for the current 5-reel, 3-row window.
- `calculateWins(config, visibleWindow)` returns canonical way, scatter, jackpot, total pay, and total free-spin output.
- `findWinCalculationDiagnostics(config)` already reports unreachable paytable entries such as `Scroll`.

### Architecture Guardrails

- Domain math lives in `packages/game-math`; route handlers, future backend services, Phaser client files, and `server_examples` must consume this package rather than duplicating math logic. [Source: `_bmad-output/planning-artifacts/architecture.md`]
- The game math package must not import Express, database clients, browser APIs, Phaser, UI code, or `server_examples`. [Source: `_bmad-output/planning-artifacts/architecture.md`]
- RTP and diagnostics are package-level pure functions. They must not mutate balances, draft configs, active configs, or player state.
- Store wager, payout, and balance-like values as integers. Percentage/frequency outputs may be decimal ratios, but they must be finite numbers and serializable.
- Do not implement seeded simulation in this story. Story 1.5 owns random sampling, volatility summary, largest win, and convergence confidence notes.

### Algorithm Guidance

Use exhaustive enumeration for theoretical reporting:

- Treat each reel stop as equally likely.
- Number of outcomes equals the product of all reel strip lengths.
- For each combination, call `buildVisibleWindow`, then `calculateWins`.
- Use a caller-provided wager input or a default report wager that matches one unit per selected 243 ways. Validate `totalWager` is a positive safe integer.
- Theoretical RTP can be `totalPaid / totalWagered`.
- Hit rate is `outcomesWithAnyPayOrFreeSpin / totalOutcomes`.
- Free-spin trigger frequency is `outcomesWithFreeSpins / totalOutcomes`.
- Jackpot trigger frequency is `outcomesWithJackpot / totalOutcomes`.
- Max payout exposure is the largest `WinBreakdown.totalPay` encountered.
- Payout distribution summary should aggregate exact payout amounts into stable buckets with counts and probabilities. Keep bucket order deterministic.

### Diagnostic Guidance

Configuration diagnostics should catch developer/operator mistakes before activation:

- Missing reel symbols: any symbol referenced by reels, paytable entries, wild rule, scatter rule, or jackpot rule but absent from `config.symbols`.
- Unreachable paytable entries: reuse `findWinCalculationDiagnostics(config)`.
- Unused metadata: any `config.symbols` entry not referenced by reels, paytable entries, wild rule, scatter rule, or jackpot rule; current config must flag `10`.
- Scatter consistency: enabled scatter should have at least one pay, a positive count, safe integer pay/freeSpins, and a symbol reachable somewhere on active reels.
- Jackpot consistency: enabled jackpot should have a reachable symbol, positive `requiredVisibleCount`, non-negative safe integer `defaultAmount`, and safe integer `incrementPerSpin`.
- Server-example mismatch risk: keep this as an explicit compatibility diagnostic option because `server_examples/server.js` is known non-canonical and must not be imported.

### Testing Requirements

Minimum test cases:

- Small exact config: verify total outcome count, RTP ratio, hit rate, free-spin trigger frequency, jackpot frequency, max payout exposure, and distribution buckets exactly.
- Current config: verify all stop combinations are enumerated and each evaluated window preserves configured 243-ways behavior.
- Diagnostics: verify `Scroll`, `10`, and server-example mismatch risk are reported for current config.
- Missing symbol diagnostics: paytable/reel/rule references to unknown symbols are reported with stable paths.
- Scatter/jackpot consistency diagnostics: malformed enabled rules are reported.
- Serialization: report survives JSON round-trip without functions, class instances, `Map`, `Set`, `Infinity`, or `NaN`.
- Regression: existing `game-math.test.ts`, `ways.test.ts`, and `win-calculator.test.ts` continue to pass.

Run and record:

- `npm run build`
- `npm run typecheck`
- `npm test`

### Previous Story Intelligence

Story 1.3 is done and established the exact calculator primitives this story should reuse.

Learnings to preserve:

- Do not recompute ways or visible symbols in downstream logic; consume `buildVisibleWindow`, `generateWays`, and `calculateWins`.
- Keep output audit-friendly: plain objects, stable IDs, integer pay/free-spin totals, and deterministic ordering.
- Do not broaden Story 1.3's win-calculation diagnostics by rewriting win matching. Extend diagnostics from the new RTP/config layer.
- Keep package source dependency-free and isolated from browser, backend, database, Phaser, and `server_examples`.

### Project Structure Notes

Do update:

- `packages/game-math/src/config-types.ts`
- `packages/game-math/src/index.ts`

Do add:

- `packages/game-math/src/rtp-calculator.ts`
- `packages/game-math/test/rtp-calculator.test.ts`

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
- `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/prd.md`
- `_bmad-output/project-context.md`
- `_bmad-output/implementation-artifacts/1-3-implement-win-scatter-and-jackpot-calculation.md`
- `packages/game-math/src/config-types.ts`
- `packages/game-math/src/ways.ts`
- `packages/game-math/src/win-calculator.ts`
- `packages/game-math/test/fixtures/current-client-config.ts`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm test`
- `npm run typecheck`
- `npm run build`

### Completion Notes List

- Added a pure `calculateRtpReport` implementation that exhaustively enumerates reel stops, reuses `buildVisibleWindow` and `calculateWins`, and emits serializable RTP/reporting metrics.
- Added configuration diagnostics for missing metadata, unused metadata, scatter/jackpot consistency, inherited unreachable paytable entries, 243-ways shape checks, and optional server-example mismatch risk.
- Added deterministic RTP/diagnostic tests covering exact fixture math, current-client diagnostics, current 243-ways shape, JSON round-trip, and invalid wager handling.
- Resolved code review finding by multiplying theoretical payout totals and distribution buckets by `lineBet` when configured.

### File List

- `_bmad-output/implementation-artifacts/1-4-build-rtp-calculator-and-config-diagnostics.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `packages/game-math/src/config-types.ts`
- `packages/game-math/src/index.ts`
- `packages/game-math/src/rtp-calculator.ts`
- `packages/game-math/test/rtp-calculator.test.ts`
