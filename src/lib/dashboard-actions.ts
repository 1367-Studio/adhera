import { prisma } from "@/lib/prisma/client"
import { hasAccess, type ResolvedPermissions } from "@/lib/permissions"
import type { AssocModules } from "@/lib/modules"
import { nextAmountDue } from "@/lib/cotisation-status"

// Buckets mirror the ticket's required row ordering (FORM-119) — "En retard" always first,
// "À venir" always last, regardless of registration order below.
export type DashboardActionBucket = "EN_RETARD" | "A_TRAITER" | "A_VENIR"

// A string identifier, not the Icon component itself — this type crosses an API boundary
// (NextResponse.json() in the route), and a React component reference silently vanishes
// under JSON.stringify (it serializes a function to nothing), which would leave
// `row.icon === undefined` on the client. The client maps this back to a component — see
// ICONS in actions-todo-panel.tsx.
export type DashboardActionIconKey = "bell" | "user-plus" | "receipt"

export type DashboardActionRow = {
  // Stable id, also the snooze key — never reused for a different meaning, since a stored
  // snooze is only ever matched back against this string.
  key:         string
  bucket:      DashboardActionBucket
  count:       number
  // Present only when "amount remaining" is relevant (absent for e.g. adhésions à valider).
  amount?:     number
  href:        string
  actionLabel: "voirEtRelancer" | "examiner" | "consulter"
  icon:        DashboardActionIconKey
}

export type DashboardActionCtx = {
  associationId: string
  permissions:   ResolvedPermissions
  modules:       AssocModules
  // actionKey -> ISO snoozedUntil, from User.dashboardActionSnoozes.
  snoozed:       Record<string, string>
  now:           Date
}

type RowBuilder = (ctx: DashboardActionCtx) => Promise<DashboardActionRow | null>

export function isRowSnoozed(key: string, snoozed: Record<string, string>, now: Date): boolean {
  const until = snoozed[key]
  return !!until && new Date(until) > now
}

async function buildCotisationsEnRetardRow(ctx: DashboardActionCtx): Promise<DashboardActionRow | null> {
  if (!ctx.modules.cotisations || !hasAccess(ctx.permissions, "adhesions", "read")) return null

  const where = { associationId: ctx.associationId, status: "EN_RETARD" as const, membre: { deletedAt: null } }

  // Split by whether an installment schedule applies: the common case (no installments) is
  // just amount - amountPaid, summed server-side by Postgres — no need to pull every row's
  // decimals across the wire for that. Only the installment-plan minority (rare — a schedule
  // is an opt-in checkout feature) needs nextAmountDue()'s per-row walk, which does need the
  // full rows. An association with thousands of simple late cotisations stays cheap either way.
  const [simpleCount, simpleSum, withInstallments] = await Promise.all([
    prisma.cotisation.count({ where: { ...where, installments: { none: {} } } }),
    prisma.cotisation.aggregate({
      where: { ...where, installments: { none: {} } },
      _sum:  { amount: true, amountPaid: true },
    }),
    prisma.cotisation.findMany({
      where:  { ...where, installments: { some: {} } },
      select: { amount: true, amountPaid: true, installments: { select: { amount: true, dueDate: true, order: true } } },
    }),
  ])

  const count = simpleCount + withInstallments.length
  if (count === 0) return null

  const simpleAmount = Number(simpleSum._sum.amount ?? 0) - Number(simpleSum._sum.amountPaid ?? 0)
  const installmentAmount = withInstallments.reduce((sum, c) => sum + nextAmountDue({
    amount:       Number(c.amount),
    amountPaid:   Number(c.amountPaid),
    installments: c.installments.map(i => ({ amount: Number(i.amount), dueDate: i.dueDate, order: i.order })),
  }), 0)

  return {
    key:         "cotisations-en-retard",
    bucket:      "EN_RETARD",
    count,
    amount:      simpleAmount + installmentAmount,
    // `from=actions-todo` flashes the matched rows on arrival — see useActionsTodoHighlight.
    href:        "/dashboard/cotisations?status=EN_RETARD&from=actions-todo",
    actionLabel: "voirEtRelancer",
    icon:        "bell",
  }
}

async function buildAdhesionsAValiderRow(ctx: DashboardActionCtx): Promise<DashboardActionRow | null> {
  if (!hasAccess(ctx.permissions, "adhesions", "read")) return null

  const count = await prisma.membre.count({
    where: { associationId: ctx.associationId, deletedAt: null, status: "PENDING" },
  })
  if (count === 0) return null

  return {
    key:         "adhesions-a-valider",
    bucket:      "A_TRAITER",
    count,
    href:        "/dashboard/membres?status=PENDING&from=actions-todo",
    actionLabel: "examiner",
    icon:        "user-plus",
  }
}

async function buildChequesATraiterRow(ctx: DashboardActionCtx): Promise<DashboardActionRow | null> {
  if (!ctx.modules.dons || !hasAccess(ctx.permissions, "dons", "read")) return null

  const count = await prisma.don.count({
    where: { associationId: ctx.associationId, paidAt: null, paymentMethod: "CHEQUE" },
  })
  if (count === 0) return null

  return {
    key:         "cheques-a-traiter",
    bucket:      "A_TRAITER",
    count,
    href:        "/dashboard/dons?pendingOnly=true&pendingMethod=CHEQUE&from=actions-todo",
    actionLabel: "consulter",
    icon:        "receipt",
  }
}

// The one place a new row type is registered — adding a future action (paiements échoués,
// renouvellements, notes de frais, …) is a new builder function plus one line here, nothing
// else in this module changes. Order here is just enumeration order for Promise.all; actual
// render order is decided by sortRows() below, by bucket.
export const DASHBOARD_ACTION_BUILDERS: RowBuilder[] = [
  buildCotisationsEnRetardRow,
  buildAdhesionsAValiderRow,
  buildChequesATraiterRow,
]

const BUCKET_ORDER: DashboardActionBucket[] = ["EN_RETARD", "A_TRAITER", "A_VENIR"]

export function sortRows(rows: DashboardActionRow[]): DashboardActionRow[] {
  return [...rows].sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket))
}

// Defensive parse, same convention as parseDashboardLayout()/parseModules() — never trust a
// stored or incoming JSON value directly.
export function parseDashboardActionSnoozes(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && !Number.isNaN(new Date(value).getTime())) result[key] = value
  }
  return result
}
