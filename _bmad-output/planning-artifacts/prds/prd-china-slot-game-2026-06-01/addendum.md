# PRD Addendum: China Slot Game

## Source Context

This PRD is based on the existing Phaser prototype, the BMAD project context, and the prior codebase probability review. Relevant source files include:

- `index.html`
- `js/slotConfig3x5.js`
- `js/slotGame.js`
- `js/slot_classes.js`
- `js/state_machine.js`
- `server_examples/server.js`
- `server_examples/database_schema.sql`
- `_bmad-output/project-context.md`
- `docs/project-overview.md`

## Technical Notes For Architecture

- The current client behaves as a 243-ways slot because `slotConfig.lines` is not defined and `LinesController` falls back to generated all-possible lines.
- The existing server example does not yet match the 243-ways client math and should not be treated as production logic.
- Current game math has a known win-comparison bug where `LineBehavior.findWin()` checks `Pay` and `FreeSpins`, while `WinData` fields are lowercase `pay` and `freeSpins`.
- Existing config contains dead or inconsistent symbols: `Scroll` appears in the paytable but not reel strips, and `10` is present in symbol metadata without meaningful paytable use.
- Earlier analysis estimated current RTP at roughly 30.8 percent under the active client configuration. This should be treated as an estimate until a deterministic calculator confirms it.

## Operating Principle

The host should control profitability through approved configuration, budget caps, bet limits, prize caps, and monitoring. The system should not silently change odds per player, per session, or in response to short-term losses. Any adaptive control must be explicit, logged, versioned, and applied only through formal configuration changes.

## Architecture Handoff Notes

- Prefer a reusable game math package shared by simulation scripts and backend spin execution.
- Persist every game configuration version and store its ID on each spin record.
- Design the client integration so the backend returns reel stops, win breakdown, balance, free-spin state, jackpot state, and display metadata.
- Admin metric changes should use draft, simulate, approve, activate, and rollback states.
