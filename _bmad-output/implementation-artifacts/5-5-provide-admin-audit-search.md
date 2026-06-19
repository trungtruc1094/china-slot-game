# Story 5.5: Provide Admin Audit Search

Status: done

## Story

As an operator,
I want to search the audit trail,
So that configuration and operational decisions can be reviewed.

## Acceptance Criteria

- Given an authorized operator, when they search audit events, then they can filter by actor, action type, entity type, entity ID, date range, and request ID.
- Results show enough detail to understand what changed and why.
- Sensitive fields are redacted where needed.
- Unauthorized users cannot access audit search.

## Dev Notes

- Endpoint: `GET /api/admin/audit-events`.
- Data source: Story 5.4 unified `AdminAuditRepository` only. This endpoint must not query legacy config, operator-limit, alert, or budget-protection audit arrays.
- Allowed roles: `operator`, `support`, and `admin`; `viewer` receives HTTP 403.
- Query parameters:
  - `actor`, `action`, `resourceType`, `resourceId`, `requestId`, `source`: trimmed string filters.
  - `from`, `to`: offset-aware ISO datetimes; `from` must be before or equal to `to`.
  - `limit`: integer 1-100, default 25.
  - `offset`: integer >= 0, default 0.
- Response contract: `{ events, page }` in the standard envelope. `page` contains `limit`, `offset`, `total`, and `hasMore`.
- Error cases:
  - Missing or invalid admin role: `ADMIN_UNAUTHENTICATED` with HTTP 401.
  - Authenticated role without permission: `ADMIN_FORBIDDEN` with HTTP 403.
  - Malformed query: `INVALID_ADMIN_AUDIT_QUERY` with HTTP 400.
- Exposed fields: unified audit `id`, `occurredAt`, `actor`, `role`, `action`, `resource`, `requestId`, `reason`, `source`, `outcome`, `before`, `after`, and minimized `metadata`.
- Redacted / not exposed: identity provider, provider subject, session identity payload, idempotency keys, raw request bodies, and any fields already omitted by 5.4 event producers.
- Assumption: audit search is bounded JSON search only; export is out of scope until retention/export policy is finalized.
- Audit-schema impact: this story consumes the 5.4 unified schema only and adds no parallel audit event shape.

## Review Evidence

- Endpoint queries only the unified `AdminAuditRepository` from Story 5.4 and does not read legacy per-domain audit arrays.
- Tests cover multi-source results from at least two unified sources in one query.
- Tests cover filtering by actor, action, resource type, resource id, request id, source, and time range.
- Tests assert result pagination is bounded and reports `hasMore`.
- Tests assert malformed query parameters return HTTP 400.
- Tests assert `viewer` receives HTTP 403 and missing role receives HTTP 401.
- Full gate passed: `npm run lint && npm run typecheck && npm test && npm run build`.
