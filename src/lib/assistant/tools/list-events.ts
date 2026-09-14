import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { runToolSafely, toIsoDate } from "@/lib/assistant/tool-result"
import type { ToolContext } from "@/lib/assistant/types"

const TOOL_NAME     = "list_events"
const DEFAULT_LIMIT = 10
const MAX_LIMIT     = 20

// Mirrors GET /api/evenements: upcoming = date >= now ascending, past = descending; the
// confirmed count uses the same paid-or-CONFIRME predicate as the admin list.
export function listEventsTool(context: ToolContext) {
  return betaZodTool({
    name:        TOOL_NAME,
    description:
      "Liste les événements à venir ou passés de l'association. Appelle cet outil dès que la question porte sur les événements : " +
      "prochain événement, événements d'une période, nombre d'inscrits ou de présents, lieu, capacité. " +
      "Renvoie pour chaque événement le titre, les dates, le lieu, le statut (DRAFT, PUBLISHED, ARCHIVED), la capacité, " +
      "le nombre d'inscriptions confirmées et le nombre de présents pointés.",
    inputSchema: z.object({
      scope:  z.enum(["upcoming", "past"]).describe("upcoming pour les événements à venir (du plus proche au plus lointain), past pour les événements passés (du plus récent au plus ancien)"),
      search: z.string().trim().min(1).max(100).optional().describe("Texte recherché dans le titre ou le lieu"),
      limit:  z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Nombre maximum d'événements renvoyés (défaut ${DEFAULT_LIMIT}, maximum ${MAX_LIMIT})`),
    }),
    run: (input) => runToolSafely(TOOL_NAME, async () => {
      const { associationId, today } = context
      const limit = input.limit ?? DEFAULT_LIMIT

      const where = {
        associationId,
        date: input.scope === "upcoming" ? { gte: today } : { lt: today },
        ...(input.search
          ? {
              OR: [
                { title:    { contains: input.search, mode: "insensitive" as const } },
                { location: { contains: input.search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      }

      const [rows, total] = await Promise.all([
        prisma.evenement.findMany({
          where,
          orderBy: { date: input.scope === "upcoming" ? "asc" : "desc" },
          take:    limit,
          select: {
            id: true, title: true, date: true, endDate: true, location: true, status: true, capacity: true,
            _count: { select: { participations: { where: { present: true } } } },
          },
        }),
        prisma.evenement.count({ where }),
      ])

      const eventIds = rows.map((event) => event.id)
      const confirmedGroups = eventIds.length > 0
        ? await prisma.participation.groupBy({
            by:     ["evenementId"],
            where:  { evenementId: { in: eventIds }, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
            _count: { _all: true },
          })
        : []
      const confirmedByEvent = new Map(confirmedGroups.map((group) => [group.evenementId, group._count._all]))

      return {
        scope: input.scope,
        rows: rows.map((event) => ({
          id:             event.id,
          title:          event.title,
          date:           toIsoDate(event.date),
          endDate:        toIsoDate(event.endDate),
          location:       event.location,
          status:         event.status,
          capacity:       event.capacity,
          confirmedCount: confirmedByEvent.get(event.id) ?? 0,
          presentCount:   event._count.participations,
        })),
        total,
        truncated: total > rows.length,
      }
    }),
  })
}
