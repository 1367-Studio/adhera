import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { guardModule } from "@/lib/auth/require-module"
import { inngest } from "@/lib/inngest"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { nextAmountDue } from "@/lib/cotisation-status"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

const schema = z.object({
  cotisationIds: z.array(z.string()).min(1).max(500),
  channel:       z.enum(["EMAIL", "SMS"]),
  subject:       z.string().max(200).optional(),
  body:          z.string().min(1),
})

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const messagesGuard = await guardModule(associationId, "messages")
  if (messagesGuard) return messagesGuard

  const raw    = await req.json().catch(() => null)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const { cotisationIds, channel, subject, body } = parsed.data

  if (channel === "SMS") {
    const smsGuard = await guardModule(associationId, "sms")
    if (smsGuard) return smsGuard
  }
  if (channel === "EMAIL" && !subject?.trim()) {
    return NextResponse.json({ error: "Objet requis pour un envoi par email" }, { status: 422 })
  }

  const [assoc, cotisations] = await Promise.all([
    prisma.association.findUnique({
      where:  { id: associationId },
      select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
    }),
    // Scoped to this association and to members who still owe something (EN_ATTENTE,
    // PARTIELLEMENT_PAYEE, or EN_RETARD) — defense in depth, doesn't just trust that the
    // client only ever sends ids that were actually selectable in the UI. Must stay in
    // lockstep with cotisations-view.tsx's isSelectable/selectAllMatching.
    prisma.cotisation.findMany({
      where:   { id: { in: cotisationIds }, associationId, status: { in: ["EN_ATTENTE", "PARTIELLEMENT_PAYEE", "EN_RETARD"] } },
      include: {
        membre:       { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        installments: { select: { amount: true, dueDate: true, order: true } },
      },
    }),
  ])
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  // What the reminder should actually ask for — the next unpaid échéance when the cotisation
  // has an installment schedule, otherwise the full remaining balance. Using the cotisation's
  // sticker `amount` here (as this used to) would ask an already-partially-paid or
  // installment-based member for more than they actually still owe right now.
  const amountDue = (c: { amount: unknown; amountPaid: unknown; installments: { amount: unknown; dueDate: Date; order: number }[] }) =>
    nextAmountDue({
      amount:       Number(c.amount),
      amountPaid:   Number(c.amountPaid),
      installments: c.installments.map(i => ({ amount: Number(i.amount), dueDate: i.dueDate, order: i.order })),
    }).toFixed(2)

  // Ids the client asked for that this query didn't return at all — no longer EN_ATTENTE
  // (paid/exempted since the row was selected), deleted, or from another association.
  // Surfaced distinctly from skippedNoContact instead of silently vanishing from every
  // count, which would otherwise leave sent+failed+skippedNoContact undercounting the
  // original selection with no explanation.
  const skippedInvalid = cotisationIds.length - cotisations.length

  const eligible = cotisations.filter(c => channel === "EMAIL" ? !!c.membre.email : !!c.membre.phone)
  const skippedNoContact = cotisations.length - eligible.length

  if (eligible.length === 0) {
    return NextResponse.json({ jobId: null, totalRecipients: 0, skippedNoContact, skippedInvalid })
  }

  const branding = channel === "EMAIL" ? resolveDocumentBranding(assoc) : undefined
  const jobId    = randomUUID()

  await inngest.send({
    name: "bulk/cotisation-reminders.requested",
    data: {
      jobId,
      associationId,
      actorId: userId,
      channel,
      subject,
      body,
      associationName: assoc.name,
      slug:             assoc.slug,
      branding,
      targets: eligible.map(c => ({
        cotisationId:      c.id,
        membreId:          c.membre.id,
        firstName:         c.membre.firstName,
        lastName:          c.membre.lastName,
        email:             c.membre.email,
        phone:             c.membre.phone,
        year:              c.year,
        montantCotisation: amountDue(c),
      })),
    },
  })

  return NextResponse.json({ jobId, totalRecipients: eligible.length, skippedNoContact, skippedInvalid })
}, { roles: MANAGERS, module: "cotisations" })
