import { prisma } from "@/lib/prisma/client"
import { pusherServer } from "@/lib/pusher-server"
import { sendEmail } from "@/lib/mail"
import { supportTicketStaffEmail, supportTicketReplyEmail } from "@/lib/email"
import { APP_URL, BASE_PATH } from "@/lib/env"

type UnreadSide = "STAFF" | "ASSOCIATION"

// A ticket is unread for a side when the *other* side sent the latest message and this side
// hasn't opened it since. Shared by both list routes so the tenant list and the backoffice
// inbox never disagree on what counts as unread — see SupportTicket's own comment in
// schema.prisma for why this is a single shared timestamp per side rather than per-user.
export function deriveTicketUnread(ticket: {
  lastMessageAt:         Date
  lastMessageAuthorRole: string
  readByStaffAt:         Date | null
  readByAssociationAt:   Date | null
}, side: UnreadSide): boolean {
  const otherSideRole = side === "STAFF" ? "ADMIN" : "SUPER_ADMIN"
  if (ticket.lastMessageAuthorRole !== otherSideRole) return false
  const readAt = side === "STAFF" ? ticket.readByStaffAt : ticket.readByAssociationAt
  return !readAt || readAt < ticket.lastMessageAt
}

type NotifyDirection = "TO_STAFF" | "TO_ASSOCIATION"

type NotifyParams = {
  direction: NotifyDirection
  ticket: {
    id:            string
    associationId: string
    authorId:      string
    subject:       string
    association:   { name: string }
    author:        { name: string | null; email: string }
  }
  body: string
  // Only meaningful for "TO_STAFF" — whether this message opened the ticket vs. was added to
  // an existing one, so the staff notification email can say which happened instead of always
  // reading like a first contact.
  isNewTicket?: boolean
}

// Fire-and-forget-ish side effects for a new support ticket message (Pusher + email +, for a
// staff reply, an in-app Notification) — called *after* the message/ticket DB write commits,
// never from inside that transaction (mirrors sendCotisationPaymentConfirmation in
// src/lib/cotisation-payments.ts: an email a rolled-back transaction later undoes would be a
// lie, and holding a transaction open across outbound HTTP calls is its own problem).
//
// "TO_STAFF" = an association's ADMIN wrote (ticket created or replied to). "TO_ASSOCIATION"
// = the platform team replied. Either way `ticket.author` is always the one ADMIN allowed to
// write from the association side (see SupportTicket.authorId) — never the actual staff
// member who typed a given reply, since only the association-side person is a stable,
// singular recipient/subject to address in copy.
export async function notifySupportMessage(p: NotifyParams) {
  const dashboardUrl  = `${APP_URL}${BASE_PATH}/dashboard/suporte/${p.ticket.id}`
  const backofficeUrl = `${APP_URL}${BASE_PATH}/backoffice/support/${p.ticket.id}`
  const authorName    = p.ticket.author.name ?? p.ticket.author.email

  // The association's own private channel always gets pinged — it's how a second open tab
  // on that side (not just the "other" side) learns to refetch, regardless of direction.
  await pusherServer.trigger(`private-association-${p.ticket.associationId}`, "support-ticket-message", { ticketId: p.ticket.id }).catch(() => {})

  if (p.direction === "TO_STAFF") {
    // Not tied to one association — every SUPER_ADMIN subscribes to this one fixed channel
    // (see src/app/api/pusher/auth/route.ts) so the backoffice inbox live-updates across
    // every association, not just whichever one happens to be open.
    await pusherServer.trigger("private-support-staff", "support-ticket-message", { ticketId: p.ticket.id }).catch(() => {})

    const supportEmail = process.env.SUPPORT_TEAM_EMAIL
    if (!supportEmail) {
      console.error("[support-tickets] SUPPORT_TEAM_EMAIL is not configured — staff notification email skipped")
      return
    }
    await sendEmail(supportTicketStaffEmail({
      to:              supportEmail,
      associationName: p.ticket.association.name,
      authorName,
      subject:         p.ticket.subject,
      body:            p.body,
      ticketUrl:       backofficeUrl,
      isNewTicket:     !!p.isNewTicket,
    }), { associationId: p.ticket.associationId, source: "SUPPORT_TICKET_STAFF", sourceId: p.ticket.id }).catch(() => {})
    return
  }

  // Staff replied — the existing bell (src/components/layout/notification-bell.tsx) picks
  // this up for free via the same "new-notification" event every other feature already
  // triggers on private-association-${id}, no new UI needed for that part.
  const preview = p.body.length > 140 ? `${p.body.slice(0, 140)}…` : p.body
  await prisma.notification.create({
    data: {
      userId: p.ticket.authorId,
      title:  `Nouvelle réponse : ${p.ticket.subject}`,
      body:   preview,
      link:   `/dashboard/suporte/${p.ticket.id}`,
      scope:  "GESTION",
    },
  }).catch(() => {})
  await pusherServer.trigger(`private-association-${p.ticket.associationId}`, "new-notification", {}).catch(() => {})

  await sendEmail(supportTicketReplyEmail({
    to:      p.ticket.author.email,
    name:    authorName,
    subject: p.ticket.subject,
    body:    p.body,
    dashboardUrl,
  }), { associationId: p.ticket.associationId, source: "SUPPORT_TICKET_REPLY", sourceId: p.ticket.id }).catch(() => {})
}
