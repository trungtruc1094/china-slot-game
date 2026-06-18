---
baseline_commit: 99fb51d
---

# Story 2.2: Create Session and Player Identity Adapter

Status: done

<!-- Ultimate context engine analysis completed - comprehensive developer guide created -->

## Story

As a player,
I want to start or resume a game session,
so that reward-bearing spins can be tied to my backend identity and balance.

## Acceptance Criteria

1. Given a valid community/player identity payload, when the client calls `POST /api/sessions`, then the backend creates or resumes a session and returns session ID, player ID, balance, and safe session metadata.
2. Invalid identity payloads return recoverable API errors.
3. Expired session attempts return recoverable API errors.
4. The identity adapter is replaceable for future Discord, Telegram, email, or existing-account integrations.
5. Tests cover new session creation, resumed session lookup, session expiry, and unauthenticated access.

## Tasks / Subtasks

- [x] Add session API schemas and public contract (AC: 1-4)
  - [x] Define `POST /api/sessions` request and response schemas.
  - [x] Document request, response, and error cases in Dev Notes.
- [x] Implement replaceable player identity adapter (AC: 1, 2, 4)
  - [x] Add an adapter interface that maps untrusted community identity payloads to internal player records.
  - [x] Add an in-memory implementation for this sprint slice.
  - [x] Reject missing, malformed, or expired identity assertions with stable API errors.
- [x] Implement session lifecycle service (AC: 1, 3, 5)
  - [x] Create new sessions for valid first-time identities.
  - [x] Resume active sessions for the same identity.
  - [x] Expire sessions by clock-driven TTL and reject expired resume attempts.
  - [x] Return backend-owned starter balance metadata without accepting client balance.
- [x] Wire `POST /api/sessions` into the Express app (AC: 1-4)
  - [x] Use existing request IDs and API envelopes.
  - [x] Keep all recoverable failures as structured client errors.
- [x] Add tests for required lifecycle paths (AC: 1-5)
  - [x] Test create.
  - [x] Test lookup/resume.
  - [x] Test expire.
  - [x] Test unauthenticated access.
  - [x] Ensure these tests run through root `npm test`.

## Dev Notes

### Business and Epic Context

- Epic 2 establishes a server-authoritative spin flow. Sessions must exist before wallet and spin stories can safely attach balances and outcomes to a backend identity.
- This story does not implement wallet transactions, spin resolution, persistence, real auth providers, or database migrations. It creates the API/domain seam those later stories will replace with durable storage.

### Architecture Guardrails

- Use `apps/api/src/routes/sessions.routes.ts` for the session route, `apps/api/src/domain` for session/identity services, and `apps/api/src/schemas` for request/response schemas.
- Use REST JSON and the existing `{ data, error, requestId }` envelope from Story 2.1.
- Error objects must include `{ code, message, details }`.
- Treat the identity payload as untrusted input and validate it before domain logic.
- The exact player identity provider is deferred by architecture. Keep a provider-neutral adapter interface so Discord, Telegram, email, or account auth can replace the in-memory adapter later.
- Money-like values remain integer units. This story may expose a starter balance but must not accept client-provided balance values.

### Public API Contract

`POST /api/sessions`

- Request body:

```json
{
  "identity": {
    "provider": "demo",
    "subject": "player-123",
    "displayName": "Optional display name",
    "expiresAt": "2026-06-18T10:00:00.000Z"
  },
  "resumeSessionId": "optional existing session ID"
}
```

- Success `200`: existing active session resumed.
- Success `201`: new session created.
- Success envelope:

```json
{
  "data": {
    "sessionId": "sess_...",
    "playerId": "player_...",
    "balance": { "points": 1000 },
    "session": {
      "status": "active",
      "createdAt": "ISO-8601",
      "expiresAt": "ISO-8601",
      "resumed": false
    }
  },
  "error": null,
  "requestId": "req_..."
}
```

- Error `400 INVALID_IDENTITY`: missing or malformed identity payload.
- Error `401 UNAUTHENTICATED`: identity assertion is expired.
- Error `401 SESSION_EXPIRED`: `resumeSessionId` references an expired session.
- Error `404 SESSION_NOT_FOUND`: `resumeSessionId` does not belong to the resolved player.
- Error `400 INVALID_JSON_BODY`: inherited from Story 2.1 for malformed JSON.

### Story-Specific Assumptions

- Until a real auth provider and database exist, `provider` and `subject` together form the stable external identity key. They are stored as nested map keys, not a joined delimiter string, so identities such as `{ provider: "a", subject: "b:c" }` and `{ provider: "a:b", subject: "c" }` remain distinct.
- The in-memory adapter assigns deterministic internal player IDs for the lifetime of the Node process only. This is intentional scaffolding and must be replaced by a repository-backed adapter before production.
- Starter balance is `1000` integer points and is backend-owned; requests do not include or influence balance.
- Sessions use a one-hour TTL from creation. `expiresAt` in the identity payload represents the upstream assertion expiry and must be in the future.
- Resuming an existing session requires an explicit `resumeSessionId`; a valid identity without `resumeSessionId` starts a new session instead of implicitly attaching to an active session.

### Testing Requirements

- Tests must run under root `npm test`.
- Required coverage: create, lookup/resume, expire, unauthenticated/invalid identity access, malformed identity payloads, cross-player resume rejection, delimiter-collision identity isolation, and no implicit resume without `resumeSessionId`.
- Tests should use an injected clock so expiry behavior is deterministic.
- Also cover that client-provided balance fields are ignored.

### Previous Story Intelligence

- Story 2.1 established strict TypeScript, Express 5, request IDs before JSON parsing, structured API errors, and root scripts for lint/typecheck/test/build.
- Preserve the bounded request ID behavior and stable API envelopes.

### References

- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/project-context.md`
- `_bmad-output/implementation-artifacts/2-1-scaffold-typescript-api-service.md`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm run lint && npm run typecheck && npm test && npm run build`

### Completion Notes List

- Added `POST /api/sessions` with stable success/error envelopes and documented public contract.
- Added replaceable `PlayerIdentityAdapter` plus in-memory implementation for provider-neutral demo identity mapping.
- Added `SessionService` with deterministic clock injection, one-hour session TTL, explicit resume by `resumeSessionId`, explicit expired-session errors, and backend-owned starter point balance.
- Added integration tests for create, lookup/resume, expired resume, invalid/missing identity, expired identity, cross-player resume rejection, delimiter-collision identity isolation, no implicit resume, and ignoring client-provided balance.
- Verified `npm run lint && npm run typecheck && npm test && npm run build`.
- Focused re-review returned no findings after identity/session isolation fixes.
- Re-verified `npm test && npm run build` before marking done.

### File List

- `_bmad-output/implementation-artifacts/2-2-create-session-and-player-identity-adapter.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/src/app.ts`
- `apps/api/src/domain/player-identity.ts`
- `apps/api/src/domain/session-service.ts`
- `apps/api/src/routes/sessions.routes.ts`
- `apps/api/src/schemas/session.schema.ts`
- `apps/api/test/integration/sessions-routes.test.ts`
