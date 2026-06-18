---
baseline_commit: ae97498d054f4666af7be2d6a754e087b9352704
---

# Story 1.3: Implement Win, Scatter, and Jackpot Calculation

Status: done

<!-- Ultimate context engine analysis completed - comprehensive developer guide created -->

## Story

As an operator,
I want wins, scatters, and jackpots calculated consistently,
so that every payout can be explained and audited.

## Acceptance Criteria

1. Given a visible window and active Game Configuration, when the win calculator evaluates the spin, then it returns line/ways wins, scatter wins, free-spin awards, jackpot wins, and total payout.
2. Wild symbol substitution follows the configured rules.
3. Payout comparisons use the canonical lowercase `pay` and `freeSpins` fields.
4. Fixture tests cover wins, losses, scatter triggers, jackpot triggers, wild substitution, and no-win cases.
5. Dead or unreachable paytable entries are reported rather than silently ignored.

## Tasks / Subtasks

- [x] Implement the pure win calculator in `packages/game-math` (AC: 1, 2, 3)
  - [x] Add `packages/game-math/src/win-calculator.ts`.
  - [x] Export `calculateWins(config, visibleWindow, options?)` or an equivalent pure function from `packages/game-math/src/index.ts`.
  - [x] Consume `generateWays(visibleWindow)` from `packages/game-math/src/ways.ts`; do not duplicate 243-ways generation.
  - [x] Return the existing public `WinBreakdown` shape with `wayWins`, `scatterWins`, `jackpotWins`, `totalPay`, and `totalFreeSpins`.
  - [x] Use lowercase `PaytableEntry.pay`, `PaytableEntry.freeSpins`, `ScatterPay.pay`, and `ScatterPay.freeSpins` for all comparisons and totals.
- [x] Implement ways/paytable matching (AC: 1, 2, 3)
  - [x] Match paytable entries left-to-right against each generated way.
  - [x] Treat `any` as a wildcard placeholder in paytable entries, not as a visible symbol.
  - [x] For each way, select the highest-value matching entry by `pay`, then `freeSpins`, then matched reel count; use deterministic tie-breaking by paytable order.
  - [x] Preserve current client rule that regular symbol wins must start from reel 0 and require the configured non-`any` prefix length.
  - [x] Populate `WayWin.coordinates` only with the concrete matched non-`any` symbols, not trailing `any` positions.
- [x] Implement configured wild substitution (AC: 2)
  - [x] Honor `config.wildRule.enabled`, `symbolId`, and `substitutesFromReelIndex`.
  - [x] Allow wilds to substitute only for target symbols whose `SymbolMetadata.useWildSubstitute` is true.
  - [x] Do not allow wild substitution before `substitutesFromReelIndex`; current config excludes first-reel substitution.
  - [x] Do not allow wilds to substitute for `Scatter`, `Jackpot`, or any symbol metadata marked `useWildSubstitute: false`.
- [x] Implement scatter and jackpot evaluation (AC: 1, 4)
  - [x] Count visible scatter symbols across the full window when `scatterRule.enabled` is true.
  - [x] Match scatter wins against configured `ScatterRule.pays`; current fixture awards 5 free spins for exactly 5 scatters.
  - [x] Count visible jackpot symbols across the full window when `jackpotRule.enabled` is true.
  - [x] Award a jackpot only when the visible count is at least `jackpotRule.requiredVisibleCount`; current fixture requires 6 jackpot symbols.
  - [x] Use `jackpotRule.defaultAmount` as the deterministic package-level jackpot amount unless an explicit amount option is provided by the function signature.
- [x] Add diagnostics for unreachable paytable entries (AC: 5)
  - [x] Add `findWinCalculationDiagnostics(config)` or an equivalent exported diagnostic helper if keeping diagnostics separate from `calculateWins`.
  - [x] Report `UNREACHABLE_PAYTABLE_ENTRY` when a paytable target symbol cannot appear in any matching position after applying reel strips and configured wild substitution.
  - [x] Preserve existing `currentClientConfigDiagnostics` expectations and ensure the `Scroll` paytable entries remain reported as unreachable.
  - [x] Do not implement full RTP, hit rate, payout distribution, or simulation in this story; those belong to Stories 1.4 and 1.5.
- [x] Add deterministic fixture tests (AC: 1, 2, 3, 4, 5)
  - [x] Add `packages/game-math/test/win-calculator.test.ts`.
  - [x] Cover a no-win window with zero totals and empty win arrays.
  - [x] Cover a regular ways win without wilds.
  - [x] Cover a wild-substituted ways win where the wild is not on reel 0.
  - [x] Cover a negative wild case where a first-reel wild or non-substitutable symbol must not produce a false win.
  - [x] Cover scatter trigger, jackpot trigger, and combined totals.
  - [x] Cover lowercase `pay`/`freeSpins` ordering so paytable order cannot hide a better win.
  - [x] Cover unreachable paytable diagnostics for `Scroll`.
- [x] Preserve package quality gates (AC: 1-5)
  - [x] `npm run build`
  - [x] `npm run typecheck`
  - [x] `npm test`

### Review Findings

- [x] [Review][Patch] Non-prefix paytable entries can produce false ways wins [packages/game-math/src/win-calculator.ts:118]
- [x] [Review][Patch] Jackpot override accepts invalid payout values [packages/game-math/src/win-calculator.ts:18]
- [x] [Review][Patch] Jackpot win under-reports visible jackpot symbols above threshold [packages/game-math/src/win-calculator.ts:237]
- [x] [Review][Patch] Fixture tests miss explicit Scatter and Jackpot wild-substitution negatives [packages/game-math/test/win-calculator.test.ts:102]

## Dev Notes

### Business and Epic Context

- Epic 1 makes slot math deterministic, testable, and faithful to current 243-ways behavior before reward-bearing backend logic goes live. [Source: `_bmad-output/planning-artifacts/epics.md`:212]
- Story 1.3 is the first payout-calculation story. It turns the Story 1.2 visible-window and ways primitives into auditable win output for backend spin execution, RTP calculation, and later simulation. [Source: `_bmad-output/planning-artifacts/epics.md`:250]
- This story supports FR3 and FR6 by calculating line/ways wins, scatter wins, free-spin awards, jackpot wins, and total payout from the active Game Configuration. [Source: `_bmad-output/planning-artifacts/epics.md`:24]
- The product requires trustworthy player/support explanations: future spin ledger records must include exact config version, reel stops, visible symbols, win breakdown, balance before/after, and timestamps. [Source: `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/prd.md`:47]

### Current Package State

Extend the current `packages/game-math` package; do not replace it.

Existing files to update:

- `packages/game-math/src/config-types.ts`
- `packages/game-math/src/index.ts`
- `packages/game-math/test/game-math.test.ts` only if public type contract coverage needs adjustment
- `packages/game-math/test/fixtures/current-client-config.ts` only if adding diagnostic fixtures without changing active config values

Expected new files:

- `packages/game-math/src/win-calculator.ts`
- `packages/game-math/test/win-calculator.test.ts`

Existing primitives to reuse:

- `buildVisibleWindow(config, reelStops)` creates a validated `VisibleWindow`.
- `generateWays(visibleWindow)` returns deterministic left-to-right ways with `coordinates` and `symbols`.
- Public types already include `WayWin`, `ScatterWin`, `JackpotWin`, `WinBreakdown`, `WinCoordinate`, and `MathDiagnostic`.
- `currentClientConfig` already mirrors the active 5-reel, 3-row client config.

### Existing Code Behavior To Preserve

- `buildVisibleWindow` validates exactly one stop per configured reel, configured reel indexes, positive row counts, strip bounds, and row-count agreement with the ways policy. Do not relax these validations.
- `generateWays` derives ways from `VisibleWindow`, uses configured reel indexes in coordinates, and preserves legacy ordering: first `[0,0,0,0,0]`, second `[0,0,0,0,1]`, third `[0,0,0,0,2]`, last `[2,2,2,2,2]`.
- The package has no runtime dependencies and no package-local dev dependencies. Keep calculator code dependency-free.
- The package isolation test scans source for Express, database, Phaser, browser globals, and legacy example imports. Keep `win-calculator.ts` pure TypeScript.

### Legacy Client Behavior To Match Or Correct

- Current frontend is static Phaser under `index.html` and `js/`; do not modify it in this story. [Source: `_bmad-output/project-context.md`:18]
- `js/slotConfig3x5.js` defines `useWild: true`, `wild: 'Wild'`, `useScatter: true`, `scatter: 'Scatter'`, and `useWildInFirstPosition: false`. [Source: `js/slotConfig3x5.js`:18]
- Wild substitution excludes the first reel in the active config. In package terms, this is represented by `wildRule.substitutesFromReelIndex: 1`. [Source: `packages/game-math/test/fixtures/current-client-config.ts`]
- Regular paytable entries use 3-, 4-, and 5-symbol left-to-right prefixes followed by `any`. A 3-symbol entry such as `['Fan','Fan','Fan','any','any']` should match only the first 3 reels and should record 3 coordinates.
- Legacy `LineBehavior.findWin()` tries to choose the best win but compares `this.win.Pay` and `this.win.FreeSpins`, while `WinData` stores lowercase `pay` and `freeSpins`. This story must use canonical lowercase fields everywhere to avoid paytable-order-dependent wins. [Source: `_bmad-output/project-context.md`:53]
- Legacy scatter win counts visible scatter symbols across all reels and matches `scatterPayTable` by exact `scattersCount`; current config has 5 scatters -> 5 free spins. [Source: `js/slot_classes.js`:860]
- Legacy jackpot win counts visible jackpot symbols across all reels and awards when the count equals configured `symbolsCount`; the canonical package should treat `JackpotRule.requiredVisibleCount` as a threshold so more than 6 visible jackpot symbols still wins. [Source: `js/slot_classes.js`:882]
- Current fixture encodes jackpot as `requiredVisibleCount: 6`, `defaultAmount: 1000`, and `incrementPerSpin: 1`; calculation should be deterministic and not read UI jackpot state. [Source: `packages/game-math/test/fixtures/current-client-config.ts`]

### Architecture Guardrails

- Domain math lives in `packages/game-math`; route handlers, future backend services, Phaser client files, and `server_examples` must consume this package rather than duplicating payout logic. [Source: `_bmad-output/planning-artifacts/architecture.md`:271]
- API route handlers must not implement game math directly, and the game math package must not import Express, database clients, browser APIs, Phaser, UI code, or `server_examples`. [Source: `_bmad-output/planning-artifacts/architecture.md`:413]
- Deterministic tests are required when changing paytable, scatter, jackpot, or ways logic. [Source: `_bmad-output/planning-artifacts/architecture.md`:306]
- Store wager, payout, and balance values as integers. The game math package should keep `IntegerUnit` integer semantics and should not introduce floating payout math. [Source: `_bmad-output/planning-artifacts/architecture.md`:278]
- Win breakdowns are later stored as JSON plus normalized summary fields for reporting, so the returned structure must remain serializable without class instances, functions, Phaser objects, or circular references. [Source: `_bmad-output/planning-artifacts/architecture.md`:284]

### Algorithm Guidance

Use a small set of pure helpers inside `win-calculator.ts`:

- `calculateWayWins(config, visibleWindow)`:
  - Generate ways once with `generateWays`.
  - For each generated way, evaluate paytable entries.
  - A paytable symbol matches if it is `any`, equals the visible symbol, or can be substituted by the configured wild.
  - Wild substitution is allowed only when the visible symbol is `wildRule.symbolId`, the reel index is at least `substitutesFromReelIndex`, and target symbol metadata has `useWildSubstitute: true`.
  - For a matching entry, collect coordinates for required non-`any` positions only.
  - Emit at most one `WayWin` per generated way: the best matching paytable entry.
- `calculateScatterWins(config, visibleWindow)`:
  - Flatten visible symbols, filter by `scatterRule.symbolId`, and match configured pays.
  - Prefer exact count behavior for current client compatibility unless tests/documentation intentionally allow threshold behavior.
- `calculateJackpotWins(config, visibleWindow, jackpotAmount?)`:
  - Flatten visible symbols, filter by `jackpotRule.symbolId`, and require count >= `requiredVisibleCount`.
  - Use `jackpotAmount ?? jackpotRule.defaultAmount` for the returned pay.
- `calculateWinBreakdown(...)`:
  - Sum `pay` across ways, scatters, and jackpots into `totalPay`.
  - Sum `freeSpins` across ways and scatters into `totalFreeSpins`; jackpot has pay only in current public type.

Keep IDs deterministic and useful for audit, for example `way-0:fan-3`, `scatter-5`, and `jackpot-6`.

### Diagnostic Guidance

Dead or unreachable paytable entries must not be silently ignored. For this story, implement enough diagnostics to catch the known `Scroll` issue.

Recommended diagnostic rules:

- Build a set of symbols present on each reel.
- For each paytable entry, inspect required non-`any` positions.
- A required target is reachable on that reel if the reel contains the target symbol.
- If wilds are enabled, a required target can also be reachable on that reel if the reel is at or after `substitutesFromReelIndex`, contains the wild symbol, and target metadata allows wild substitution.
- If any required position is not reachable, return `MathDiagnostic` with code `UNREACHABLE_PAYTABLE_ENTRY`, severity `warning`, path like `['paytable', entry.id]`, and a message naming the entry and symbol.

Do not move full configuration diagnostics into this story. Story 1.4 will broaden diagnostics to missing reel symbols, unused symbol metadata, inconsistent scatter/jackpot settings, and payout distribution.

### Testing Requirements

Use deterministic tests with small helper configs where exact windows are easier to reason about. Keep at least one test against `currentClientConfig`.

Minimum test cases:

- No win: visible window has no matching way, no scatter, no jackpot; `totalPay` and `totalFreeSpins` are 0.
- Regular win: a left-to-right 3-symbol prefix pays and returns exactly 3 coordinates.
- Better-win selection: if multiple entries match one way, the result chooses the greater lowercase `pay`; if pay ties, greater lowercase `freeSpins`.
- Wild win: a way with `Wild` on reel 1 or later substitutes for a substitutable symbol and returns the wild coordinate as part of the win.
- Wild negative: a first-reel wild does not substitute when `substitutesFromReelIndex` is 1.
- Non-substitutable negative: wild does not substitute for `Scatter`, `Jackpot`, or symbol metadata with `useWildSubstitute: false`.
- Scatter: exactly 5 visible `Scatter` symbols returns one `ScatterWin`, `freeSpins: 5`, and contributes to `totalFreeSpins`.
- Jackpot: at least 6 visible `Jackpot` symbols returns one `JackpotWin` with deterministic pay and contributes to `totalPay`.
- Diagnostics: `Scroll` paytable entries in `currentClientConfig` produce `UNREACHABLE_PAYTABLE_ENTRY`.
- Regression: existing `game-math.test.ts` and `ways.test.ts` continue to pass.

Run and record:

- `npm run build`
- `npm run typecheck`
- `npm test`

### Previous Story Intelligence

Story 1.2 is done and established the exact primitives this story should reuse.

Learnings to preserve:

- Do not recompute visible symbols from reel strips inside downstream logic; consume `VisibleWindow` and generated ways.
- Coordinates must use configured `reelIndex` values, not array positions.
- Row-count validation matters because mismatched window shapes can corrupt ways and payout calculations.
- Keep package output under `dist` only via `npm run build`; do not commit or hand-edit generated dist files.
- Keep package source independent from Phaser, DOM, Express, database clients, and `server_examples`.

Review patches from Story 1.2 fixed row-count consistency, configured reel-index coordinates, duplicate configured reel-index validation, and regression coverage. Do not undo those behaviors.

### Git Intelligence

Recent commits are planning-focused:

- `ae97498` next step is sprint planning
- `c4a6c80` Add BMAD architecture for backend separation
- `77fdadf` Add BMAD PRD for backend separation
- `54fde47` Add BMAD planning setup
- `56c1db0` first commit

Story 1.1 and 1.2 implementation files are present in the working tree and are not represented by recent commits. Treat the current package files and completed story records as the implementation baseline; do not revert uncommitted work.

### Latest Technical Information

- The repo currently pins TypeScript `6.0.3`; npm and TypeScript release docs identify 6.0.x as the current stable package line. Keep the project pin unless there is a dedicated dependency-update story. [Source: `package.json`; https://www.npmjs.com/package/typescript; https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html]
- The repo currently pins Vitest `4.1.9`; npm identifies `4.1.9` as the latest stable release. Keep existing Vitest usage and avoid adding test libraries. [Source: `package.json`; https://www.npmjs.com/package/vitest]
- Node.js release docs show Node 24 as LTS and Node 26 as current release as of 2026-06-18. This repo has been validated with Node 24/npm 11 patterns in previous stories; do not require Node 26 for this story. [Source: https://nodejs.org/en/about/previous-releases; https://nodejs.org/en]

### Project Structure Notes

Do update:

- `packages/game-math/src/index.ts`
- `packages/game-math/src/config-types.ts` only if public types need small refinements
- `packages/game-math/test/game-math.test.ts` only for public contract coverage
- `packages/game-math/test/fixtures/current-client-config.ts` only for diagnostic fixture support

Do add:

- `packages/game-math/src/win-calculator.ts`
- `packages/game-math/test/win-calculator.test.ts`

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
- `_bmad-output/implementation-artifacts/1-2-model-243-ways-reel-windows.md`
- `packages/game-math/src/config-types.ts`
- `packages/game-math/src/ways.ts`
- `packages/game-math/test/ways.test.ts`
- `packages/game-math/test/fixtures/current-client-config.ts`
- `js/slot_classes.js`
- `js/slotConfig3x5.js`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Red phase: `npm test --workspace @china-slot-game/game-math` failed with 8 missing-export failures for `calculateWins` and `findWinCalculationDiagnostics`.
- Green phase: `npm test --workspace @china-slot-game/game-math` passed with 3 test files and 19 tests after adding `win-calculator.ts` and exports.
- Validation: `npm run typecheck` passed.
- Validation: `npm run build` passed.

### Completion Notes List

- Added a pure `calculateWins(config, visibleWindow, options?)` implementation that returns `WinBreakdown` with ways, scatter, jackpot, total pay, and total free spins.
- Reused `generateWays(visibleWindow)` for way evaluation; no duplicate ways generation or legacy client imports were added.
- Implemented best-paytable-entry selection using lowercase `pay`, `freeSpins`, matched reel count, and deterministic paytable order tie-breaking.
- Implemented configured wild substitution with first-reel exclusion through `substitutesFromReelIndex` and `SymbolMetadata.useWildSubstitute`.
- Implemented scatter free-spin wins and jackpot wins using deterministic package data plus optional explicit jackpot amount.
- Added `findWinCalculationDiagnostics(config)` for unreachable paytable entries and covered current `Scroll` diagnostics.
- Added deterministic calculator tests for no-win, regular wins, better-win ordering, wild positive/negative cases, scatter, jackpot, explicit jackpot amount, and unreachable diagnostics.
- Resolved code review finding: non-prefix and gapped paytable entries are ignored so regular wins must use a left-to-right non-`any` prefix.
- Resolved code review finding: explicit jackpot override values must be non-negative safe integers.
- Resolved code review finding: jackpot wins now report the actual visible jackpot symbol count and coordinates when count exceeds the trigger threshold.
- Resolved code review finding: tests now explicitly prove wilds cannot substitute for `Scatter` or `Jackpot` paytable targets.

### File List

- `_bmad-output/implementation-artifacts/1-3-implement-win-scatter-and-jackpot-calculation.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `packages/game-math/src/index.ts`
- `packages/game-math/src/win-calculator.ts`
- `packages/game-math/test/win-calculator.test.ts`

### Change Log

- 2026-06-18: Implemented Story 1.3 win, scatter, jackpot, and unreachable-paytable diagnostic calculation with deterministic tests.
- 2026-06-18: Addressed code review findings with prefix validation, jackpot amount validation, full jackpot audit coordinates, and additional wild-substitution regression tests.
