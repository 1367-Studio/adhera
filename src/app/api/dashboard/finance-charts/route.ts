import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { fetchModules } from "@/lib/auth/require-module"

const COTISATION_LABELS: Record<string, string> = {
  PAYE:       "Payées",
  EN_ATTENTE: "En attente",
  EXONERE:    "Exonérées",
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")
}

export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx
  const modules = await fetchModules(associationId)

  const now         = new Date()
  const year        = now.getFullYear()
  const yearStart   = new Date(`${year}-01-01`)
  const yearEnd     = new Date(`${year + 1}-01-01`)
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

  const [cotisationsByStatus, incomeByCategory, monthlyIncomes, monthlyExpenses] = await Promise.all([
    modules.cotisations
      ? prisma.cotisation.groupBy({
          by: ["status"],
          where: { associationId, year },
          _count: { _all: true },
          _sum:   { amount: true },
        })
      : Promise.resolve([]),

    modules.finances
      ? prisma.income.groupBy({
          by: ["categoryId"],
          where: { associationId, status: "PAID", date: { gte: yearStart, lt: yearEnd } },
          _sum: { amount: true },
        })
      : Promise.resolve([]),

    modules.finances
      ? prisma.income.findMany({
          where: { associationId, status: "PAID", date: { gte: sixMonthsAgo } },
          select: { amount: true, date: true },
        })
      : Promise.resolve([]),

    modules.finances
      ? prisma.expense.findMany({
          where: { associationId, status: "VALIDATED", date: { gte: sixMonthsAgo } },
          select: { amount: true, date: true },
        })
      : Promise.resolve([]),
  ])

  // Category names for the income breakdown — fetched separately since groupBy can't join.
  const categoryIds = incomeByCategory.map(c => c.categoryId).filter((id): id is string => !!id)
  const categories  = categoryIds.length
    ? await prisma.financeCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } })
    : []
  const categoryName = (id: string | null) => (id && categories.find(c => c.id === id)?.name) || "Non catégorisé"

  const incomeCategoryRows = incomeByCategory
    .map(c => ({ name: categoryName(c.categoryId), amount: Number(c._sum.amount ?? 0) }))
    .filter(c => c.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6)

  // Last 6 months, oldest first — Recettes vs Dépenses.
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    return { year: d.getFullYear(), month: d.getMonth(), label: monthLabel(d) }
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
      label:  COTISATION_LABELS[c.status] ?? c.status,
      count:  c._count._all,
      amount: Number(c._sum.amount ?? 0),
    }))
    .filter(c => c.count > 0)

  return NextResponse.json({
    year,
    hasCotisations: modules.cotisations && cotisations.length > 0,
    hasFinances:    modules.finances && (incomeCategoryRows.length > 0 || monthly.some(m => m.recettes > 0 || m.depenses > 0)),
    cotisations,
    monthly,
    incomeByCategory: incomeCategoryRows,
  })
})
