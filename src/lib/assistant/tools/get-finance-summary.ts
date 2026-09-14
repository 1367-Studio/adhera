import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { dayFloorUTC } from "@/lib/finance/exercice"
import { openInvoiceTotals } from "@/lib/assistant/tools/invoice-totals"
import { currentCotisationYear } from "@/lib/membre-adherent"
import { runToolSafely, toEuros, toIsoDate } from "@/lib/assistant/tool-result"
import type { ToolContext } from "@/lib/assistant/types"

const TOOL_NAME = "get_finance_summary"

// A cotisation that still owes something — EN_RETARD is "pending, past due", not a separate
// bucket (same predicate as GET /api/dashboard).
const PENDING_COTISATION_STATUSES = ["EN_ATTENTE", "PARTIELLEMENT_PAYEE", "EN_RETARD"] as const
// Money already collected on cotisations not fully settled — counted as encaissé alongside
// the PAYE rows, exactly like the dashboard's cotisationsEncaissees.
const PARTIAL_COTISATION_STATUSES = ["PARTIELLEMENT_PAYEE", "EN_RETARD"] as const

function calendarYearWindow(year: number) {
  return { gte: new Date(`${year}-01-01`), lt: new Date(`${year + 1}-01-01`) }
}

// Sections a module switches off come back as null (not zeros) so the model says "module
// désactivé" rather than "0 €". Finance roles only — see buildTools.
export function getFinanceSummaryTool(context: ToolContext) {
  return betaZodTool({
    name:        TOOL_NAME,
    description:
      "Résumé financier de l'association pour une année civile. Appelle cet outil dès que la question porte sur la situation financière globale : " +
      "cotisations encaissées ou en attente, total des dons, recettes, dépenses et solde de l'année, factures ouvertes ou en retard, exercice comptable en cours. " +
      "Chaque section vaut null quand le module correspondant n'est pas activé. Pour le détail ligne par ligne, utilise list_cotisations, list_donations ou list_invoices.",
    inputSchema: z.object({
      year: z.number().int().min(2000).max(2100).optional().describe("Année civile (défaut : l'année en cours)"),
    }),
    run: (input) => runToolSafely(TOOL_NAME, async () => {
      const { associationId, modules, today } = context
      const year   = input.year ?? currentCotisationYear(today)
      const window = calendarYearWindow(year)

      const [pendingCotisations, paidCotisations, partialCotisations, donations, incomes, expenses, openFactures, exercice] = await Promise.all([
        modules.cotisations
          ? prisma.cotisation.aggregate({
              where:  { associationId, year, status: { in: [...PENDING_COTISATION_STATUSES] }, membre: { deletedAt: null } },
              _count: { id: true },
              _sum:   { amount: true, amountPaid: true },
            })
          : null,
        modules.cotisations
          ? prisma.cotisation.aggregate({
              where:  { associationId, year, status: "PAYE", membre: { deletedAt: null } },
              _count: { id: true },
              _sum:   { amount: true },
            })
          : null,
        modules.cotisations
          ? prisma.cotisation.aggregate({
              where: { associationId, year, status: { in: [...PARTIAL_COTISATION_STATUSES] }, membre: { deletedAt: null } },
              _sum:  { amountPaid: true },
            })
          : null,
        modules.dons
          ? prisma.don.aggregate({
              where:  { associationId, paidAt: window },
              _sum:   { amount: true },
              _count: { id: true },
            })
          : null,
        modules.finances
          ? prisma.income.aggregate({ where: { associationId, status: "PAID", date: window }, _sum: { amount: true } })
          : null,
        modules.finances
          ? prisma.expense.aggregate({ where: { associationId, status: "VALIDATED", date: window }, _sum: { amount: true } })
          : null,
        modules.factures ? openInvoiceTotals(associationId, today) : null,
        prisma.exerciceComptable.findFirst({
          where:  { associationId, startDate: { lte: dayFloorUTC(today) }, endDate: { gte: dayFloorUTC(today) } },
          select: { label: true, startDate: true, endDate: true, status: true },
        }),
      ])

      const facturesSummary = openFactures

      const incomesTotal  = incomes  ? toEuros(incomes._sum.amount)  : null
      const expensesTotal = expenses ? toEuros(expenses._sum.amount) : null

      return {
        year,
        cotisations: pendingCotisations && paidCotisations && partialCotisations
          ? {
              collectedAmount:  toEuros(paidCotisations._sum.amount) + toEuros(partialCotisations._sum.amountPaid),
              paidCount:        paidCotisations._count.id,
              pendingCount:     pendingCotisations._count.id,
              pendingRemaining: toEuros(pendingCotisations._sum.amount) - toEuros(pendingCotisations._sum.amountPaid),
            }
          : null,
        donations: donations
          ? { totalAmount: toEuros(donations._sum.amount), count: donations._count.id }
          : null,
        finances: incomesTotal !== null && expensesTotal !== null
          ? { incomes: incomesTotal, expenses: expensesTotal, solde: incomesTotal - expensesTotal }
          : null,
        factures: facturesSummary,
        exercice: exercice
          ? { label: exercice.label, startDate: toIsoDate(exercice.startDate), endDate: toIsoDate(exercice.endDate), status: exercice.status }
          : null,
      }
    }),
  })
}
