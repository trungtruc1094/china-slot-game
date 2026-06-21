# Story 7.7: Add Future Tevi Top-Up Idempotency Persistence

Status: done
baseline_commit: 1db96a3b66a48bc5f6dc6ce74633448aaeb9ab89

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a future Tevi integration developer,
I want durable provider top-up idempotency records available before webhook/top-up implementation,
so that later payment-like retries can be made safe before wallet crediting is introduced.

## Acceptance Criteria

1. A new reversible PostgreSQL migration adds future-ready provider top-up idempotency persistence without changing existing wallet, spin, player, session, operational, or client behavior.
2. The database can store provider name, provider event ID or token, normalized idempotency key, mapped player ID when known, status, amount/points metadata, raw provider metadata, first seen time, last seen time, completion time, and failure reason.
3. Durable uniqueness prevents two records for the same provider event/token and prevents duplicate normalized idempotency keys within the same provider.
4. Supported statuses are exactly `pending`, `completed`, `failed`, `ignored`, and `duplicate`, with database constraints protecting valid status transitions and completion/failure fields where feasible.
5. A domain repository contract supports create/reserve, read by provider event, read by normalized key, duplicate detection, mark completed, mark failed, mark ignored, and mark duplicate operations without crediting a wallet.
6. A PostgreSQL repository implements the contract using plain SQL and `pg`, returning stable camelCase domain records and preserving raw provider metadata as JSONB.
7. Duplicate create/reserve attempts are deterministic: same provider event/key can be detected and returned without side effects, while mismatched duplicate payloads cannot overwrite the original record.
8. Mapped player IDs reference existing `players(id)` when supplied, but unknown-player future events can still be recorded with a null player ID.
9. No Tevi SDK, Tevi identity adapter, webhook route, top-up processing service, wallet crediting, cash-out, redemption, transferable value, crypto, currency conversion, or real-money semantics are implemented in this story.
10. Tests cover migration up/down/up, migration version discovery, unique provider event enforcement, duplicate idempotency-key detection, status transitions, restart/reconstruction, nullable player mapping, and non-cash metadata language.

## Tasks / Subtasks

- [x] Add future top-up idempotency schema (AC: 1, 2, 3, 4, 8, 9, 10)
  - [x] Create `apps/api/db/migrations/0011_provider_top_up_idempotency.sql` with `-- migrate:up` and `-- migrate:down` sections.
  - [x] Add a status enum or equivalent constrained text field for `pending`, `completed`, `failed`, `ignored`, and `duplicate`.
  - [x] Add a `provider_top_up_idempotency_records` table, or an equivalently named provider-neutral table, with provider, provider event/token, normalized key, nullable `player_id`, status, metadata JSONB, first/last/completed timestamps, and failure reason.
  - [x] Add unique constraints for `(provider_name, provider_event_id)` and `(provider_name, normalized_idempotency_key)`.
  - [x] Add support indexes for provider/status/player/time lookups likely needed by Story 7.8 production composition and Story 7.9 verification.
- [x] Add domain repository contract (AC: 5, 7, 8, 9)
  - [x] Add a new domain file under `apps/api/src/domain/` for provider top-up idempotency types and repository interface.
  - [x] Keep naming provider-neutral where possible; Tevi should be a future provider value, not an SDK dependency or route surface.
  - [x] Model point-like metadata without using cash, redemption, real-money, or currency-conversion language.
  - [x] Ensure methods are async and repository-oriented, matching prior PostgreSQL interfaces.
- [x] Add PostgreSQL repository implementation (AC: 5, 6, 7, 8, 9)
  - [x] Add `PostgresProviderTopUpIdempotencyRepository` under `apps/api/src/repositories/postgres/` or a focused file in that folder.
  - [x] Use plain SQL with `pg`; do not add an ORM or new dependency.
  - [x] Preserve immutable original payload fields on duplicate attempts; status methods should update only the owned status/timestamp/failure fields.
  - [x] Do not call wallet repositories, `WalletService`, spin services, Tevi SDKs, or external network APIs.
- [x] Add PostgreSQL tests (AC: all)
  - [x] Update migration version expectations from `0010` to `0011` in migration tests.
  - [x] Add focused PostgreSQL repository tests for create/read, duplicate detection, status transitions, nullable player mapping, restart/reconstruction, and JSONB metadata round trips.
  - [x] Assert that metadata and domain names stay non-cash and future-facing.
- [x] Run gates and update BMAD status (AC: all)
  - [x] Run focused API typecheck and PostgreSQL tests for migrations and provider top-up idempotency.
  - [x] Run the full story gate: DB migrate/check, root lint, root typecheck, root tests, build, and API PostgreSQL integration tests.
  - [x] Record debug evidence, completion notes, file list, and mark the story ready for review after all tasks pass.

## Dev Notes

- Requirements: DP-FR11, DP-FR12, DP-FR17, DP-NFR1, DP-NFR6, DP-NFR8, DP-AC1, DP-AC13, DP-AC16.
- Story source: `_bmad-output/planning-artifacts/epics.md` Story 7.7.
- PRD source: `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/prd.md` compliance and non-goals sections; database persistence requirements in `_bmad-output/planning-artifacts/epics.md` DP-FR11/DP-AC13.
- Architecture source: `_bmad-output/planning-artifacts/architecture.md` Data Architecture, Implementation Patterns, and Database Persistence Architecture requirements.
- This story is scaffolding for a future Tevi Mini App integration only. It must not introduce runtime top-up behavior, webhook handlers, wallet credits, redemption, or cash-equivalent semantics.
- Story 7.8 owns production dependency composition. Add repository implementation and tests here, but do not wire production startup as part of this story unless a test-local import is needed.
- Story 7.9 owns end-to-end persistence verification after all repositories are composed.

### Existing Runtime Surfaces To Preserve

- Migrations are plain SQL files under `apps/api/db/migrations` with reversible `-- migrate:up` and `-- migrate:down` sections. Update `apps/api/test/unit/db-runtime.test.ts` and `apps/api/test/postgres/migrations.test.ts` when adding `0011`.
- PostgreSQL repository implementations live under `apps/api/src/repositories/postgres/` and use `pg` directly. Existing examples: `player-session-repository.ts`, `wallet-repository.ts`, `game-configuration-repository.ts`, `spin-service.ts`, and `operational-repositories.ts`.
- Multi-row state changes should use `withTransaction(pool, async client => ...)` from `apps/api/src/db/transactions.ts`.
- JSONB parameters should be passed as `JSON.stringify(value)` through the local `jsonParam` pattern used in existing PostgreSQL repositories, because `pg` can encode JavaScript arrays as PostgreSQL array literals otherwise.
- Values that look like balances, points, rewards, or amounts must remain integer units and must be described as non-cash internal points/metadata.

### Suggested Schema Shape

- Table: `provider_top_up_idempotency_records`.
- Columns:
  - `id text PRIMARY KEY`
  - `provider_name text NOT NULL`
  - `provider_event_id text NOT NULL`
  - `normalized_idempotency_key text NOT NULL`
  - `player_id text NULL REFERENCES players(id) ON DELETE RESTRICT`
  - `status provider_top_up_idempotency_status NOT NULL`
  - `point_amount bigint NULL`
  - `points_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb`
  - `provider_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb`
  - `first_seen_at timestamptz NOT NULL`
  - `last_seen_at timestamptz NOT NULL`
  - `completed_at timestamptz NULL`
  - `failure_reason text NULL`
- Constraints:
  - unique `(provider_name, provider_event_id)`
  - unique `(provider_name, normalized_idempotency_key)`
  - non-negative `point_amount` when present
  - `completed` requires `completed_at`
  - `failed` requires `failure_reason`
- Keep Tevi as data in `provider_name`; do not create Tevi-specific code paths.

### Previous Story Intelligence

- Story 7.6 added PostgreSQL operational repositories without production startup wiring, then documented that Story 7.8 owns composition. Follow that boundary here.
- Story 7.6 review found request/correlation ID collapse and async persistence hazards. For this story, keep identity fields explicit and avoid fire-and-forget writes entirely; repository methods should return awaited promises.
- Story 7.5 established durable idempotency patterns for spins using database uniqueness, status, stored response payloads, and restart-safe tests. Reuse the same persistence mindset, but do not reuse spin-specific tables or semantics.
- Recent commits: `1db96a3 feat(7-6): persist operational controls and traces`, `60ae0db feat(7-5): persist accepted spins and idempotency`, `1c12100 feat(7-4): persist wallets and wallet transactions`.

### Testing Guidance

- Focused test command:
  - `npm --workspace @china-slot-game/api run lint && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm --workspace @china-slot-game/api test -- test/postgres/migrations.test.ts test/postgres/provider-top-up-idempotency.test.ts`
- Full story gate:
  - `DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm test && npm run build && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run test:integration -w @china-slot-game/api`

### Project Structure Notes

- Expected new files:
  - `apps/api/db/migrations/0011_provider_top_up_idempotency.sql`
  - `apps/api/src/domain/provider-top-up-idempotency-repository.ts`
  - `apps/api/src/repositories/postgres/provider-top-up-idempotency-repository.ts`
  - `apps/api/test/postgres/provider-top-up-idempotency.test.ts`
- Expected modified files:
  - `apps/api/test/postgres/migrations.test.ts`
  - `apps/api/test/unit/db-runtime.test.ts`
  - `_bmad-output/implementation-artifacts/sprint-status.yaml`
  - this story file

## Dev Agent Record

### Agent Model Used

GitHub Copilot

### Debug Log References

- `npm --workspace @china-slot-game/api run lint && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm --workspace @china-slot-game/api test -- test/postgres/migrations.test.ts test/postgres/provider-top-up-idempotency.test.ts`
- `DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm test && npm run build && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run test:integration -w @china-slot-game/api`
- `npm --workspace @china-slot-game/api run lint && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm --workspace @china-slot-game/api test -- test/postgres/migrations.test.ts test/postgres/provider-top-up-idempotency.test.ts`
- `DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:migrate -w @china-slot-game/api && DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run db:check -w @china-slot-game/api && npm run lint && npm run typecheck && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm test && npm run build && TEST_DATABASE_URL=postgres://china_slot@127.0.0.1:55433/china_slot_test npm run test:integration -w @china-slot-game/api`

### Completion Notes List

- Added reversible migration `0011_provider_top_up_idempotency.sql` with provider-neutral future top-up idempotency records, uniqueness constraints, status checks, nullable player mapping, point metadata, and support indexes.
- Added domain repository types for provider top-up idempotency reservation, duplicate detection, reads, and terminal status transitions.
- Added `PostgresProviderTopUpIdempotencyRepository` using plain SQL and `pg`, with duplicate create-or-get behavior that preserves original payload fields.
- Added PostgreSQL integration coverage for migration discovery/up-down-up, reservation/read reconstruction, duplicate provider event/key detection, status transitions, nullable players, non-cash metadata, and no wallet transaction writes.
- Completed senior review follow-up by adding JSONB metadata merge coverage and defensive failure-reason validation.

### File List

- `_bmad-output/implementation-artifacts/7-7-add-future-tevi-top-up-idempotency-persistence.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/db/migrations/0011_provider_top_up_idempotency.sql`
- `apps/api/src/domain/provider-top-up-idempotency-repository.ts`
- `apps/api/src/repositories/postgres/provider-top-up-idempotency-repository.ts`
- `apps/api/test/postgres/migrations.test.ts`
- `apps/api/test/postgres/provider-top-up-idempotency.test.ts`
- `apps/api/test/unit/db-runtime.test.ts`

### Change Log

- 2026-06-21: Created story context for implementation.
- 2026-06-21: Implemented provider top-up idempotency persistence and moved to review after focused and full gates passed.
- 2026-06-21: Addressed review follow-up, reran focused and full gates, and marked done.

### Senior Developer Review (AI)

- Outcome: Approved after follow-up fixes.
- Review layers: focused Explore review over Story 7.7 changed files.
- Findings patched:
  - Added coverage for JSONB metadata merge behavior when completing a reserved provider top-up idempotency record.
  - Made failure-reason validation defensive before failed, ignored, or duplicate status updates.
- Scope review: No Tevi SDK, webhook route, wallet crediting, cash-out, redemption, transferable value, crypto, currency conversion, or real-money semantics were introduced.
