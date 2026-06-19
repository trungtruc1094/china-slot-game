# Story 5.1: Implement Admin Authentication and Roles

Status: done

## Story

As an operator,
I want admin features protected by role-based access,
So that only authorized people can view or change game operations.

## Acceptance Criteria

- Given an admin identity, when the admin accesses protected routes, then the backend verifies authentication and role permissions.
- `operator`, `support`, `viewer`, and future `admin` roles are supported.
- Unauthorized access returns stable API errors.
- Admin access attempts are logged where appropriate.

## Dev Notes

- Roles are explicit: `admin`, `operator`, `support`, and `viewer`.
- `admin` is a future superuser role and is authorized for every admin route guarded by the shared adapter.
- Header-based auth remains scaffolding for Epic 5: `x-admin-role` carries role and `x-admin-actor` carries actor identity.
- Assumption: support and viewer can read operational data, operator can mutate operational configuration, and admin can perform every protected action.
- Public API contract:
  - Request authentication headers: `x-admin-role: admin|operator|support|viewer`, optional `x-admin-actor`.
  - Success: existing admin route response envelopes are unchanged.
  - Unauthenticated or invalid role: HTTP 401 with `ADMIN_UNAUTHENTICATED`.
  - Authenticated but unauthorized role: HTTP 403 with `ADMIN_FORBIDDEN`.
- Audit-schema impact: no unified audit event schema is introduced in 5.1. Admin access attempts remain covered by route-level API errors; unified event emission is reserved for 5.4 per epic constraint.

## Review Evidence

- Tests cover each explicit role accessing an allowed endpoint.
- Tests cover non-admin roles rejected from a disallowed endpoint.
- Tests cover distinguishable unauthenticated and forbidden codes.
- Tests cover existing admin route groups rejecting missing roles.
