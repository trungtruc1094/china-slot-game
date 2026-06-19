# Story 6.3: Add Observability and Request Tracing

Status: done
baseline_commit: f998dd33e989168438bdd5b300026d03a3225f4e

## Story

As an operator,
I want backend requests and spin operations traceable,
so that production issues can be diagnosed quickly.

## Acceptance Criteria

1. Every public API endpoint emits a trace record with a correlation ID.
2. Correlation ID is included in API responses and propagated from client through backend behavior.
3. A single spin can be linked across the spin endpoint trace, wallet transaction metadata, and unified audit event by correlation ID.
4. Logs/traces avoid sensitive player identity data.
5. Core metrics emitted per endpoint are documented.

## Tasks / Subtasks

- [x] Add request trace repository and middleware (AC: 1, 2, 4)
  - [x] Trace every `/api` request on response finish with method, path, status, latency, and correlation ID.
  - [x] Preserve existing `x-request-id` behavior as the correlation ID source.
- [x] Propagate correlation ID through spin and wallet/audit flows (AC: 2, 3)
  - [x] Include request/correlation ID in spin service inputs.
  - [x] Store correlation ID in spin wallet transaction metadata.
  - [x] Emit a unified audit event for accepted spins using the same correlation ID.
- [x] Document public contracts and metrics (AC: 1, 2, 5)
  - [x] Document request/response/error trace behavior.
  - [x] List metrics emitted per endpoint in Dev Notes.
- [x] Add tests and run gates (AC: all)
  - [x] Test public endpoints emit traces with correlation IDs.
  - [x] Test one spin links endpoint trace, wallet transaction, and audit event by correlation ID.
  - [x] Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.

## Dev Notes

- Binding Epic 5 retro finding: unified audit events are canonical for launch-readiness audit/search work.
- Previous story intelligence:
  - 6.1 added `reward-boundary` unified audit source and request-ID propagation for rejected reward requests.
  - 6.2 kept production client failures non-leaky; traces must not expose stack traces or sensitive identity values.
- Assumption: existing `x-request-id` is the MVP correlation ID; introducing a second correlation header would create drift.
- Public API contract:
  - Request: clients may send `x-request-id`; otherwise backend generates `req_<uuid>`.
  - Response: every API response includes the resolved request ID in the envelope and `x-request-id` response header.
  - Trace record: `{ correlationId, method, path, statusCode, latencyMs, outcome, occurredAt }`.
  - Error cases: failed requests still emit traces with non-2xx status and `outcome: failed`.
  - Sensitive data rule: trace records must not include identity provider, subject, displayName, session body, player identity payloads, or request bodies.
- Metrics emitted per endpoint:
  - All endpoints: request count, error count, latency milliseconds by method/path/status/outcome.
  - `POST /api/spins`: spin accepted/rejected count, wager/payout exposure through existing spin ledger and metrics services, correlation ID in wallet/audit metadata.
  - Admin/support endpoints: request count, error count, latency, unified audit event count where route already records audit events.
  - Alerts endpoints: request count, error count, latency, alert state through existing alert repository/services.
- Candidate implementation locations:
  - `apps/api/src/domain/request-trace-repository.ts`
  - `apps/api/src/middleware/request-tracing.ts`
  - `apps/api/src/routes/traces.routes.ts` for test/admin inspection if needed.
  - `apps/api/src/routes/spins.routes.ts` and `apps/api/src/domain/spin-service.ts` for correlation propagation.
  - `apps/api/test/integration/request-tracing.test.ts`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Red phase: `npm --workspace @china-slot-game/api test -- integration/request-tracing.test.ts` failed because request tracing module did not exist.
- Focused green phase: `npm --workspace @china-slot-game/api test -- integration/request-tracing.test.ts` passed 2 tests.
- Full quality gate: `npm test && npm run lint && npm run typecheck && npm run build` passed with 117 API tests and 37 game-math tests.
- Code review finding patched: browser client now generates and propagates `x-request-id` correlation IDs on `/api/sessions` and `/api/spins` requests.
- Final focused gate: `npm --workspace @china-slot-game/api test -- unit/server-client.test.ts integration/request-tracing.test.ts` passed 16 tests.
- Final quality gate: `npm test && npm run lint && npm run typecheck && npm run build` passed with 118 API tests and 37 game-math tests.

### Completion Notes List

- Added in-memory request trace repository and finish-time middleware for every `/api` request.
- Existing `x-request-id` is the correlation ID; generated IDs continue to flow through response headers and envelopes.
- Trace records include correlation ID, method, full `/api` path, status, latency, outcome, and timestamp without request body or identity data.
- Spin requests propagate correlation ID into wallet transaction metadata.
- Accepted spins emit unified audit events with source `spins`, action `spin.accepted`, and the same request/correlation ID.
- Browser production client requests now send generated `x-request-id` headers for session and spin calls.
- Integration tests prove one spin links endpoint trace, wallet transaction, and audit event by correlation ID.

### File List

- apps/api/src/app.ts
- apps/api/src/domain/admin-audit-repository.ts
- apps/api/src/domain/request-trace-repository.ts
- apps/api/src/domain/spin-service.ts
- apps/api/src/middleware/request-tracing.ts
- apps/api/src/routes/spins.routes.ts
- apps/api/test/integration/request-tracing.test.ts
- apps/api/test/unit/server-client.test.ts
- js/serverClient.js
- _bmad-output/implementation-artifacts/6-3-add-observability-and-request-tracing.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

### Change Log

- 2026-06-19: Created story context for implementation.
- 2026-06-19: Implemented request tracing, spin correlation propagation, and trace/audit/wallet linkage tests.
- 2026-06-19: Added browser client correlation ID propagation and marked story done after final gates.
