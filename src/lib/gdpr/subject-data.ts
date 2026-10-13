import { prisma } from "@/lib/prisma/client"

// Answers a GDPR Art.15/20 access or portability request for one Membre — security audit
// H7. Before this, the only export (src/app/api/membres/export/route.ts) covered just the
// Membre table's own columns; responding to a real request meant manually digging through
// every related table by hand, with real risk of an incomplete answer.
//
// Walks the Membre's own declared Prisma relations (the same graph the schema itself
// documents as "belonging" to a member) rather than hand-listing tables here a second
// time — new relations added to the Membre model are picked up automatically. The two
// exceptions are LegalAcceptance and ActivityLog, which are deliberately plain columns on
// their own models (not Prisma relations — see each model's own schema comment), so they're
// queried directly by membreId/userId/actorId instead.
export async function collectPersonalData(associationId: string, membreId: string) {
  const membre = await prisma.membre.findFirst({
    where: { id: membreId, associationId },
    include: {
      // Never passwordHash/twoFactorSecret/image-rights-irrelevant internals — this is a
      // disclosure to (or about) the data subject, not an internal admin view.
      user: {
        select: {
          id: true, name: true, email: true, role: true, locale: true,
          active: true, twoFactorEnabled: true, createdAt: true, updatedAt: true,
        },
      },
      responsable:              { select: { id: true, firstName: true, lastName: true } },
      dependants:                { select: { id: true, firstName: true, lastName: true } },
      cotisations:               true,
      cotisationSubscription:    true,
      participations:            { include: { evenement: { select: { id: true, title: true } } } },
      dons:                      true,
      membershipAddonPurchases:  true,
      boutiqueCommandes:         true,
      incomes:                   true,
      actualiteRecipients:       true,
      materialLoans:             true,
      automationLogs:            true,
      sondageRecipients:         true,
      sondageReponses:           true,
      meetingsAsParticipant:     { include: { meeting: { select: { id: true, title: true, scheduledAt: true } } } },
      emailMessages:             true,
      smsMessages:               true,
      controlAlert:              true,
    },
  })
  if (!membre) return null

  const [legalAcceptances, activityLog] = await Promise.all([
    prisma.legalAcceptance.findMany({
      where: {
        associationId,
        OR: [{ membreId }, ...(membre.userId ? [{ userId: membre.userId }] : [])],
      },
      orderBy: { acceptedAt: "desc" },
    }),
    prisma.activityLog.findMany({
      where: {
        associationId,
        OR: [
          { entity: "Membre", entityId: membreId },
          ...(membre.userId ? [{ actorId: membre.userId }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    }),
  ])

  return { exportedAt: new Date().toISOString(), membre, legalAcceptances, activityLog }
}

export type PersonalDataExport = NonNullable<Awaited<ReturnType<typeof collectPersonalData>>>
