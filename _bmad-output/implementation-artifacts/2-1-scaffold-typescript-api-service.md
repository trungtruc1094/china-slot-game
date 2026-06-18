---
baseline_commit: a0fd1a9
---

# Story 2.1: Scaffold TypeScript API Service

Status: done

<!-- Ultimate context engine analysis completed - comprehensive developer guide created -->

## Story

As a developer,
I want a TypeScript API service foundation,
so that backend gameplay endpoints can be implemented consistently.

## Acceptance Criteria

1. Given the architecture document, when the API service is scaffolded, then `apps/api` contains Express 5-compatible TypeScript app structure, strict TypeScript config, environment loading, request IDs, error handling, and test setup.
2. Health and readiness endpoints return stable API envelopes.
3. API responses use `{ data, error, requestId }`.
4. Errors use `{ code, message, details }`.
5. CI-ready scripts exist for typecheck and tests.

## Tasks / Subtasks

- [x] Create the API workspace package and strict TypeScript setup (AC: 1, 5)
  - [x] Add `apps/api/package.json`, `tsconfig.json`, and `tsconfig.build.json`.
  - [x] Wire the root workspace/scripts so a clean clone can run API build, test, lint, and typecheck from npm scripts.
  - [x] Pin TypeScript and API dependencies consistently with the architecture direction: Express 5, dotenv, helmet, cors, zod, Vitest, tsx.
- [x] Add Express app foundation (AC: 1, 2, 3, 4)
  - [x] Add `src/app.ts` and `src/main.ts`.
  - [x] Add environment loading in `src/config/env.ts`.
  - [x] Add request ID middleware that accepts `x-request-id` or creates a `req_` ID.
  - [x] Add error handling that always emits the stable envelope.
- [x] Add health/readiness API routes and contracts (AC: 2, 3, 4)
  - [x] Add `/api/health` and `/api/ready`.
  - [x] Use the envelope `{ data, error, requestId }` for success and failure.
  - [x] Use error objects shaped as `{ code, message, details }`.
- [x] Add tests proving the service contract (AC: 1-5)
  - [x] Test environment parsing and invalid ports.
  - [x] Test health and readiness envelopes.
  - [x] Test missing-route error envelopes.
  - [x] Ensure tests run through `npm test`.
- [x] Preserve quality gates and documentation (AC: 1-5)
  - [x] Add this story's public API contract to Dev Notes.
  - [x] Add short "how to run" instructions to Dev Notes.
  - [x] Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.

## Dev Notes

### Business and Epic Context

- Epic 2 starts the server-authoritative player spin flow: sessions, backend-owned wallet, authoritative spins, retry safety, and Phaser integration. [Source: `_bmad-output/planning-artifacts/epics.md`]
- This story only scaffolds the API foundation. Do not implement sessions, wallet, spin resolution, persistence, rate limits, or game config activation here.

### Architecture Guardrails

- Use `apps/api` for the TypeScript backend. API route handlers live in `apps/api/src/routes`; domain services will later live in `apps/api/src/domain`; repositories in `apps/api/src/repositories`; schemas in `apps/api/src/schemas`. [Source: `_bmad-output/planning-artifacts/architecture.md`]
- Use REST JSON with stable response envelopes. All route responses must include `data`, `error`, and `requestId`. [Source: `_bmad-output/planning-artifacts/architecture.md`]
- Error objects must include `code`, `message`, and `details`. Error codes use SCREAMING_SNAKE_CASE. [Source: `_bmad-output/planning-artifacts/architecture.md`]
- Keep all client input untrusted. This story establishes validation/error patterns but does not add reward-bearing endpoints yet.

### Public API Contract

`GET /api/health`

- Request: no body. Optional `x-request-id` header.
- Success `200`: `{ data: { status: "ok", service: "china-slot-api" }, error: null, requestId }`.
- Error cases: standard envelope for unexpected server errors.

`GET /api/ready`

- Request: no body. Optional `x-request-id` header.
- Success `200`: `{ data: { status: "ok", service: "china-slot-api", dependencies: { api: "ready" } }, error: null, requestId }`.
- Error cases: standard envelope for unexpected server errors.

Missing route

- Error `404`: `{ data: null, error: { code: "ROUTE_NOT_FOUND", message, details: { method, path } }, requestId }`.

### How To Run

- Install from a clean clone: `npm install`.
- Start the API in development: `npm run dev --workspace @china-slot-game/api`.
- Run all tests: `npm test`.
- Run API-only tests: `npm run test --workspace @china-slot-game/api`.
- Run all type checks: `npm run typecheck`.
- Build all workspaces: `npm run build`.

### Testing Requirements

- Tests must run under `npm test`, not only workspace-local commands.
- Cover health, readiness, request ID propagation/generation, and error envelope shape.
- Run lint/typecheck separately if lint is not part of `npm test`.

### Previous Story Intelligence

- Story 1.5 completed the deterministic game math foundation and kept it isolated from Express, database, browser, Phaser, and `server_examples`.
- Reuse `packages/game-math` in later spin stories; do not duplicate payout or ways logic in the API scaffold.

### Project Structure Notes

Do add:

- `apps/api/package.json`
- `apps/api/tsconfig.json`
- `apps/api/tsconfig.build.json`
- `apps/api/src/app.ts`
- `apps/api/src/main.ts`
- `apps/api/src/config/env.ts`
- `apps/api/src/middleware/request-id.ts`
- `apps/api/src/middleware/error-handler.ts`
- `apps/api/src/routes/health.routes.ts`
- `apps/api/src/schemas/api-envelope.ts`
- `apps/api/test/**`

Do not update:

- `js/*`
- `server_examples/*`
- `packages/game-math/src/*`
- database migrations

### References

- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/project-context.md`
- `_bmad-output/implementation-artifacts/1-5-build-seeded-simulation-runner.md`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

### Completion Notes List

- Added an `apps/api` npm workspace with Express 5, strict TypeScript, Vitest, environment loading, and dev/build/test/typecheck/lint scripts.
- Added request ID propagation/generation and a shared API envelope helper for success and error responses.
- Added `/api/health`, `/api/ready`, and missing-route handling with stable `{ data, error, requestId }` envelopes.
- Added integration and unit tests that run through root `npm test`.
- Verified `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
- Addressed code review findings: malformed JSON now returns a `400` API envelope with request ID, `PORT` parsing rejects partial/out-of-range integers, incoming request IDs are bounded to a safe character set/length, and `ApiError.details` is required by the shared schema/type.
- Re-verified `npm run lint && npm run typecheck && npm test && npm run build` after review fixes.

### File List

- `_bmad-output/implementation-artifacts/2-1-scaffold-typescript-api-service.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/package.json`
- `apps/api/tsconfig.json`
- `apps/api/tsconfig.build.json`
- `apps/api/src/app.ts`
- `apps/api/src/main.ts`
- `apps/api/src/config/env.ts`
- `apps/api/src/middleware/error-handler.ts`
- `apps/api/src/middleware/request-id.ts`
- `apps/api/src/routes/health.routes.ts`
- `apps/api/src/schemas/api-envelope.ts`
- `apps/api/test/integration/health-routes.test.ts`
- `apps/api/test/unit/env.test.ts`
- `package-lock.json`
- `package.json`
