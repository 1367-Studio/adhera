import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { runToolSafely, toEuros, toIsoDate } from "@/lib/assistant/tool-result"
import type { ToolContext } from "@/lib/assistant/types"

const TOOL_NAME     = "list_donations"
const DEFAULT_LIMIT = 10
const MAX_LIMIT     = 25

// Mirrors GET /api/dons: encaissés only (paidAt set), calendar-year window on paidAt, totals
// over the whole window rather than the capped rows. `month` narrows the window further so
// "combien de dons ce mois-ci" reads the aggregate instead of counting truncated rows.
function paidAtWindow(year: number, month: number | undefined) {
  if (month === undefined) return { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) }
  return { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) }
}

function donorNameOf(don: { anonymous: boolean; donorType: string; companyName: string | null; firstName: string; lastName: string }): string {
  if (don.anonymous) return "Anonyme"
  if (don.donorType === "COMPANY" && don.companyName) return don.companyName
  return `${don.firstName} ${don.lastName}`
}

// Finance roles with the dons module only — see buildTools.
export function listDonationsTool(context: ToolContext) {
  return betaZodTool({
    name:        TOOL_NAME,
    description:
      "Liste les dons encaissés par l'association. Appelle cet outil dès que la question porte sur les dons : montant total des dons, " +
      "nombre de dons sur une période, derniers dons reçus, donateurs, reçus fiscaux émis. " +
      "Renvoie les dons les plus récents (date, montant, donateur ou « Anonyme », moyen de paiement, reçu émis ou non) " +
      "ainsi que totalAmount et totalCount calculés sur toute la période demandée, pas seulement sur les lignes renvoyées.",
    inputSchema: z.object({
      year:  z.number().int().min(2000).max(2100).optional().describe("Année civile d'encaissement (défaut : tous les dons encaissés, toutes années confondues)"),
      month: z.number().int().min(1).max(12).optional().describe("Mois (1 à 12) pour restreindre à un mois de l'année demandée ; ignoré sans year"),
      limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Nombre maximum de dons renvoyés (défaut ${DEFAULT_LIMIT}, maximum ${MAX_LIMIT})`),
    }),
    run: (input) => runToolSafely(TOOL_NAME, async () => {
      const { associationId } = context
      const limit = input.limit ?? DEFAULT_LIMIT

      const where = {
        associationId,
        paidAt: input.year !== undefined ? paidAtWindow(input.year, input.month) : { not: null },
      }

      const [rows, aggregate] = await Promise.all([
        prisma.don.findMany({
          where,
          orderBy: { paidAt: "desc" },
          take:    limit,
          select: {
            id: true, paidAt: true, amount: true, anonymous: true, donorType: true, companyName: true, firstName: true, lastName: true,
            paymentMethod: true, receiptNumber: true,
          },
        }),
        prisma.don.aggregate({ where, _sum: { amount: true }, _count: { id: true } }),
      ])

      return {
        year:  input.year ?? null,
        month: input.year !== undefined ? (input.month ?? null) : null,
        rows: rows.map((don) => ({
          id:            don.id,
          date:          toIsoDate(don.paidAt),
          amount:        toEuros(don.amount),
          donorName:     donorNameOf(don),
          paymentMethod: don.paymentMethod,
          receiptIssued: don.receiptNumber !== null,
        })),
        totalAmount: toEuros(aggregate._sum.amount),
        totalCount:  aggregate._count.id,
        truncated:   aggregate._count.id > rows.length,
      }
    }),
  })
}
