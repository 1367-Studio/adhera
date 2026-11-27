import type { Prisma } from "@prisma/client"
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
export type DashboardActionIconKey = "bell" | "user-plus" | "receipt" | "package" | "bank" | "shopping-cart" | "invoice"

export type DashboardActionRow = {
  // Stable id, also the snooze key — never reused for a different meaning, since a stored
  // snooze is only ever matched back against this string.
  key:         string
  bucket:      DashboardActionBucket
  count:       number
  // Present only when "amount remaining" is relevant (absent for most categories).
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

// Deliberately NOT scoped to the current year, unlike the dashboard KPI tile that inspired
// this definition (src/app/api/dashboard/route.ts) — a cotisation left unpaid from a prior
// year is still owed, and scoping by year made it silently vanish from this panel (and from
// the KPI tile) the moment the calendar rolled over, hiding exactly the oldest, most overdue
// debt. The href below points at the oldest still-pending year so the one click that matters
// most (the longest-overdue cotisation) lands correctly; cotisations-view.tsx's own year
// selector still only shows one year at a time, so a backlog spanning several years needs a
// few clicks through its dropdown once there — a limit of that page, not fixed here.
async function buildCotisationsEnRetardRow(ctx: DashboardActionCtx): Promise<DashboardActionRow | null> {
  if (!ctx.modules.cotisations || !hasAccess(ctx.permissions, "adhesions", "read")) return null

  const where: Prisma.CotisationWhereInput = {
    associationId: ctx.associationId,
    status:        { in: ["EN_ATTENTE", "PARTIELLEMENT_PAYEE", "EN_RETARD"] },
    membre:        { deletedAt: null },
  }

  // Split by whether an installment schedule applies: the common case (no installments) is
  // just amount - amountPaid, summed server-side by Postgres — no need to pull every row's
  // decimals across the wire for that. Only the installment-plan minority (rare — a schedule
  // is an opt-in checkout feature) needs nextAmountDue()'s per-row walk, which does need the
  // full rows. An association with thousands of simple pending cotisations stays cheap either way.
  const [simpleCount, simpleSum, withInstallments, oldestPending] = await Promise.all([
    prisma.cotisation.count({ where: { ...where, installments: { none: {} } } }),
    prisma.cotisation.aggregate({
      where: { ...where, installments: { none: {} } },
      _sum:  { amount: true, amountPaid: true },
    }),
    prisma.cotisation.findMany({
      where:  { ...where, installments: { some: {} } },
      select: { amount: true, amountPaid: true, installments: { select: { amount: true, dueDate: true, order: true } } },
    }),
    prisma.cotisation.aggregate({ where, _min: { year: true } }),
  ])

  const count = simpleCount + withInstallments.length
  if (count === 0) return null

  const year = oldestPending._min.year ?? ctx.now.getFullYear()

  const simpleAmount = Number(simpleSum._sum.amount ?? 0) - Number(simpleSum._sum.amountPaid ?? 0)
  const installmentAmount = withInstallments.reduce((sum, c) => sum + nextAmountDue({
    amount:       Number(c.amount),
    amountPaid:   Number(c.amountPaid),
    installments: c.installments.map(i => ({ amount: Number(i.amount), dueDate: i.dueDate, order: i.order })),
  }), 0)

  return {
    key:         "cotisations-en-attente",
    bucket:      "EN_RETARD",
    count,
    amount:      simpleAmount + installmentAmount,
    // `from=actions-todo` flashes the matched rows on arrival — see useActionsTodoHighlight.
    // `year` lands on the oldest unpaid year (see this function's top comment), not whatever
    // year happens to be current.
    href:        `/dashboard/cotisations?status=EN_ATTENTE,PARTIELLEMENT_PAYEE,EN_RETARD&year=${year}&from=actions-todo`,
    actionLabel: "voirEtRelancer",
    icon:        "bell",
  }
}

async function buildMembresAValiderRow(ctx: DashboardActionCtx): Promise<DashboardActionRow | null> {
  if (!hasAccess(ctx.permissions, "adhesions", "read")) return null

  const count = await prisma.membre.count({
    where: { associationId: ctx.associationId, deletedAt: null, status: "PENDING" },
  })
  if (count === 0) return null

  return {
    key:         "membres-a-valider",
    bucket:      "A_TRAITER",
    count,
    href:        "/dashboard/membres?status=PENDING&from=actions-todo",
    actionLabel: "examiner",
    icon:        "user-plus",
  }
}

// Widened to every offline method (espèces/chèque/virement), not just chèque — same bucket
// the Dons page's own "en attente" table uses, and the same definition the dashboard KPI
// tile's donsEnAttenteCount already counts.
async function buildDonsAEncaisserRow(ctx: DashboardActionCtx): Promise<DashboardActionRow | null> {
  if (!ctx.modules.dons || !hasAccess(ctx.permissions, "dons", "read")) return null

  const where: Prisma.DonWhereInput = {
    associationId: ctx.associationId,
    paidAt:        null,
    paymentMethod: { in: ["ESPECES", "CHEQUE", "VIREMENT"] },
  }
  const result = await prisma.don.aggregate({ where, _count: { _all: true }, _sum: { amount: true } })
  const count = result._count._all
  if (count === 0) return null

  return {
    key:         "dons-a-encaisser",
    bucket:      "A_TRAITER",
    count,
    // Dons have no partial-payment concept (unlike Cotisation.amountPaid) — not yet
    // encaissé means the full amount is still outstanding (FORM-126).
    amount:      Number(result._sum.amount ?? 0),
    href:        "/dashboard/dons?tab=dons&from=actions-todo",
    actionLabel: "consulter",
    icon:        "receipt",
  }
}

// Same "overdue" definition as the per-item badge on the matériel page itself and the
// dashboard KPI tile's materielEnRetardCount (src/app/api/dashboard/route.ts).
async function buildMaterielEnRetardRow(ctx: DashboardActionCtx): Promise<DashboardActionRow | null> {
  if (!ctx.modules.materiel || !hasAccess(ctx.permissions, "materiel", "read")) return null

  const count = await prisma.materialLoan.count({
    where: {
      material:         { associationId: ctx.associationId },
      status:           "CONFIRME",
      returnedAt:       null,
      expectedReturnAt: { lt: ctx.now },
    },
  })
  if (count === 0) return null

  return {
    key:         "materiel-en-retard",
    bucket:      "EN_RETARD",
    count,
    href:        "/dashboard/materiel?overdue=1&from=actions-todo",
    actionLabel: "consulter",
    icon:        "package",
  }
}

async function buildRapprochementBancaireRow(ctx: DashboardActionCtx): Promise<DashboardActionRow | null> {
  if (!hasAccess(ctx.permissions, "comptabilite", "read")) return null

  const count = await prisma.bankTransaction.count({
    where: { bankAccount: { associationId: ctx.associationId }, status: "UNMATCHED" },
  })
  if (count === 0) return null

  return {
    key:         "rapprochement-bancaire",
    bucket:      "A_TRAITER",
    count,
    href:        "/dashboard/finances/conciliation?status=UNMATCHED&from=actions-todo",
    actionLabel: "consulter",
    icon:        "bank",
  }
}

// "À préparer" = payée, pas encore marquée préparée, et la préparation n'est pas déléguée à
// un tiers (requiresPreparation) — voir le commentaire sur BoutiqueCommande.requiresPreparation.
async function buildCommandesAPreparerRow(ctx: DashboardActionCtx): Promise<DashboardActionRow | null> {
  if (!ctx.modules.boutique || !hasAccess(ctx.permissions, "boutique", "read")) return null

  const count = await prisma.boutiqueCommande.count({
    where: { associationId: ctx.associationId, status: "PAID", requiresPreparation: true, preparedAt: null },
  })
  if (count === 0) return null

  return {
    key:         "commandes-a-preparer",
    bucket:      "A_TRAITER",
    count,
    href:        "/dashboard/boutique?tab=commandes&needsPreparation=1&from=actions-todo",
    actionLabel: "consulter",
    icon:        "shopping-cart",
  }
}

async function buildNotesDeFraisAValiderRow(ctx: DashboardActionCtx): Promise<DashboardActionRow | null> {
  if (!ctx.modules.reimbursements || !hasAccess(ctx.permissions, "reimbursements", "read")) return null

  const count = await prisma.reimbursementRequest.count({
    where: { associationId: ctx.associationId, status: "PENDING_APPROVAL" },
  })
  if (count === 0) return null

  return {
    key:         "notes-de-frais-a-valider",
    bucket:      "A_TRAITER",
    count,
    href:        "/dashboard/reimbursements?status=PENDING_APPROVAL&from=actions-todo",
    actionLabel: "examiner",
    icon:        "invoice",
  }
}

// The one place a new row type is registered — adding a future action is a new builder
// function plus one line here, nothing else in this module changes. Order here is just
// enumeration order for Promise.all; actual render order is decided by sortRows() below,
// by bucket.
export const DASHBOARD_ACTION_BUILDERS: RowBuilder[] = [
  buildCotisationsEnRetardRow,
  buildMaterielEnRetardRow,
  buildMembresAValiderRow,
  buildDonsAEncaisserRow,
  buildRapprochementBancaireRow,
  buildNotesDeFraisAValiderRow,
  buildCommandesAPreparerRow,
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
