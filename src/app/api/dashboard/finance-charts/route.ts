import { NextResponse } from "next/server"
import { getLocale, getTranslations } from "next-intl/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { fetchModules } from "@/lib/auth/require-module"
import { hasAccess } from "@/lib/permissions"
import { type CategoryRow, resolveIncomeCategory } from "@/lib/finance/category-resolution"

function monthLabel(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { month: "short" }).replace(".", "")
}

// Area "dashboard" for the route itself: it feeds several home-page widgets. Each half is then
// gated on the area of the widget that renders it (see DASHBOARD_WIDGET_META) — the
// cotisations gauge on Adhésions, the recettes/dépenses charts on Comptabilité — so a user
// without Comptabilité gets empty finance series rather than the association's figures.
export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx
  const modules = await fetchModules(associationId)
  const canSeeCotisations = modules.cotisations && hasAccess(ctx.permissions, "adhesions", "read")
  const canSeeFinances    = modules.finances && hasAccess(ctx.permissions, "comptabilite", "read")
  const locale  = await getLocale()
  const t       = await getTranslations("dashboard.charts")

  const now         = new Date()
  const year        = now.getFullYear()
  const yearStart   = new Date(`${year}-01-01`)
  const yearEnd     = new Date(`${year + 1}-01-01`)
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

  const [cotisationsByStatus, incomeRowsForCategories, categories, monthlyIncomes, monthlyExpenses] = await Promise.all([
    // ANNULEE excluded — it was never really "collectable" for this year (consistent with
    // it being excluded from remaining-balance/pay-now displays elsewhere), and there's no
    // 6th validated categorical hue for it to render as here anyway (see finance-palette.ts).
    // membre.deletedAt: null mirrors /api/cotisations and the dashboard's own
    // cotisationsEnAttente tile — otherwise a soft-deleted member's row (of any status)
    // skews the gauge's percentages against a population the admin can't actually see.
    canSeeCotisations
      ? prisma.cotisation.groupBy({
          by: ["status"],
          where: { associationId, year, status: { not: "ANNULEE" }, membre: { deletedAt: null } },
          _count: { _all: true },
          _sum:   { amount: true },
        })
      : Promise.resolve([]),

    // A plain `groupBy(categoryId)` would miss every Income row whose category was never
    // written at creation time (e.g. a manual don encaissement or ticket payment) and only
    // resolves via its origin id (donId/participationId/commandeId/...) — see
    // resolveIncomeCategory in category-resolution.ts, the same logic the Compte de résultat
    // and Orçamento reports rely on so this chart agrees with them instead of dumping most of
    // the year's recettes into "Non catégorisé".
    canSeeFinances
      ? prisma.income.findMany({
          where: { associationId, status: "PAID", date: { gte: yearStart, lt: yearEnd } },
          select: {
            amount: true, categoryId: true, cotisationPaymentId: true, donId: true,
            commandeId: true, participationId: true, facturePaymentId: true, description: true,
          },
        })
      : Promise.resolve([]),

    canSeeFinances
      ? prisma.financeCategory.findMany({
          where:  { associationId },
          select: { id: true, key: true, name: true, accountingCode: true, section: true, isDefault: true, type: true },
        })
      : Promise.resolve([]),

    canSeeFinances
      ? prisma.income.findMany({
          where: { associationId, status: "PAID", date: { gte: sixMonthsAgo } },
          select: { amount: true, date: true },
        })
      : Promise.resolve([]),

    canSeeFinances
      ? prisma.expense.findMany({
          where: { associationId, status: "VALIDATED", date: { gte: sixMonthsAgo } },
          select: { amount: true, date: true },
        })
      : Promise.resolve([]),
  ])

  const categoriesById  = new Map(categories.map(c => [c.id, c as CategoryRow]))
  const categoriesByKey = new Map(categories.filter(c => c.key).map(c => [c.key as string, c as CategoryRow]))

  // Bucketed by a stable id, NOT by display name — two distinct categories can share the same
  // name (nothing stops a treasurer renaming a custom category to match another one's label),
  // and grouping by name would silently merge their amounts into one bar. Mirrors the
  // `mapKey` pattern in income-statement.ts's getOrCreateLine for the same reason.
  const incomeByCategoryId = new Map<string, { name: string; amount: number }>()
  for (const row of incomeRowsForCategories) {
    const resolved = resolveIncomeCategory(row, categoriesById, categoriesByKey)
    const bucketKey = resolved ? (resolved.categoryId ?? `virtual:${resolved.key}`) : "uncategorized"
    const name = resolved?.name ?? t("uncategorized")
    const existing = incomeByCategoryId.get(bucketKey)
    if (existing) existing.amount += Number(row.amount)
    else incomeByCategoryId.set(bucketKey, { name, amount: Number(row.amount) })
  }

  const incomeCategoryRows = Array.from(incomeByCategoryId.values())
    .filter(c => c.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6)

  // Last 6 months, oldest first — Recettes vs Dépenses.
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    return { year: d.getFullYear(), month: d.getMonth(), label: monthLabel(d, locale) }
  })
  const monthly = months.map(({ year: y, month: m, label }) => {
    const recettes = monthlyIncomes
      .filter(i => i.date.getFullYear() === y && i.date.getMonth() === m)
      .reduce((s, i) => s + Number(i.amount), 0)
    const depenses = monthlyExpenses
      .filter(e => e.date.getFullYear() === y && e.date.getMonth() === m)
      .reduce((s, e) => s + Number(e.amount), 0)
    return { label, recettes, depenses }
  })

  const cotisations = cotisationsByStatus
    .map(c => ({
      status: c.status,
      count:  c._count._all,
      amount: Number(c._sum.amount ?? 0),
    }))
    .filter(c => c.count > 0)

  return NextResponse.json({
    year,
    hasCotisations: canSeeCotisations && cotisations.length > 0,
    hasFinances:    canSeeFinances && (incomeCategoryRows.length > 0 || monthly.some(m => m.recettes > 0 || m.depenses > 0)),
    cotisations,
    monthly,
    incomeByCategory: incomeCategoryRows,
  })
}, { area: "dashboard" })
