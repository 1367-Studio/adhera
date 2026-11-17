// FORM-93 — access to the reimbursement module isn't decided by the "reimbursements" area
// permission alone (see src/lib/permissions.ts): any staff role can always create a request
// for themselves and view/edit their own draft/needs-correction requests, no matter their
// granted areas. The "reimbursements" area only gates "see/manage everyone's requests" — this
// is the per-record exception that pattern needs, so it lives in this dedicated file rather
// than permissions.ts/dashboard-access.ts, which only know about whole areas. Same posture as
// src/lib/grupos/access.ts's own per-record override.

import { hasAccess, type ResolvedPermissions } from "@/lib/permissions"

/** Can see every request, not just their own. */
export function canViewAllReimbursements(permissions: ResolvedPermissions): boolean {
  return hasAccess(permissions, "reimbursements", "read")
}

/** Can correct categories, approve/reject/request-correction, and register a reimbursement. */
export function canManageReimbursements(permissions: ResolvedPermissions): boolean {
  return hasAccess(permissions, "reimbursements", "edit")
}

/** Can read ONE request: it's their own, or they can view all. */
export function canReadReimbursement(
  permissions: ResolvedPermissions, userId: string, requesterId: string,
): boolean {
  return requesterId === userId || canViewAllReimbursements(permissions)
}

/**
 * Can approve/reject/request-correction on ONE request. "Nobody can approve their own
 * request, even with management permission, except an administrator" — the ticket's own
 * wording, enforced here rather than left to each route to remember.
 */
export function canApproveRequest(
  permissions: ResolvedPermissions, userId: string, requesterId: string,
): boolean {
  if (!canManageReimbursements(permissions)) return false
  return requesterId !== userId || permissions.administrator
}
