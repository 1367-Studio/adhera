// Staff roles as the dashboard, its API routes and the assistant gate them. One owner: a role
// added here (or demoted from finance) changes the sidebar, the route allowlists and the
// assistant's tool set together. Server-safe (no React), unlike src/lib/user-context.tsx.
export const MANAGER_ROLES    = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"] as const
export const FINANCE_ROLES    = ["ADMIN", "PRESIDENT", "TRESORIER"] as const
export const PARAMETRES_ROLES = ["ADMIN", "PRESIDENT"] as const

export function isFinanceRole(role: string): boolean {
  return (FINANCE_ROLES as readonly string[]).includes(role)
}
