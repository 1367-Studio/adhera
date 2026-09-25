import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { evenementRegistrationAdminNotificationEmail, evenementReviewAdminNotificationEmail } from "@/lib/email"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { pusherServer } from "@/lib/pusher-server"
import { APP_URL } from "@/lib/env"

// Called once per confirmed registration on an event — public form, member portal RSVP, or
// a Stripe payment clearing. The one place this fires, so every path stays in sync instead
// of each growing its own copy (same reasoning as notifyMembershipSignup, which this
// deliberately mirrors). Two independent channels:
//
// 1. An in-app Notification to every ADMIN/PRESIDENT/TRESORIER, unconditionally — before
//    this existed, a registration only ever produced a PARTICIPATION_PUBLIC_CREATED /
//    TICKET_PAID activity-log line, which nobody sees unless they go looking for it. That
//    silence is exactly what organizers reported: no sign at all that a ticket had sold.
// 2. An email to Evenement.adminNotificationEmail, only when the event explicitly sets one
//    (opt-in, mirrors the membership form's own field).
//
// A paid registration must announce itself when the money actually arrives, not when the
// checkout session opens — so the paid path calls this from the Stripe webhook, never from
// the route that merely creates the pending Participation.
export async function notifyEventRegistration(params: {
  associationId:  string
  evenementId:    string
  eventTitle:     string
  eventDate:      Date
  attendeeNames:  string[] // 1 for a single seat, N for a group order
  amount:         number   // 0 for a free registration
  adminNotificationEmail?: string | null
  // Only used to tie the email's audit-log row to a real Membre — omit for a public
  // registration, where the attendee has no Membre record.
  membreId?: string
}): Promise<void> {
  const admins = await prisma.user.findMany({
    where:  { associationId: params.associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER"] }, active: true },
    select: { id: true },
  })

  const isGroup = params.attendeeNames.length > 1
  const isPaid  = params.amount > 0
  const title   = isPaid
    ? (isGroup ? "Billets vendus" : "Billet vendu")
    : (isGroup ? "Nouvelles inscriptions" : "Nouvelle inscription")
  const amountSuffix = isPaid
    ? ` — ${params.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}`
    : ""
  const body = `${params.attendeeNames.join(", ")} ${isGroup ? "se sont inscrits" : "s'est inscrit(e)"} à « ${params.eventTitle} »${amountSuffix}.`

  if (admins.length) {
    await prisma.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        title,
        body,
        link:   `/dashboard/evenements/${params.evenementId}/presences`,
        scope:  "GESTION",
      })),
      skipDuplicates: true,
    })
    await pusherServer.trigger(`private-association-${params.associationId}`, "new-notification", {}).catch(() => {})
  }

  if (!params.adminNotificationEmail) return

  const assoc = await prisma.association.findUnique({
    where:  { id: params.associationId },
    select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true },
  })
  if (!assoc) return

  sendEmail(evenementRegistrationAdminNotificationEmail({
    email:           params.adminNotificationEmail,
    associationName: assoc.name,
    eventTitle:      params.eventTitle,
    eventDate:       params.eventDate,
    attendeeNames:   params.attendeeNames,
    amount:          params.amount,
    dashboardUrl:    `${APP_URL}/dashboard/evenements/${params.evenementId}/presences`,
    branding:        resolveDocumentBranding(assoc),
  }), {
    associationId: params.associationId,
    membreId:      params.membreId,
    source:        "EVENT_REGISTRATION_ADMIN_ALERT",
    sourceId:      params.evenementId,
  }).catch(() => {})
}

// Called once per submitted EvenementAvis — public review link or the member portal, the
// only two places that create one (see src/app/api/public/review/[token]/route.ts and
// src/app/api/portal/evenements/[id]/avaliacao/route.ts). Before this existed, a submitted
// review sat silently in the database: no in-app notification, no email, nothing telling an
// organizer that feedback had come in. Same two-channel shape as notifyEventRegistration.
export async function notifyEventReviewSubmitted(params: {
  associationId:  string
  evenementId:    string
  eventTitle:     string
  eventDate:      Date
  reviewerName:   string
  rating:         number
  comment?:       string | null
  adminNotificationEmail?: string | null
}): Promise<void> {
  const admins = await prisma.user.findMany({
    where:  { associationId: params.associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER"] }, active: true },
    select: { id: true },
  })

  const stars = "★".repeat(params.rating) + "☆".repeat(5 - params.rating)
  const title = "Nouvel avis"
  const body  = `${params.reviewerName} a laissé un avis ${stars} sur « ${params.eventTitle} »${params.comment ? ` : « ${params.comment} »` : "."}`

  if (admins.length) {
    await prisma.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        title,
        body,
        link:   `/dashboard/evenements/${params.evenementId}/avaliacoes`,
        scope:  "GESTION",
      })),
      skipDuplicates: true,
    })
    await pusherServer.trigger(`private-association-${params.associationId}`, "new-notification", {}).catch(() => {})
  }

  if (!params.adminNotificationEmail) return

  const assoc = await prisma.association.findUnique({
    where:  { id: params.associationId },
    select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true },
  })
  if (!assoc) return

  sendEmail(evenementReviewAdminNotificationEmail({
    email:           params.adminNotificationEmail,
    associationName: assoc.name,
    eventTitle:      params.eventTitle,
    eventDate:       params.eventDate,
    reviewerName:    params.reviewerName,
    rating:          params.rating,
    comment:         params.comment,
    dashboardUrl:    `${APP_URL}/dashboard/evenements/${params.evenementId}/avaliacoes`,
    branding:        resolveDocumentBranding(assoc),
  }), {
    associationId: params.associationId,
    source:        "EVENT_REVIEW_ADMIN_ALERT",
    sourceId:      params.evenementId,
  }).catch(() => {})
}
