# Story 7.2: Persist Players, Provider Identity Mappings, and Sessions

Status: done
baseline_commit: 9c92882e3578d221ef1d6fe3fba615d3adc775c5

## Story

As a returning player,
I want my identity and active session to survive API restarts,
so that gameplay continuity does not depend on process memory.

## Acceptance Criteria

1. In PostgreSQL persistence mode, a valid identity start/resume persists a stable internal player record, provider plus subject mapping, session ID, status, created time, expiration time, and relevant request metadata.
2. Repeated session creation for the same provider subject returns the same internal player ID.
3. Resume succeeds only for the same resolved player and an unexpired persisted session.
4. Expired sessions are rejected for gameplay but remain searchable for support/audit use.
5. Restarting the API does not lose active unexpired sessions or make expired sessions active.
6. Tests cover new player creation, existing provider mapping reuse, session resume, session expiration, restart recovery, and support search filters.
7. Foreign keys are enforced at the DB level, with cascade or restrict behavior explicitly chosen and documented.
8. Session expiry is enforced via an `expires_at` column and PostgreSQL queries, not an in-memory timer.
9. Tests assert identity uniqueness across providers.

## Tasks / Subtasks

- [x] Add identity/session schema migration (AC: 1, 4, 7, 8)
  - [x] Add `players`, `provider_identity_mappings`, and `sessions` tables.
  - [x] Enforce provider identity uniqueness with a unique `(provider, subject)` constraint.
  - [x] Add explicit DB-level foreign keys with documented delete behavior.
  - [x] Add indexes for active session lookup and support search filters.
- [x] Add PostgreSQL session persistence implementation (AC: 1, 2, 3, 4, 5, 8)
  - [x] Resolve provider identities to stable player IDs durably.
  - [x] Create persisted sessions with status, timestamps, expiry, and request metadata.
  - [x] Resume only same-player unexpired sessions.
  - [x] Reject expired sessions through DB expiry checks and persist expired status.
  - [x] Keep existing in-memory session behavior available for local/test defaults.
- [x] Add support-search repository behavior (AC: 4, 6)
  - [x] Search sessions by player, provider identity, status, and time windows.
  - [x] Ensure expired sessions remain queryable.
- [x] Add PostgreSQL tests and run gates (AC: all)
  - [x] Test new player and mapping creation.
  - [x] Test same provider subject reuses the same player.
  - [x] Test same subject across different providers creates distinct players.
  - [x] Test session resume, cross-player resume rejection, expiry rejection, restart recovery, and support search.
  - [x] Run `npm test`, `npm run build`, and the PostgreSQL-backed integration test.

## Dev Notes

- Requirements: DP-FR1, DP-FR2, DP-FR12, DP-FR15, DP-NFR1, DP-NFR6, DP-NFR7, DP-AC1, DP-AC11, DP-AC12.
- Story-specific gate: foreign keys must be enforced at DB level; session expiry must be column/query-based; test must assert identity uniqueness across providers.
- Existing public session contract from Epic 2 must remain stable: `POST /api/sessions` returns the same envelope shape, `201` for new session, `200` for explicit resume, `SESSION_NOT_FOUND` for another player's session, `SESSION_EXPIRED` for expired sessions, and starter balance metadata remains non-cash points.
- Existing in-memory `SessionService` and `InMemoryPlayerIdentityAdapter` remain valid defaults until production dependency composition is wired later in epic 7.
- PostgreSQL implementation should use the 7-1 migration harness and `pg`; do not introduce an ORM.
- Delete behavior decision: use `ON DELETE RESTRICT`/default restrict semantics for identity/session foreign keys so player history, support search, and future wallet/spin references cannot be accidentally orphaned.
- Expiry decision: persisted sessions store `expires_at`; resume/gameplay checks query status plus `expires_at` against the injected clock time and mark expired rows as `expired` without relying on timers.
- Support search is repository-level in this story unless an existing admin endpoint already owns session search. Do not add broad admin UI/API surface unless needed for tests.

## Dev Agent Record

### Agent Model Used

GitHub Copilot

### Debug Log References

- `DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm run db:check -w @china-slot-game/api`
- `TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm run test:integration -w @china-slot-game/api`
- `npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm test && npm run build`
- `npm --workspace @china-slot-game/api run lint`
- `TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55432/china_slot_test npm --workspace @china-slot-game/api test -- test/unit/player-session-repository.test.ts test/postgres/player-session-repository.test.ts`

### Completion Notes List

- Added `0006_players_and_sessions.sql` with DB-level uniqueness, foreign keys, and query indexes for player identity mappings and sessions.
- Introduced an async player/session repository boundary while preserving existing in-memory defaults.
- Added `PostgresPlayerSessionRepository` for stable provider identity resolution, persisted session creation/resume, expiry-by-query, restart recovery, and support search.
- Added PostgreSQL integration tests for provider uniqueness across providers, same-provider reuse, cross-player resume rejection, expiry persistence/search, restart recovery, FK restrict behavior, and migration reversibility.
- Completed review follow-ups for concurrent provider identity resolution and provider/subject filtering in the in-memory support-search repository.
- Serialized API Vitest file execution so PostgreSQL schema-reset integration tests are reliable under `npm test`.

### File List

- `_bmad-output/implementation-artifacts/7-2-persist-players-provider-identity-mappings-and-sessions.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/db/migrations/0006_players_and_sessions.sql`
- `apps/api/package.json`
- `apps/api/src/domain/player-identity.ts`
- `apps/api/src/domain/session-service.ts`
- `apps/api/src/domain/spin-service.ts`
- `apps/api/src/routes/sessions.routes.ts`
- `apps/api/src/repositories/postgres/player-session-repository.ts`
- `apps/api/test/postgres/player-session-repository.test.ts`
- `apps/api/test/unit/player-session-repository.test.ts`
- `apps/api/test/postgres/migrations.test.ts`
- `apps/api/test/unit/db-runtime.test.ts`

### Change Log

- 2026-06-21: Created story context for implementation.
- 2026-06-21: Implemented PostgreSQL-backed player identity/session persistence and moved to review after green gates.
- 2026-06-21: Addressed review findings, reran focused and full quality gates, and marked done.

### Review Follow-Up Notes

- Fixed a concurrent same-provider identity race by recovering from the PostgreSQL unique constraint and returning the already-created mapping.
- Added in-memory support-search filtering for provider and subject so fallback/local behavior matches the PostgreSQL repository contract.
- Added regression tests for concurrent identity resolution and in-memory provider/subject search filters.
- Final verification passed: API lint, workspace typecheck, PostgreSQL-backed `npm test`, build, and dedicated PostgreSQL integration tests.