# Story 3.4: Run and Store Simulation Batches

## Status

done

## Story

As a host, I want to simulate a draft configuration, so that I can compare expected and observed behavior before launch.

## Acceptance Criteria

- The backend runs simulations for draft configurations that have a valid math report.
- Simulation parameters, seed, observed RTP, hit rate, volatility summary, largest win, total wagered, total paid, and confidence notes are stored.
- Simulation results do not mutate player balances or spin ledgers.
- Repeated simulation with the same seed and inputs is reproducible.
- Batch results are durably retrievable.

## Dev Notes

- Public API contract:
  - `POST /api/admin/configs/drafts/:id/simulations` body `{ spinCount, seed?, wager? }` returns `201` with `{ simulationRun }`.
  - `GET /api/admin/configs/drafts/:id/simulations/:runId` returns `200` with `{ simulationRun }`.
  - `GET /api/admin/configs/drafts/:id/simulations` returns `200` with `{ simulationRuns }`.
  - Errors include `ADMIN_UNAUTHORIZED`, `INVALID_SIMULATION_REQUEST`, `CONFIG_NOT_FOUND`, `MATH_REPORT_NOT_FOUND`, `CONFIG_MATH_REPORT_BLOCKED`, `SIMULATION_LIMIT_EXCEEDED`, and `SIMULATION_NOT_FOUND`.
- Resource limits chosen for this repo: maximum `spinCount` is 10,000 and maximum synchronous wall time is 1,000 ms. The cap bounds CPU and result-memory pressure while still allowing meaningful pre-launch smoke batches in the current single-process API.
- Simulation storage is in `InMemoryGameConfigurationRepository` until a Postgres harness is introduced. The contract is structured for direct persistence in the planned `simulation_runs` table.
- Simulations use `runSimulation()` from `@china-slot-game/game-math` with the attached report's theoretical RTP for confidence notes.
- Simulation runs never call wallet services or spin ledger writes.

## Review Evidence

- Acceptance tests: `apps/api/test/integration/admin-config-simulation-routes.test.ts`.
