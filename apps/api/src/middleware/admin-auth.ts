import { ApiHttpError } from "./error-handler.js";

export type AdminRole = "admin" | "operator" | "support" | "viewer";

export interface AdminIdentity {
  actor: string;
  role: AdminRole;
}

const adminRoles: readonly AdminRole[] = ["admin", "operator", "support", "viewer"];

export function requireAdminRole(
  roleHeader: string | undefined,
  actorHeader: string | undefined,
  allowed: AdminRole[]
): AdminIdentity {
  const role = parseAdminRole(roleHeader);
  if (!role) {
    throw new ApiHttpError(401, {
      code: "ADMIN_UNAUTHENTICATED",
      message: "Admin authentication is required.",
      details: { acceptedRoles: adminRoles }
    });
  }

  if (!allowed.includes(role) && role !== "admin") {
    throw new ApiHttpError(403, {
      code: "ADMIN_FORBIDDEN",
      message: "Admin role is not authorized for this operation.",
      details: { requiredRoles: allowed, role }
    });
  }

  return {
    actor: actorHeader?.trim() || `${role}-system`,
    role
  };
}

function parseAdminRole(roleHeader: string | undefined): AdminRole | null {
  if (!roleHeader) {
    return null;
  }
  const normalizedRole = roleHeader.trim();
  return adminRoles.includes(normalizedRole as AdminRole)
    ? normalizedRole as AdminRole
    : null;
}
