import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { isMembreAdherent, membreAdherentCotisationSelect, membreAdherentResponsableSelect, membreAdherentWhereClause } from "@/lib/membre-adherent"
import { runToolSafely, toIsoDate } from "@/lib/assistant/tool-result"
import type { ToolContext } from "@/lib/assistant/types"

const TOOL_NAME     = "search_members"
const DEFAULT_LIMIT = 10
const MAX_LIMIT     = 25

const MEMBRE_STATUSES = ["PENDING", "ACTIF", "INACTIF", "SUSPENDU"] as const

// Mirrors GET /api/membres: soft-deleted rows excluded, one case-insensitive OR across
// firstName/lastName/email, adhérent/bénévole evaluated at the DB level.
export function searchMembersTool(context: ToolContext) {
  return betaZodTool({
    name:        TOOL_NAME,
    description:
      "Liste ou recherche les membres de l'association. Appelle cet outil dès que la question porte sur des membres précis, " +
      "une liste de membres, le nombre de membres, ou les adhérents et bénévoles. " +
      "Renvoie les membres (nom, email, téléphone, statut, type, date d'arrivée, adhérent ou non), le total correspondant au filtre " +
      "et le nombre de demandes d'adhésion en attente. Pour le détail d'un membre (cotisations, participations), utilise ensuite get_member avec son id.",
    inputSchema: z.object({
      search:   z.string().trim().min(1).max(100).optional().describe("Texte recherché dans le prénom, le nom ou l'email"),
      status:   z.enum(MEMBRE_STATUSES).optional().describe("Filtre sur le statut du membre : PENDING (demande en attente), ACTIF, INACTIF ou SUSPENDU"),
      adherent: z.enum(["ADHERENT", "BENEVOLE"]).optional().describe("ADHERENT pour ne garder que les adhérents à jour de cotisation, BENEVOLE pour les autres"),
      limit:    z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Nombre maximum de membres renvoyés (défaut ${DEFAULT_LIMIT}, maximum ${MAX_LIMIT})`),
    }),
    run: (input) => runToolSafely(TOOL_NAME, async () => {
      const { associationId, today } = context
      const limit = input.limit ?? DEFAULT_LIMIT

      const where: Record<string, unknown> = { associationId, deletedAt: null }
      if (input.status) where.status = input.status
      if (input.search) {
        where.OR = [
          { firstName: { contains: input.search, mode: "insensitive" } },
          { lastName:  { contains: input.search, mode: "insensitive" } },
          { email:     { contains: input.search, mode: "insensitive" } },
        ]
      }
      if (input.adherent) where.AND = [membreAdherentWhereClause(input.adherent === "ADHERENT", today)]

      const [rows, total, pendingRequests] = await Promise.all([
        prisma.membre.findMany({
          where,
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          take:    limit,
          select: {
            id: true, firstName: true, lastName: true, email: true, phone: true, status: true, joinedAt: true, adherentOverride: true,
            type:        { select: { name: true } },
            cotisations: membreAdherentCotisationSelect(today),
            responsable: membreAdherentResponsableSelect(today),
          },
        }),
        prisma.membre.count({ where }),
        prisma.membre.count({ where: { associationId, deletedAt: null, status: "PENDING" } }),
      ])

      return {
        rows: rows.map((membre) => ({
          id:         membre.id,
          firstName:  membre.firstName,
          lastName:   membre.lastName,
          email:      membre.email,
          phone:      membre.phone,
          status:     membre.status,
          type:       membre.type?.name ?? null,
          joinedAt:   toIsoDate(membre.joinedAt),
          isAdherent: isMembreAdherent(membre, today),
        })),
        total,
        truncated: total > rows.length,
        pendingRequests,
      }
    }),
  })
}
