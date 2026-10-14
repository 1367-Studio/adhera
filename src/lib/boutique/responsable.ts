import { prisma } from "@/lib/prisma/client"

// Resolves Association.boutiqueResponsableId to an actually-notifiable user — null both when
// nothing is configured AND when the configured user has since been deactivated or soft-deleted
// (left the team, had access revoked). Every call site that might otherwise keep emailing an
// ex-staff account goes through this instead of reading boutiqueResponsableId directly — see
// POST /api/boutique/commandes, the Stripe webhook, and GET /api/boutique/settings.
export async function resolveBoutiqueResponsable(associationId: string): Promise<{ id: string; name: string | null; email: string } | null> {
  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { boutiqueResponsableId: true },
  })
  if (!association?.boutiqueResponsableId) return null

  const user = await prisma.user.findFirst({
    where:  { id: association.boutiqueResponsableId, active: true, deletedAt: null },
    select: { id: true, name: true, email: true },
  })
  return user
}
