import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { deriveFactureStatus, factureStatusWhere } from "@/lib/facture-status"
import { openInvoiceTotals } from "@/lib/assistant/tools/invoice-totals"
import { runToolSafely, toEuros, toIsoDate } from "@/lib/assistant/tool-result"
import type { ToolContext } from "@/lib/assistant/types"

const TOOL_NAME     = "list_invoices"
const DEFAULT_LIMIT = 10
const MAX_LIMIT     = 25

const FACTURE_STATUSES     = ["BROUILLON", "EN_ATTENTE", "PARTIELLEMENT_PAYEE", "PAYEE", "EN_RETARD", "ANNULEE"] as const

// Mirrors GET /api/factures: soft-deleted rows excluded, number/fournisseur search, and
// EN_RETARD derived from dueDate at read time (never stored) via factureStatusWhere /
// deriveFactureStatus. Managers with the factures module — see buildTools.
export function listInvoicesTool(context: ToolContext) {
  return betaZodTool({
    name:        TOOL_NAME,
    description:
      "Liste les factures émises par l'association. Appelle cet outil dès que la question porte sur les factures : factures impayées ou en retard, " +
      "factures d'un fournisseur ou client, montant restant dû, factures récentes. " +
      "Renvoie les factures (numéro, fournisseur, dates d'émission et d'échéance, total, montant payé, statut) ainsi que totalOpen " +
      "(reste dû sur les factures en attente non échues) et totalOverdue (reste dû sur les factures en retard), calculés sur toutes les factures. " +
      "Statuts : BROUILLON, EN_ATTENTE, PARTIELLEMENT_PAYEE, PAYEE, EN_RETARD, ANNULEE.",
    inputSchema: z.object({
      status: z.enum(FACTURE_STATUSES).optional().describe("Ne garder que ce statut (EN_RETARD = en attente et échéance dépassée)"),
      search: z.string().trim().min(1).max(100).optional().describe("Texte recherché dans le numéro de facture ou le nom du fournisseur"),
      limit:  z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Nombre maximum de factures renvoyées (défaut ${DEFAULT_LIMIT}, maximum ${MAX_LIMIT})`),
    }),
    run: (input) => runToolSafely(TOOL_NAME, async () => {
      const { associationId, today } = context
      const limit = input.limit ?? DEFAULT_LIMIT

      const and: Record<string, unknown>[] = []
      if (input.search) {
        and.push({
          OR: [
            { number:      { contains: input.search, mode: "insensitive" } },
            { fournisseur: { companyName: { contains: input.search, mode: "insensitive" } } },
          ],
        })
      }
      if (input.status) and.push(factureStatusWhere(input.status, today))
      const where: Record<string, unknown> = { associationId, deletedAt: null, ...(and.length ? { AND: and } : {}) }

      const [rows, total, openTotals] = await Promise.all([
        prisma.facture.findMany({
          where,
          orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
          take:    limit,
          select: {
            id: true, number: true, issueDate: true, dueDate: true, total: true, amountPaid: true, status: true,
            fournisseur: { select: { companyName: true } },
          },
        }),
        prisma.facture.count({ where }),
        openInvoiceTotals(associationId, today),
      ])

      return {
        rows: rows.map((facture) => ({
          id:          facture.id,
          number:      facture.number,
          fournisseur: facture.fournisseur?.companyName ?? null,
          issueDate:   toIsoDate(facture.issueDate),
          dueDate:     toIsoDate(facture.dueDate),
          total:       toEuros(facture.total),
          amountPaid:  toEuros(facture.amountPaid),
          status:      deriveFactureStatus(facture.status, facture.dueDate, today),
        })),
        total,
        truncated: total > rows.length,
        totalOpen:    openTotals.openAmount,
        totalOverdue: openTotals.overdueAmount,
      }
    }),
  })
}
