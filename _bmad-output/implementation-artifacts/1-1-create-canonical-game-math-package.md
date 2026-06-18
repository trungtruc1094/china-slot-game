---
baseline_commit: ae97498d054f4666af7be2d6a754e087b9352704
---

# Story 1.1: Create Canonical Game Math Package

Status: done

<!-- Ultimate context engine analysis completed - comprehensive developer guide created -->

## Story

As a developer,
I want a standalone game math package,
so that backend spin execution, RTP calculation, and simulation use one canonical implementation.

## Acceptance Criteria

1. Given the existing Phaser client config and architecture document, when the package skeleton is created, then `packages/game-math` contains TypeScript source, package metadata, test setup, and strict type configuration.
2. The package has no Express, database, browser, Phaser, or UI dependencies.
3. Exported types include Game Configuration, reel strip, visible window, win breakdown, scatter rule, jackpot rule, and spin result structures.
4. Unit tests can run for the package independently from the browser client.

## Tasks / Subtasks

- [x] Create the isolated package skeleton (AC: 1, 2)
  - [x] Add `packages/game-math/package.json` with scripts for `typecheck` and `test`.
  - [x] Add `packages/game-math/tsconfig.json` with strict TypeScript settings and no DOM/browser assumptions unless required by the test runner.
  - [x] Add `packages/game-math/src/index.ts` as the public export surface.
  - [x] Add `packages/game-math/test/` and `packages/game-math/test/fixtures/` for deterministic math fixtures.
- [x] Define canonical domain types (AC: 3)
  - [x] Add `packages/game-math/src/config-types.ts`.
  - [x] Include types for symbols, paytable entries, reel strips, reel stops, 5x3 visible windows, selected ways/lines, win breakdowns, scatter rules, jackpot rules, wager inputs, RNG metadata placeholders, and spin results.
  - [x] Use integer units for wager, payout, balances, jackpot values, and caps; do not introduce floating point money-like values.
- [x] Add initial fixture coverage without implementing full math yet (AC: 1, 4)
  - [x] Add a fixture representing the current 5-reel, 3-row config from `js/slotConfig3x5.js`.
  - [x] Add smoke tests proving the package can import fixture config, compile the public types, and run independently of `index.html`, Phaser, and `js/`.
  - [x] Add negative dependency checks or tests that prevent importing Express, database clients, Phaser, browser globals, or `server_examples`.
- [x] Wire repo-level ergonomics only as needed (AC: 4)
  - [x] If the repo has no root workspace metadata yet, add the smallest root `package.json` workspace configuration needed to run package scripts predictably.
  - [x] Do not scaffold `apps/api`, databases, admin UI, RTP calculators, simulators, or production spin endpoints in this story.

### Review Findings

- [x] [Review][Patch] Build output contract is unreachable [packages/game-math/package.json:6]
- [x] [Review][Patch] TypeScript config still allows DOM ambient globals [packages/game-math/tsconfig.json:2]
- [x] [Review][Patch] Fixture omits current payout multiplier policy [packages/game-math/test/fixtures/current-client-config.ts:86]
- [x] [Review][Patch] Symbol metadata and wild eligibility are missing from canonical config [packages/game-math/src/config-types.ts:77]
- [x] [Review][Patch] Isolation test is too narrow to catch package-level coupling [packages/game-math/test/game-math.test.ts:164]

## Dev Notes

### Business and Epic Context

- Epic 1 exists to make slot math deterministic, testable, and faithful to the current 243-ways behavior before reward-bearing backend logic goes live. [Source: `_bmad-output/planning-artifacts/epics.md`:176]
- This story covers FR3 and FR6 plus NFR2 and NFR3: the future backend must resolve wins from active configuration, and the system must calculate theoretical metrics from draft configuration. [Source: `_bmad-output/planning-artifacts/epics.md`:216]
- The product direction is a community reward mini game with transparent budget exposure, not a real-money casino product. Do not add redemption, cash, crypto, or casino compliance behavior in this story. [Source: `_bmad-output/project-context.md`:5]

### Architecture Guardrails

- `packages/game-math` is the canonical package for backend spin execution, RTP calculation, simulations, and deterministic tests. [Source: `_bmad-output/planning-artifacts/epics.md`:91]
- The package must have no Express, database, browser, Phaser, or UI dependencies. [Source: `_bmad-output/planning-artifacts/architecture.md`:410]
- Domain math belongs in `packages/game-math`; deterministic fixture tests belong under `packages/game-math/test/fixtures`. [Source: `_bmad-output/planning-artifacts/architecture.md`:269]
- Use TypeScript kebab-case files, PascalCase types/classes, and camelCase functions/variables. [Source: `_bmad-output/planning-artifacts/architecture.md`:262]
- Do not duplicate payout logic in the client or route handlers later; this package becomes the source future stories must import. [Source: `_bmad-output/planning-artifacts/architecture.md`:302]

### Current Code Intelligence

- The current browser client is static Phaser under `index.html` and `js/`; do not rewrite or convert it in this story. [Source: `_bmad-output/project-context.md`:18]
- Current config lives in `js/slotConfig3x5.js` and includes reel strips, paytable, scatter, jackpot, controls, and assets. [Source: `_bmad-output/project-context.md`:19]
- The active reel layout is five reels with `windowsCount: 3` on each reel. [Source: `js/slotConfig3x5.js`:492]
- Because no explicit `linesData` is provided to `LinesController`, the browser falls back to `getAllPossibleLines()`, producing all row combinations from each reel window. With 5 reels and 3 rows, later math stories must model 243 ways. [Source: `js/slot_classes.js`:715]
- Current win comparison has a known bug: `findWin()` compares `Pay` and `FreeSpins`, while `WinData` uses lowercase fields. Types should standardize lowercase `pay` and `freeSpins` so later implementation cannot preserve that bug accidentally. [Source: `js/slot_classes.js`:615]
- Known current config diagnostics that future stories must detect: `Scroll` appears in the paytable but not the reel strips, `10` appears in symbol metadata but is not meaningfully active in the paytable, and current RTP estimate is roughly 30.8 percent. [Source: `_bmad-output/project-context.md`:50]
- `server_examples/server.js` is not canonical; it uses simplified paylines and does not fully match browser 243-ways behavior. Do not copy its win calculator into `packages/game-math`. [Source: `_bmad-output/project-context.md`:24]

### Type Model Requirements

The initial type surface should be boring and explicit. Prefer small exported interfaces over clever generic modeling.

Required exports:

- `SymbolId`
- `PaytableEntry`
- `ReelStrip`
- `ReelStop`
- `VisibleWindow`
- `VisibleSymbol`
- `WaysPolicy` or equivalent representation of 243-ways/line policy
- `WildRule`
- `ScatterRule`
- `JackpotRule`
- `GameConfiguration`
- `WagerInput`
- `WinLine` or `WayWin`
- `ScatterWin`
- `JackpotWin`
- `WinBreakdown`
- `SpinResult`
- `MathDiagnostic`

All pay, wager, jackpot, and balance-like fields should be integer units. Use names that can map to future API camelCase payloads.

### Package and Library Requirements

- Target Node.js 24 LTS for backend/package tooling as specified by the architecture. Local environment currently reports `node v24.10.0`.
- Use strict TypeScript and pin the exact implementation version. Registry check on 2026-06-17 reported `typescript@6.0.3`.
- Use Vitest for package unit tests unless implementation discovers a hard compatibility blocker. Registry check on 2026-06-17 reported `vitest@4.1.9`.
- Keep package dependencies minimal. Runtime dependencies should usually be zero for this story; dev dependencies can include TypeScript, Vitest, and Node types.

### Project Structure Notes

Expected new files:

- `package.json` at repo root only if needed for npm workspaces/scripts.
- `packages/game-math/package.json`
- `packages/game-math/tsconfig.json`
- `packages/game-math/src/index.ts`
- `packages/game-math/src/config-types.ts`
- `packages/game-math/test/game-math.test.ts`
- `packages/game-math/test/fixtures/current-client-config.ts`

Do not create these yet:

- `apps/api`
- `apps/admin`
- database migrations
- production spin APIs
- RTP calculator implementation
- simulator implementation
- Phaser client integration

### Testing Requirements

- `npm test` or package-local equivalent must run the `packages/game-math` unit tests without loading browser files.
- `npm run typecheck` or package-local equivalent must typecheck the package in strict mode.
- Add a test that imports the current-client fixture and validates the fixture shape enough to catch missing reel strips, paytable, scatter rule, and jackpot rule.
- Add a test that asserts the package public exports exist and are usable from TypeScript.
- Avoid tests that depend on random outcomes in this story.

### Previous Story Intelligence

No previous implementation story exists in Epic 1. Recent git work is planning-only: BMAD setup, PRD, architecture, and sprint planning. There are no established package implementation patterns in this repo yet.

### Risk Notes

- Biggest implementation risk: copying simplified server example math instead of modeling current browser 243-ways behavior.
- Second risk: building too much. This story is only the package skeleton, public types, fixtures, and independent tests. Win calculation, RTP, and simulation belong to Stories 1.2 through 1.5.
- Third risk: introducing browser/Phaser coupling. The package should be usable by a backend process, CLI simulator, or test runner without a DOM.

### References

- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/project-context.md`
- `js/slotConfig3x5.js`
- `js/slot_classes.js`
- `server_examples/server.js`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Red phase: `npm test --workspace @china-slot-game/game-math` failed because fixture and source exports were missing.
- Red phase: `npm run typecheck --workspace @china-slot-game/game-math` failed because fixture and source exports were missing.
- Green/refactor validation: `npm run typecheck --workspace @china-slot-game/game-math` passed.
- Green/refactor validation: `npm test --workspace @china-slot-game/game-math` passed with 4 tests.
- Regression validation: `npm run typecheck` passed.
- Regression validation: `npm test` passed with 4 tests.
- Review patch validation: `npm run build` passed.
- Review patch validation: `npm run typecheck` passed.
- Review patch validation: `npm test` passed with 4 tests.
- Review patch validation: `node -e "import('@china-slot-game/game-math').then((m)=>{ console.log(Object.keys(m).length); })"` resolved the package export.

### Completion Notes List

- Story context generated on 2026-06-17.
- Added a minimal npm workspace rooted at the repo and an isolated `@china-slot-game/game-math` package.
- Added strict TypeScript configuration and a public type export surface for canonical game configuration, reel, visible window, wager, win breakdown, scatter, jackpot, RNG metadata, spin result, and diagnostic structures.
- Added a current-client fixture that captures the active 5-reel, 3-row, 243-ways slot config shape plus known diagnostics for `Scroll`, `10`, and server example mismatch.
- Added Vitest smoke and boundary tests proving the package runs independently and does not import Express, database clients, Phaser, browser globals, or `server_examples`.
- Code review patches applied: added build-only TypeScript config, explicit non-DOM lib, payout policy, symbol metadata with wild eligibility, stronger package isolation tests, and a no-DOM type guard.

### File List

- `_bmad-output/implementation-artifacts/1-1-create-canonical-game-math-package.md`
- `.gitignore`
- `package-lock.json`
- `package.json`
- `packages/game-math/package.json`
- `packages/game-math/tsconfig.json`
- `packages/game-math/tsconfig.build.json`
- `packages/game-math/src/config-types.ts`
- `packages/game-math/src/index.ts`
- `packages/game-math/test/fixtures/current-client-config.ts`
- `packages/game-math/test/game-math.test.ts`
- `packages/game-math/test/no-dom-globals.test-d.ts`

### Change Log

- 2026-06-17: Implemented Story 1.1 canonical game math package skeleton, strict type surface, current-client fixture, package tests, and workspace scripts.
- 2026-06-17: Applied code review patches for build exports, non-DOM typing, fixture fidelity, symbol metadata, and dependency isolation.
