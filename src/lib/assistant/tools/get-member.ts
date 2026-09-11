import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { currentCotisationYear, isMembreAdherent, membreAdherentResponsableSelect } from "@/lib/membre-adherent"
import { runToolSafely, toEuros, toIsoDate } from "@/lib/assistant/tool-result"
import type { ToolContext } from "@/lib/assistant/types"
import { isFinanceRole } from "@/lib/roles"

const TOOL_NAME             = "get_member"
const COTISATION_YEARS_BACK = 2 // current year plus the two before it = "last 3 years"

export function getMemberTool(context: ToolContext) {
  const canSeeDonations = isFinanceRole(context.role) && context.modules.dons

  return betaZodTool({
    name:        TOOL_NAME,
    description:
      "Renvoie la fiche détaillée d'un membre à partir de son id (obtenu via search_members). Appelle cet outil dès que la question " +
      "porte sur la situation d'une personne précise : ses cotisations des trois dernières années (montant, montant payé, statut, échéance, paiements), " +
      "son nombre de participations confirmées à des événements, son statut d'adhérent" +
      (canSeeDonations ? " et le total de ses dons encaissés." : ". Les dons ne sont pas accessibles pour ce rôle (champ donations à null)."),
    inputSchema: z.object({
      memberId: z.string().trim().min(1).max(64).describe("Identifiant du membre, tel que renvoyé par search_members"),
    }),
    run: (input) => runToolSafely(TOOL_NAME, async () => {
      const { associationId, today } = context
      const firstYear = currentCotisationYear(today) - COTISATION_YEARS_BACK

      // Both reads depend only on the ids known up front, so they run in parallel; the
      // aggregate over an unknown/foreign member id is simply zero and discarded below.
      const [membre, donations] = await Promise.all([
        prisma.membre.findFirst({
        where: { id: input.memberId, associationId, deletedAt: null },
        select: {
          id: true, firstName: true, lastName: true, email: true, phone: true, status: true, joinedAt: true, birthDate: true, adherentOverride: true,
          type:        { select: { name: true } },
          responsable: membreAdherentResponsableSelect(today),
          // Last three calendar years, plus any custom-duration row still covering today so
          // isMembreAdherent sees exactly what membreAdherentCotisationSelect would give it.
          cotisations: {
            where:   { OR: [{ year: { gte: firstYear } }, { periodEnd: { gte: today } }] },
            orderBy: { year: "desc" },
            select: {
              year: true, amount: true, amountPaid: true, status: true, dueDate: true, paidAt: true, periodEnd: true,
              payments: { orderBy: { paidAt: "desc" }, select: { amount: true, method: true, paidAt: true } },
            },
          },
          // Same "counts as a participant" predicate as GET /api/evenements' confirmedCount.
          _count: { select: { participations: { where: { OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] } } } },
        },
        }),
        canSeeDonations
          ? prisma.don.aggregate({
              where:  { associationId, membreId: input.memberId, paidAt: { not: null } },
              _sum:   { amount: true },
              _count: { id: true },
            })
          : null,
      ])
      if (!membre) return { error: "Membre introuvable" }

      return {
        id:                  membre.id,
        firstName:           membre.firstName,
        lastName:            membre.lastName,
        email:               membre.email,
        phone:               membre.phone,
        status:              membre.status,
        type:                membre.type?.name ?? null,
        joinedAt:            toIsoDate(membre.joinedAt),
        birthDate:           toIsoDate(membre.birthDate),
        isAdherent:          isMembreAdherent(membre, today),
        adherentOverride:    membre.adherentOverride,
        cotisations: membre.cotisations.map((cotisation) => ({
          year:       cotisation.year,
          amount:     toEuros(cotisation.amount),
          amountPaid: toEuros(cotisation.amountPaid),
          status:     cotisation.status,
          dueDate:    toIsoDate(cotisation.dueDate),
          paidAt:     toIsoDate(cotisation.paidAt),
          payments:   cotisation.payments.map((payment) => ({
            amount: toEuros(payment.amount),
            method: payment.method,
            paidAt: toIsoDate(payment.paidAt),
          })),
        })),
        participationsCount: membre._count.participations,
        donations: donations
          ? { totalAmount: toEuros(donations._sum.amount), count: donations._count.id }
          : null,
      }
    }),
  })
}
