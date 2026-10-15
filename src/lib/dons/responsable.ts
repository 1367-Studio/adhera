import { prisma } from "@/lib/prisma/client"

// Resolves Association.donResponsableId to an actually-notifiable user — null both when
// nothing is configured AND when the configured user has since been deactivated or soft-deleted
// (left the team, had access revoked). Every call site that might otherwise keep emailing an
// ex-staff account goes through this instead of reading donResponsableId directly — see
// notifyDonResponsable and GET /api/dons/settings.
export async function resolveDonResponsable(associationId: string): Promise<{ id: string; name: string | null; email: string } | null> {
  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { donResponsableId: true },
  })
  if (!association?.donResponsableId) return null

  const user = await prisma.user.findFirst({
    where:  { id: association.donResponsableId, active: true, deletedAt: null },
    select: { id: true, name: true, email: true },
  })
  return user
}
