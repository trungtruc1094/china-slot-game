---
baseline_commit: e6429c1
---

# Story 2.6: Integrate Phaser Client With Backend Spin Results

Status: done

## Story

As a player,
I want the Phaser game to use backend-authoritative spin results,
so that what I see in the client matches the server ledger and wallet.

## Acceptance Criteria

1. Given production mode is enabled, when the player starts a session and spins, then the client calls the backend session and spin APIs and animates to the returned reel stops.
2. The client displays backend-returned balance, win breakdown, free-spin state, jackpot state, and recoverable error states.
3. Production mode never runs authoritative RNG, payout calculation, or balance mutation in the client.
4. Network failure shows a pending, retry, or recovery state without silently running a local authoritative spin.
5. Local demo mode remains available and clearly distinguishable from backend production mode.

## Tasks / Subtasks

- [x] Add a browser-safe backend client adapter for session creation, spin submission, retry status, and backend-result normalization (AC: 1-5)
- [x] Wire production-mode Phaser spins to fetch backend outcomes before reel animation (AC: 1, 3-4)
- [x] Drive reel stop positions, displayed balance, win amount, free spins, and jackpot amount from backend fields in production mode (AC: 1-3)
- [x] Preserve demo mode as the default local flow that continues using existing client-side behavior (AC: 5)
- [x] Add tests proving production rendering cannot diverge from backend outcomes and that tests run through root `npm test` (AC: 1-5)

## Dev Notes

### Public API Contract

The client uses the existing backend contracts:

- `POST /api/sessions`
  - Request: `{ "identity": { "provider": "guest", "subject": "browser-local-id" } }`
  - Response data: `{ "sessionId": "sess_...", "playerId": "player_...", "expiresAt": "..." }`
  - Errors: malformed or missing identity returns `400 VALIDATION_ERROR`; unauthenticated or expired sessions are handled by the spin endpoint.
- `POST /api/spins`
  - Request: `{ "clientSpinId": "client-generated-id", "sessionId": "sess_...", "wager": { "lineBet": 1, "selectedWays": 243, "totalWager": 243 } }`
  - Response data includes `spinId`, `reelStops`, `visibleWindow`, `wager`, `payout`, `winBreakdown`, `balanceAfter`, `freeSpinState`, and `jackpotState`.
  - Errors: validation errors return `400`, unauthenticated/expired sessions return `401`, insufficient funds return `409 INSUFFICIENT_FUNDS`, idempotency conflicts return `409 IDEMPOTENCY_CONFLICT`, and transient network failures are surfaced as retryable client state.

### Story-Specific Assumptions

- Demo mode remains the default when no production flag is present, so static local play still works by opening `index.html`.
- Production mode is enabled with `window.CHINA_SLOT_MODE = "production"` or `?mode=production`; API base URL defaults to `window.CHINA_SLOT_API_BASE_URL` or the current origin.
- The existing backend returns zero-based `reelStops[].stopIndex` values that map directly to `Reel.spin(nextOrderPosition)`.
- The backend is the only authoritative source in production. The client may still run visual win-line highlighting, but displayed money, free-spin, jackpot, and reel-stop state must be assigned from the backend result.
- `payout` is the backend total payout and already includes jackpot wins; `jackpotState.awarded` is displayed as jackpot-state detail, not added to `payout`.
- The first integration uses guest identity stored in `localStorage` under `china-slot-player-identity` when available; if storage is unavailable, an in-memory browser identity is used for the page session.

### Testing Requirements

- Tests must run under root `npm test`.
- Required coverage: production render plans use only backend reel stops, payout, balance, free-spin, and jackpot fields even when a conflicting local/demo result is supplied; production network failures expose retry state; demo mode remains distinguishable and can use local outcomes.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm --workspace @china-slot-game/api run typecheck && npm --workspace @china-slot-game/api test`
- `npm run lint && npm run typecheck && npm test && npm run build`
- `npm test && npm run build`

### Completion Notes List

- Added `js/serverClient.js` as a classic-browser global adapter for production session creation, spin submission, retry state, backend result normalization, and render-plan selection.
- Production mode is enabled by `window.CHINA_SLOT_MODE = "production"` or `?mode=production`; demo mode remains the default and continues to use the legacy local spin path.
- Production spins wait for the backend response, animate reels to backend `reelStops`, and assign displayed win amount, balance, free spins, and jackpot state from backend fields.
- Guarded local pre-spin debits so production mode does not mutate the client balance before the backend wallet response.
- Added root-test-covered Vitest coverage that verifies session-before-spin request ordering, backend-only production render plans, retry state, and demo-mode distinction.
- Local review found and fixed a losing-spin display gap so backend `balanceAfter` is applied on both win and loss paths.
- Local review found and fixed jackpot double-count risk; displayed win amount now uses backend `payout` exactly.
- Verified `npm run lint && npm run typecheck && npm test && npm run build`.

### File List

- `_bmad-output/implementation-artifacts/2-6-integrate-phaser-client-with-backend-spin-results.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/test/unit/server-client.test.ts`
- `index.html`
- `js/serverClient.js`
- `js/state_machine.js`
- `js/slotGame.js`
