---
baseline_commit: ae97498d054f4666af7be2d6a754e087b9352704
---

# Story 1.2: Model 243-Ways Reel Windows

Status: done

<!-- Ultimate context engine analysis completed - comprehensive developer guide created -->

## Story

As a developer,
I want the game math package to model the current 5-reel, 3-row, 243-ways behavior,
so that backend outcomes match the existing game rules.

## Acceptance Criteria

1. Given a Game Configuration with five reel strips and a reel stop for each reel, when the math package builds the visible window, then it returns the three visible symbols for each reel using wraparound behavior.
2. It can generate all 243 possible left-to-right row combinations for a 5x3 window.
3. Deterministic fixture tests prove the generated ways count and symbol coordinates.
4. The implementation does not rely on Phaser classes or browser globals.

## Tasks / Subtasks

- [x] Add reel-window construction to `packages/game-math` (AC: 1, 4)
  - [x] Create `packages/game-math/src/ways.ts`.
  - [x] Export a pure `buildVisibleWindow(config, reelStops)` function from `packages/game-math/src/index.ts`.
  - [x] Use `GameConfiguration.reels`, `ReelStop.reelIndex`, and `ReelStop.stopIndex`; do not read Phaser reels, sprites, DOM globals, or `js/slot_classes.js`.
  - [x] Return `VisibleWindow` with `rows` and one symbol list per reel.
  - [x] Populate every `VisibleSymbol` with `reelIndex`, `rowIndex`, `symbolId`, and `stripIndex`.
  - [x] Implement wraparound using modulo so stops near the end of a strip still return exactly three visible rows.
- [x] Add 243-ways generation (AC: 2, 3, 4)
  - [x] Export a pure `generateWays(window)` function from `packages/game-math/src/index.ts`.
  - [x] Generate all left-to-right row coordinate combinations for the window.
  - [x] Match the legacy deterministic ordering: `[0,0,0,0,0]`, `[0,0,0,0,1]`, `[0,0,0,0,2]`, then carry leftward, with `[2,2,2,2,2]` last.
  - [x] Return coordinates and symbols for each way so future win calculation can consume the output without re-reading the window.
- [x] Extend or refine types only where needed (AC: 1, 2, 3)
  - [x] Add exported types for row coordinates and generated ways if `WinCoordinate`/`VisibleSymbol` are not sufficient.
  - [x] Keep existing Story 1.1 public types compatible unless a change is necessary and covered by tests.
- [x] Add deterministic tests (AC: 1, 2, 3, 4)
  - [x] Test visible window construction from `currentClientConfig` for a normal stop.
  - [x] Test wraparound for at least one reel stop at the end of a reel strip.
  - [x] Test `generateWays()` returns 243 ways for the current 5x3 fixture.
  - [x] Test first, second, third, and last generated way coordinates to lock deterministic ordering.
  - [x] Test at least one generated way includes the expected `symbolId` values from the visible window.
  - [x] Keep package isolation tests passing.
- [x] Preserve package build and workspace ergonomics (AC: 4)
  - [x] `npm run build` passes and emits only source package output under ignored `dist`.
  - [x] `npm run typecheck` passes with non-DOM TypeScript config.
  - [x] `npm test` passes independently of the Phaser browser client.

### Review Findings

- [x] [Review][Patch] `VisibleWindow.rows` can disagree with actual reel rows [packages/game-math/src/ways.ts:43]
- [x] [Review][Patch] Generated way coordinates conflate reel array position with configured `reelIndex` [packages/game-math/src/ways.ts:51]
- [x] [Review][Patch] Configured reel indexes can be duplicated and let extra stops pass validation [packages/game-math/src/ways.ts:86]

## Dev Notes

### Business and Epic Context

- Epic 1 exists to make slot math deterministic, testable, and faithful to the current 243-ways behavior before reward-bearing backend logic goes live. [Source: `_bmad-output/planning-artifacts/epics.md`:212]
- Story 1.2 is the first behavioral math story after package creation. It should model reel windows and 243 row combinations only; win, scatter, jackpot, RTP, and simulation logic belong to Stories 1.3 through 1.5. [Source: `_bmad-output/planning-artifacts/epics.md`:230]
- This story supports FR3 and FR6 by providing deterministic window/ways primitives for backend spin resolution and later theoretical calculation. [Source: `_bmad-output/planning-artifacts/epics.md`:222]

### Current Package State From Story 1.1

Story 1.1 is complete and code-reviewed. The dev agent should extend, not replace, this package.

Existing files to update:

- `packages/game-math/src/config-types.ts`
- `packages/game-math/src/index.ts`
- `packages/game-math/test/game-math.test.ts`

Expected new file:

- `packages/game-math/src/ways.ts`

Existing useful fixture:

- `packages/game-math/test/fixtures/current-client-config.ts`

Current package guarantees already established:

- Root workspace scripts exist: `npm run build`, `npm run typecheck`, `npm test`.
- Package scripts exist: `build`, `typecheck`, `test`.
- TypeScript is strict and uses explicit non-DOM `lib: ["ES2023"]`.
- Build emits `packages/game-math/dist`, which is ignored by `.gitignore`.
- Package has no runtime dependencies, no package-local dev dependencies, and root dev dependencies are pinned.
- Current pinned versions observed on 2026-06-17: Node `v24.10.0`, npm `11.6.0`, TypeScript `6.0.3`, Vitest `4.1.9`.

### Architecture Guardrails

- Domain math lives in `packages/game-math`; route handlers, Phaser client files, and future backend services must consume this package rather than duplicating math. [Source: `_bmad-output/planning-artifacts/architecture.md`:269]
- The game math package must not import Express, database clients, browser APIs, Phaser, UI code, or `server_examples`. [Source: `_bmad-output/planning-artifacts/architecture.md`:410]
- Tests should remain colocated in the package, with deterministic fixtures under `packages/game-math/test/fixtures`. [Source: `_bmad-output/planning-artifacts/architecture.md`:277]
- TypeScript files use kebab-case, types/classes PascalCase, and functions/variables camelCase. [Source: `_bmad-output/planning-artifacts/architecture.md`:262]

### Legacy Client Behavior To Match

- Current frontend is static Phaser under `index.html` and `js/`; do not modify it in this story. [Source: `_bmad-output/project-context.md`:18]
- Current 3x5 config is in `js/slotConfig3x5.js`; the Story 1.1 fixture already mirrors the active reel strips and metadata. [Source: `_bmad-output/project-context.md`:19]
- The active game behaves as 243 ways because `LinesController` receives no explicit `linesData` and falls back to `getAllPossibleLines()`. [Source: `js/slot_classes.js`:715]
- `getAllPossibleLines()` builds `maxCounterValues` from every reel's `windowsCount - 1`, then uses `ComboCounter` to emit every row combination. With five 3-row reels this is `3^5 = 243`. [Source: `js/slot_classes.js`:793]
- `ComboCounter.nextCombo()` starts with all zeroes, increments the rightmost counter first, and resets lower-order counters when carrying. Expected first ways are `[0,0,0,0,0]`, `[0,0,0,0,1]`, `[0,0,0,0,2]`; expected last way is `[2,2,2,2,2]`. [Source: `js/mkutils.js`:129]
- `Reel.getWindowsSymbols(orderPosition)` returns `windowsCount` symbols starting at `orderPosition`, increasing by row offset, and wraps with modulo when the strip end is crossed. [Source: `js/slot_classes.js`:319]

### Implementation Requirements

- `buildVisibleWindow(config, reelStops)` should validate enough to avoid silent nonsense:
  - exactly one stop per configured reel
  - stop reel indexes match configured `reelIndex` values
  - each stop index is an integer in `[0, reel.symbols.length - 1]`
  - each reel has `visibleRows > 0`
  - no Phaser classes or mutable sprite objects in output
- `generateWays(window)` should not assume 5x3 internally. It should work from `window.reels.length` and `window.rows`, while tests must prove the current fixture returns 243.
- The output shape should make Story 1.3 easy: each generated way should include row/reel coordinates and the `VisibleSymbol` entries selected by those coordinates.
- Do not implement win matching, scatter counting, jackpot counting, RTP, RNG, or simulation here. They are later stories.

### Suggested Type Shape

The dev agent can choose exact names, but this shape is a good fit with existing types:

```ts
export interface WayCoordinate {
  reelIndex: number;
  rowIndex: number;
}

export interface GeneratedWay {
  id: string;
  coordinates: WayCoordinate[];
  symbols: VisibleSymbol[];
}
```

If reusing `WinCoordinate`, keep names semantically clear; these coordinates are candidate way coordinates, not winning coordinates yet.

### Testing Requirements

Tests should be red-first and deterministic.

Recommended fixtures/assertions:

- For reel 0 stop `8`, visible rows should wrap to strip indexes `8`, `9`, `0`, yielding symbols `A`, `CoinsHeap`, `Fan` from current fixture reel 0.
- For reel 4 stop `14`, visible rows should use strip indexes `14`, `15`, `0`, yielding symbols `Teapot`, `Jackpot`, `CoinsHeap`.
- With all stops `[0,0,0,0,0]`, generated ways should have length `243`.
- First generated way coordinates should be all row `0`.
- Second generated way coordinates should be `[0,0,0,0,1]` by row index.
- Third generated way coordinates should be `[0,0,0,0,2]`.
- Last generated way coordinates should be all row `2`.
- At least one generated way should map symbols from `VisibleWindow` rather than recomputing from reel strips.

Run and record:

- `npm run build`
- `npm run typecheck`
- `npm test`

### Previous Story Intelligence

Story 1.1 created the package skeleton and was code-reviewed. Review patches fixed several issues the dev agent must preserve:

- Use a build-only tsconfig for package output; do not break `npm run build`.
- Keep explicit non-DOM TypeScript lib.
- Preserve symbol metadata and wild eligibility in `GameConfiguration`.
- Preserve payout policy in `GameConfiguration`.
- Preserve and strengthen package isolation tests when adding new source files.

Known dirty-worktree reality:

- Story 1.1 implementation files may still be uncommitted in the local worktree. Do not revert them. Treat them as the established baseline for Story 1.2.

### Git Intelligence

Recent commits are still planning-focused:

- `ae97498` next step is sprint planning
- `c4a6c80` Add BMAD architecture for backend separation
- `77fdadf` Add BMAD PRD for backend separation
- `54fde47` Add BMAD planning setup
- `56c1db0` first commit

Because Story 1.1 work is not committed yet, rely on the current files and Story 1.1 Dev Agent Record rather than commit history for implementation patterns.

### Project Structure Notes

Do update:

- `packages/game-math/src/index.ts`
- `packages/game-math/src/config-types.ts` if new exported types are needed
- `packages/game-math/test/game-math.test.ts` or a new package test file

Do add:

- `packages/game-math/src/ways.ts`

Do not update:

- `js/slot_classes.js`
- `js/slotConfig3x5.js`
- `server_examples/*`
- `apps/api`
- `apps/admin`
- database migrations
- production spin endpoint code

### References

- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/project-context.md`
- `_bmad-output/implementation-artifacts/1-1-create-canonical-game-math-package.md`
- `packages/game-math/src/config-types.ts`
- `packages/game-math/test/fixtures/current-client-config.ts`
- `js/slot_classes.js`
- `js/mkutils.js`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Red phase: `npm run typecheck` failed because `buildVisibleWindow` and `generateWays` were not exported.
- Red phase: `npm test` failed because the new ways tests called missing functions.
- Green validation: `npm run typecheck` passed after adding `ways.ts` and exported types/functions.
- Regression validation: `npm run build && npm run typecheck && npm test` passed with 2 test files and 8 tests.
- Export validation: `node -e "import('@china-slot-game/game-math').then((m)=>console.log(typeof m.buildVisibleWindow, typeof m.generateWays))"` returned `function function`.
- Review patch validation: `npm run build && npm run typecheck && npm test` passed with 2 test files and 11 tests.

### Completion Notes List

- Story context generated on 2026-06-17.
- Added pure reel-window construction through `buildVisibleWindow(config, reelStops)` with validation for stop count, duplicate stops, integer stop indexes, configured reels, positive visible rows, and strip bounds.
- Added pure 243-ways generation through `generateWays(visibleWindow)`, preserving legacy rightmost-counter-first ordering.
- Added `WayCoordinate` and `GeneratedWay` public types for future win-calculation stories.
- Added deterministic tests for normal visible rows, wraparound visible rows, 243 way count, first/second/third/last way coordinates, and way-to-symbol mapping.
- Preserved Story 1.1 package guarantees: build output, non-DOM typecheck, package isolation, and package-name import.
- Applied code review patches for row-count consistency, configured reel-index coordinates, duplicate configured reel-index validation, and regression coverage.

### File List

- `_bmad-output/implementation-artifacts/1-2-model-243-ways-reel-windows.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `packages/game-math/src/config-types.ts`
- `packages/game-math/src/index.ts`
- `packages/game-math/src/ways.ts`
- `packages/game-math/test/ways.test.ts`

### Change Log

- 2026-06-17: Implemented Story 1.2 reel-window construction, 243-way generation, public way types, and deterministic fixture tests.
- 2026-06-18: Applied code review patches and marked Story 1.2 done.
