import { prisma } from "@/lib/prisma/client"
import { pusherServer } from "@/lib/pusher-server"
import { sendEmailBulk } from "@/lib/mail"
import { sondageInvitationEmail } from "@/lib/email"

export type SondageInviteResult = {
  notified:        number
  emailsSent:      number
  emailsFailed:    number
  skippedNoEmail:  number
  skippedNoAccess: number
}

const EMPTY_RESULT: SondageInviteResult = { notified: 0, emailsSent: 0, emailsFailed: 0, skippedNoEmail: 0, skippedNoAccess: 0 }

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
    prisma.association.findUnique({ where: { id: associationId }, select: { name: true, slug: true } }),
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

  const portalUrl      = `${process.env.NEXTAUTH_URL ?? ""}/portal/${association.slug}/sondages/${sondageId}`
  const recipients      = membres.filter(m => m.email)
  const skippedNoEmail  = membres.length - recipients.length

  let emailsSent = 0
  let emailsFailed = 0
  if (recipients.length) {
    const { sent, failed } = await sendEmailBulk(recipients.map(m => {
      const mail = sondageInvitationEmail({
        firstName:       m.firstName,
        email:           m.email!,
        associationName: association.name,
        sondageTitle:    sondage.title,
        deadline:        sondage.deadline,
        portalUrl,
      })
      return {
        ...mail,
        context: { associationId, membreId: m.id, source: "SONDAGE", sourceId: sondageId },
      }
    }))
    emailsSent   = sent
    emailsFailed = failed
  }

  return { notified: membres.length, emailsSent, emailsFailed, skippedNoEmail, skippedNoAccess }
}
