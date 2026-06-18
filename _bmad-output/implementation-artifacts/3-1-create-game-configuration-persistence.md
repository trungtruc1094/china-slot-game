# Story 3.1: Create Game Configuration Persistence

## Status

done

## Story

As a host, I want draft and active game configurations stored separately, so that edits cannot accidentally change live play.

## Acceptance Criteria

- Draft configurations and immutable active configuration versions are stored with IDs, status, actor, timestamps, and metadata.
- Every active configuration has a unique configuration version.
- Draft configurations cannot be selected by the spin endpoint.
- Tests cover draft creation, draft update, activation immutability, active config lookup, create/read/list/version bump, and DB-level integrity constraints.

## Dev Notes

- Persistence is modeled with PostgreSQL migration `apps/api/db/migrations/0001_game_configurations.sql`. The migration has reversible `up` and `down` sections.
- DB-level integrity is documented in the migration: status is constrained by `game_config_status`, active uniqueness is enforced by the partial unique index `game_config_versions_one_active`, status transitions are guarded by `enforce_game_config_status_transition()`, rollback may promote a retired version back to active, and activated configs must have `version_number` and `activated_at`.
- Runtime tests use `InMemoryGameConfigurationRepository` because this repo does not yet ship a Postgres test harness. The in-memory repository mirrors the migration constraints so acceptance tests can run in `npm test`.
- Drafts are never returned to live spins: `SpinService` reads through `GameConfigurationProvider.getActiveConfig()` and only receives active immutable versions.
- Public API/contract introduced for application code: `GameConfigurationProvider.getActiveConfig()` returns the active `GameConfiguration` or `undefined`; `InMemoryGameConfigurationRepository` methods throw `ApiHttpError` with `CONFIG_NOT_FOUND`, `CONFIG_STATUS_CONFLICT`, or `CONFIG_VERSION_CONFLICT` for invalid persistence operations.

## Review Evidence

- Acceptance tests: `apps/api/test/unit/game-configuration-repository.test.ts`, `apps/api/test/integration/spins-routes.test.ts`.
- Migration evidence: `apps/api/db/migrations/0001_game_configurations.sql` includes reversible SQL and database-level constraints for active uniqueness and valid status transitions.
