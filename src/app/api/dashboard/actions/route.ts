import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { fetchModules } from "@/lib/auth/require-module"
import {
  DASHBOARD_ACTION_BUILDERS, isRowSnoozed, parseDashboardActionSnoozes, sortRows,
  type DashboardActionRow,
} from "@/lib/dashboard-actions"

export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const [user, modules] = await Promise.all([
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { dashboardActionSnoozes: true } }),
    fetchModules(associationId),
  ])
  const snoozed = parseDashboardActionSnoozes(user?.dashboardActionSnoozes)
  const now = new Date()

  const builderCtx = { associationId, permissions: ctx.permissions, modules, snoozed, now }
  const built = await Promise.all(DASHBOARD_ACTION_BUILDERS.map(build => build(builderCtx)))
  const actionable = built.filter((row): row is DashboardActionRow => row !== null)

  // Number of visible categories, not the sum of their dossier counts — the ticket's own
  // example: 4 cotisations en retard + 3 adhésions à valider is a badge of 2, not 7.
  const rows = sortRows(actionable.filter(row => !isRowSnoozed(row.key, snoozed, now)))

  // Still-actionable rows that are currently hidden by a "Reporter" — surfaced separately so
  // the panel can show what's been postponed and let the user cancel it early, instead of a
  // snooze being a one-way, invisible action. count/amount here are freshly recomputed, not
  // frozen at snooze time, so a category that grew while snoozed shows its real current size.
  const snoozedRows = actionable
    .filter(row => isRowSnoozed(row.key, snoozed, now))
    .map(row => ({ ...row, snoozedUntil: snoozed[row.key] }))

  return NextResponse.json({ rows, badgeCount: rows.length, snoozedRows })
}, { area: "dashboard" })
