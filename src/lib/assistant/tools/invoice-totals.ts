import { prisma } from "@/lib/prisma/client"
import { dayFloorUTC } from "@/lib/finance/exercice"
import { toEuros } from "@/lib/assistant/tool-result"

export type OpenInvoiceTotals = { openCount: number; openAmount: number; overdueCount: number; overdueAmount: number }

// The two stored statuses an unpaid facture can carry; EN_RETARD is derived from dueDate
// (src/lib/facture-status.ts), so "overdue" is these statuses with a past due date and
// "open" is their complement — two aggregates in SQL instead of transferring every row.
const OPEN_FACTURE_STATUSES = ["EN_ATTENTE", "PARTIELLEMENT_PAYEE"] as const

export async function openInvoiceTotals(associationId: string, today: Date): Promise<OpenInvoiceTotals> {
  const todayStart = dayFloorUTC(today)
  const openWhere  = { associationId, deletedAt: null, status: { in: [...OPEN_FACTURE_STATUSES] } }

  const [overdue, open] = await Promise.all([
    prisma.facture.aggregate({
      where:  { ...openWhere, dueDate: { lt: todayStart } },
      _sum:   { total: true, amountPaid: true },
      _count: { id: true },
    }),
    prisma.facture.aggregate({
      where:  { ...openWhere, OR: [{ dueDate: null }, { dueDate: { gte: todayStart } }] },
      _sum:   { total: true, amountPaid: true },
      _count: { id: true },
    }),
  ])

  return {
    openCount:     open._count.id,
    openAmount:    toEuros(open._sum.total) - toEuros(open._sum.amountPaid),
    overdueCount:  overdue._count.id,
    overdueAmount: toEuros(overdue._sum.total) - toEuros(overdue._sum.amountPaid),
  }
}
