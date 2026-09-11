import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { currentCotisationYear } from "@/lib/membre-adherent"
import { runToolSafely, toEuros, toIsoDate } from "@/lib/assistant/tool-result"
import type { ToolContext } from "@/lib/assistant/types"

const TOOL_NAME     = "list_cotisations"
const DEFAULT_LIMIT = 20
const MAX_LIMIT     = 50

const COTISATION_STATUSES = ["EN_ATTENTE", "PARTIELLEMENT_PAYEE", "PAYE", "EN_RETARD", "EXONERE", "ANNULEE"] as const

// Mirrors GET /api/cotisations (year, status list, name search, soft-deleted members
// excluded) and adds the per-status breakdown GET /api/dashboard/finance-charts computes.
export function listCotisationsTool(context: ToolContext) {
  return betaZodTool({
    name:        TOOL_NAME,
    description:
      "Liste les cotisations d'une année avec leur statut. Appelle cet outil dès que la question porte sur les cotisations : " +
      "qui a payé ou non, qui est en retard, combien de cotisations sont en attente, le montant encaissé ou restant dû. " +
      "Renvoie les lignes (membre, année, montant, montant payé, statut, échéance, date de paiement) et un résumé par statut " +
      "(nombre, montant total, montant payé) ainsi que totalPaid, la somme des cotisations au statut PAYE. " +
      "Statuts : EN_ATTENTE, PARTIELLEMENT_PAYEE, PAYE, EN_RETARD, EXONERE, ANNULEE.",
    inputSchema: z.object({
      year:   z.number().int().min(2000).max(2100).optional().describe("Année de cotisation (défaut : l'année en cours)"),
      status: z.array(z.enum(COTISATION_STATUSES)).min(1).optional().describe("Ne garder que ces statuts (par exemple [\"EN_ATTENTE\", \"EN_RETARD\"] pour les impayés)"),
      search: z.string().trim().min(1).max(100).optional().describe("Texte recherché dans le prénom ou le nom du membre"),
      limit:  z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Nombre maximum de lignes renvoyées (défaut ${DEFAULT_LIMIT}, maximum ${MAX_LIMIT})`),
    }),
    run: (input) => runToolSafely(TOOL_NAME, async () => {
      const { associationId, today } = context
      const year  = input.year ?? currentCotisationYear(today)
      const limit = input.limit ?? DEFAULT_LIMIT

      const membreFilter = input.search
        ? {
            deletedAt: null,
            OR: [
              { firstName: { contains: input.search, mode: "insensitive" as const } },
              { lastName:  { contains: input.search, mode: "insensitive" as const } },
            ],
          }
        : { deletedAt: null }
      const where = {
        associationId,
        year,
        membre: membreFilter,
        ...(input.status ? { status: { in: [...input.status] } } : {}),
      }

      const [rows, total, byStatusGroups] = await Promise.all([
        prisma.cotisation.findMany({
          where,
          orderBy: [{ membre: { lastName: "asc" } }, { membre: { firstName: "asc" } }],
          take:    limit,
          select: {
            id: true, year: true, amount: true, amountPaid: true, status: true, dueDate: true, paidAt: true,
            membre: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        }),
        prisma.cotisation.count({ where }),
        // The summary describes the whole year, not the filtered list — like the dashboard
        // charts, so the numbers the user sees on screen and hears from the assistant agree.
        prisma.cotisation.groupBy({
          by:     ["status"],
          where:  { associationId, year, membre: { deletedAt: null } },
          _count: { _all: true },
          _sum:   { amount: true, amountPaid: true },
        }),
      ])

      const byStatus: Record<string, { count: number; amount: number; amountPaid: number }> = {}
      for (const group of byStatusGroups) {
        byStatus[group.status] = {
          count:      group._count._all,
          amount:     toEuros(group._sum.amount),
          amountPaid: toEuros(group._sum.amountPaid),
        }
      }

      return {
        year,
        rows: rows.map((cotisation) => ({
          id:          cotisation.id,
          memberId:    cotisation.membre.id,
          memberName:  `${cotisation.membre.firstName} ${cotisation.membre.lastName}`,
          memberEmail: cotisation.membre.email,
          year:        cotisation.year,
          amount:      toEuros(cotisation.amount),
          amountPaid:  toEuros(cotisation.amountPaid),
          status:      cotisation.status,
          dueDate:     toIsoDate(cotisation.dueDate),
          paidAt:      toIsoDate(cotisation.paidAt),
        })),
        total,
        truncated: total > rows.length,
        summary: {
          byStatus,
          totalPaid: byStatus.PAYE?.amount ?? 0,
        },
      }
    }),
  })
}
