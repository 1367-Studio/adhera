import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma/client"
import { pusherServer } from "@/lib/pusher-server"
import { inngest } from "@/lib/inngest"
import { resolveDocumentBranding } from "@/lib/plan-limits"

export type SondageInviteResult = {
  jobId:           string | null
  notified:        number
  skippedNoEmail:  number
  skippedNoAccess: number
}

const EMPTY_RESULT: SondageInviteResult = { jobId: null, notified: 0, skippedNoEmail: 0, skippedNoAccess: 0 }

// Notifies + emails a set of members about a sondage — used both on activation and when
// new recipients are added to an already-ACTIF SELECTED sondage (see sondages/[id]/route.ts
// PATCH), so a member added after activation isn't silently left without an invitation.
export async function sendSondageInvitations(params: {
  sondageId:     string
  associationId: string
  membreIds:     string[]
}): Promise<SondageInviteResult> {
  const { sondageId, associationId, membreIds } = params
  if (membreIds.length === 0) return EMPTY_RESULT

  const [sondage, association, allTargets] = await Promise.all([
    prisma.sondage.findUnique({ where: { id: sondageId }, select: { title: true, deadline: true } }),
    prisma.association.findUnique({ where: { id: associationId }, select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true } }),
    prisma.membre.findMany({
      where:  { id: { in: membreIds } },
      select: { id: true, userId: true, firstName: true, email: true },
    }),
  ])
  if (!sondage || !association) return EMPTY_RESULT

  // Answering a sondage requires logging into the portal, so a member with no account
  // can't do anything with either the notification or the email — same gate as activate.
  // Counted (not just silently dropped) so the caller can warn the admin that these
  // members were never notified at all, same as it does for skippedNoEmail.
  const membres        = allTargets.filter(m => m.userId)
  const skippedNoAccess = allTargets.length - membres.length
  if (membres.length === 0) return { ...EMPTY_RESULT, skippedNoAccess }

  await prisma.notification.createMany({
    data: membres.map(m => ({
      userId: m.userId!,
      title:  `Nouveau sondage : ${sondage.title}`,
      body:   "Votre association vous invite à répondre à un sondage.",
      link:   `/portal/${association.slug}/sondages/${sondageId}`,
    })),
    skipDuplicates: true,
  })
  await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {}).catch(() => {})

  const recipients      = membres.filter(m => m.email)
  const skippedNoEmail  = membres.length - recipients.length

  let jobId: string | null = null
  if (recipients.length) {
    jobId = randomUUID()
    const branding = resolveDocumentBranding(association)
    await inngest.send({
      name: "bulk/sondage-invitations.requested",
      data: {
        jobId,
        associationId,
        sondageId,
        associationName: association.name,
        slug:             association.slug,
        branding,
        sondageTitle:     sondage.title,
        deadline:         sondage.deadline ? sondage.deadline.toISOString() : null,
        members:          recipients.map(m => ({ id: m.id, firstName: m.firstName, email: m.email! })),
      },
    })
  }

  return { jobId, notified: membres.length, skippedNoEmail, skippedNoAccess }
}
