# Story 3.2: Create Draft Configuration API

## Status

done

## Story

As a host, I want to create and edit draft Game Configurations, so that I can tune reel strips, paytable, scatter, jackpot, bet limits, prize caps, and budget settings.

## Acceptance Criteria

- Authorized operators can create, update, fetch, and list draft Game Configurations.
- Schema validation rejects malformed reel strips, paytables, scatter rules, jackpot rules, and limits.
- Each draft update records actor, timestamp, and reason where supplied.
- Unauthorized users cannot create or edit drafts.
- Drafts are isolated from the active config and cannot affect live spins.

## Dev Notes

- Admin draft endpoints use a temporary header-based admin adapter until Epic 5 provides durable admin auth. `x-admin-role: operator` is required for writes; `operator`, `support`, and `viewer` can read.
- Draft writes are routed through `InMemoryGameConfigurationRepository`, which preserves `createdBy`, `updatedBy`, `createdAt`, `updatedAt`, and optional `reason` metadata.
- Live spins remain isolated because `SpinService` reads only `GameConfigurationProvider.getActiveConfig()`, never draft records.
- Public API contract:
  - `POST /api/admin/configs/drafts` body `{ id, config, reason? }` returns `201` with `{ draft }`.
  - `PUT /api/admin/configs/drafts/:id` body `{ config, reason? }` returns `200` with `{ draft }`.
  - `GET /api/admin/configs/drafts/:id` returns `200` with `{ draft }` or `404 CONFIG_NOT_FOUND`.
  - `GET /api/admin/configs/drafts` returns `200` with `{ drafts }`.
  - All responses use the existing `{ data, error, requestId }` envelope.
  - Write errors include `ADMIN_UNAUTHORIZED`, `INVALID_CONFIG_DRAFT`, `CONFIG_NOT_FOUND`, `CONFIG_STATUS_CONFLICT`, and `CONFIG_VERSION_CONFLICT`.

## Review Evidence

- Acceptance tests: `apps/api/test/integration/admin-config-routes.test.ts`.
- Draft isolation test: `admin draft configs are ignored by the live spin endpoint`.
