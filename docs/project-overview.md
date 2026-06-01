# China Slot Game Project Overview

This project is a Phaser-based browser slot game prototype with server-side implementation examples. It is being prepared for structured BMAD planning around new features, frontend/backend separation, and reward-economy controls.

## Current Runtime

- `index.html` loads Phaser and all game scripts.
- `js/slotConfig3x5.js` defines the active slot machine configuration.
- `js/slotGame.js` owns Phaser scene setup and spin flow.
- `js/slot_classes.js` owns reels, symbols, win detection, paylines/ways, player balance, slot controls, and jackpot state.
- `js/state_machine.js` owns spin, win, lose, auto-spin, and free-spin state transitions.

## Current Planning Artifacts

- Understand-Anything graph artifacts live under `.understand-anything/`.
- BMAD is installed under `_bmad/`.
- BMAD planning artifacts should live under `_bmad-output/planning-artifacts/`.
- BMAD implementation artifacts should live under `_bmad-output/implementation-artifacts/`.

## Product Evolution Target

The intended direction is a community mini game with controlled rewards. The production path should move outcome generation and balance mutation from the browser to a backend service.

Near-term development themes:

- Fix and verify current slot math.
- Build an RTP/probability calculator for configuration tuning.
- Define server-authoritative spin APIs.
- Persist spins, balance transactions, sessions, and RTP metrics.
- Integrate frontend animation with backend-approved outcomes.
- Add admin controls for budget, caps, RTP monitoring, and launch safety.
