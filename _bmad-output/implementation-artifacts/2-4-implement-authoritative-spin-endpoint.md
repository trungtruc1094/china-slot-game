---
baseline_commit: cfa8985
---

# Story 2.4: Implement Authoritative Spin Endpoint

Status: done

## Story

As a player,
I want to place a valid spin and receive a backend-approved result,
so that the game can be played fairly and consistently.

## Acceptance Criteria

1. Given an authenticated session, active configuration, sufficient balance, and valid wager, when the client calls `POST /api/spins`, then the backend validates the wager, resolves RNG/reel stops through the game math package, calculates payout, updates balance, and records a spin ledger entry.
2. Invalid bets, inactive sessions, missing active config, or insufficient balance are rejected without mutating balance.
3. The response includes spin ID, reel stops, visible symbols, win breakdown, wager, payout, balance after, free-spin state, jackpot state, and config version ID.
4. Spin ledger, balance transaction, and balance update commit in one transaction-equivalent service path for this in-memory slice.
5. Server is the sole source of truth; client-provided RNG, outcome, payout, or reel stop fields are ignored or rejected.
6. Tests assert a manipulated client payload cannot change the outcome.

## Tasks / Subtasks

- [x] Add spin request/response schemas and public API contract (AC: 1-6)
- [x] Implement authoritative spin service using `@china-slot-game/game-math` (AC: 1, 3, 5)
- [x] Wire `POST /api/spins` into the Express app with shared session and wallet services (AC: 1-6)
- [x] Add tests for success, invalid wager, inactive session, insufficient balance, and manipulated payloads (AC: 1-6)
- [x] Run lint, typecheck, tests, and build.

## Dev Notes

### Public API Contract

`POST /api/spins`

- Request body: `{ "sessionId": "sess_1", "wager": { "lineBet": 1, "selectedWays": 243, "totalWager": 243 } }`
- Client-provided `rng`, `reelStops`, `visibleWindow`, `winBreakdown`, `payout`, `balance`, or `outcome` fields are ignored by schema parsing and never enter spin resolution.
- Success `200`: `{ data: { spinId, reelStops, visibleWindow, winBreakdown, wager, payout, balanceAfter, freeSpinState, jackpotState, configVersionId }, error: null, requestId }`.
- Error `400 INVALID_WAGER`: wager shape, selected ways, or limits are invalid.
- Error `401 INVALID_SESSION` / `401 SESSION_EXPIRED`: session is missing or inactive.
- Error `409 INSUFFICIENT_BALANCE`: wallet cannot cover wager.
- Error `503 ACTIVE_CONFIG_MISSING`: no active game configuration is available.

### Story-Specific Assumptions

- Active config is injected into the app for now and defaults to the current client math config copied into API test fixtures; Story 3 will replace this with persisted active configuration.
- The in-memory spin ledger records only accepted spins.
- This story performs wager debit and payout credit through the wallet service. The in-memory rollback hook restores wallet and ledger state if ledger commit fails.
- Idempotency by `clientSpinId` is intentionally deferred to Story 2.5.

### Testing Requirements

- Tests must run under root `npm test`.
- Required coverage: valid spin, invalid wager, inactive session, insufficient balance without mutation, and manipulated client outcome fields not affecting backend outcome.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm run lint && npm run typecheck && npm test && npm run build`

### Completion Notes List

- Added `POST /api/spins` schema and route with stable API envelopes.
- Added `SpinService` that validates session and wager, samples reel stops server-side, resolves visible windows and wins through `@china-slot-game/game-math`, applies wallet debit/credit batch updates, and records an in-memory accepted spin ledger.
- Added wallet batch commit callback so ledger append failures roll back wallet balance/transaction updates.
- Added test active configuration and integration tests for successful authoritative spins including `visibleWindow`/`winBreakdown`, spin ledger entry, wallet debit/credit transactions, invalid wager rejection without balance mutation, expired sessions without balance mutation, missing active config without ledger/balance mutation, insufficient balance without mutation, ledger failure wallet rollback/no-ledger assertions, and manipulated client outcome fields being ignored.
- Kept public spin response aligned to the story contract: no client-facing `rng` or undocumented `totalPayout`; response uses documented `payout`.
- Added API workspace dependency on `@china-slot-game/game-math`.
- Verified `npm run lint && npm run typecheck && npm test && npm run build`.
- Final focused re-review returned no findings after transaction-equivalent rollback and success ledger coverage fixes.
- Re-verified `npm test && npm run build` before marking done.

### File List

- `_bmad-output/implementation-artifacts/2-4-implement-authoritative-spin-endpoint.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/package.json`
- `package-lock.json`
- `apps/api/src/app.ts`
- `apps/api/src/domain/session-service.ts`
- `apps/api/src/domain/spin-service.ts`
- `apps/api/src/domain/wallet-service.ts`
- `apps/api/src/routes/spins.routes.ts`
- `apps/api/src/schemas/spin.schema.ts`
- `apps/api/test/fixtures/simple-config.ts`
- `apps/api/test/integration/spins-routes.test.ts`
