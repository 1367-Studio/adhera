import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { membershipPaymentLinkEmail } from "@/lib/email"
import { APP_URL } from "@/lib/env"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { nextAmountDue } from "@/lib/cotisation-status"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

// A member registered by a manager through the public form's admin mode
// (admin-registration/route.ts) has no account and no other way to hear from the
// association until the payment email arrives — if it never reached them (typo, lost,
// or the exact silent-send bug fixed alongside this route), the only prior recourse was
// deleting and recreating the member. This resends the same link/email without touching
// anything else.
export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const membre = await prisma.membre.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })
  if (!membre.email) return NextResponse.json({ error: "Ce membre n'a pas d'email renseigné" }, { status: 422 })

  const cotisation = await prisma.cotisation.findFirst({
    where: {
      membreId:         membre.id,
      associationId,
      paymentToken:     { not: null },
      membershipFormId: { not: null },
      status:           { in: ["EN_ATTENTE", "PARTIELLEMENT_PAYEE", "EN_RETARD"] },
    },
    orderBy: { createdAt: "desc" },
    include: {
      membershipForm: { select: { title: true } },
      installments:   { orderBy: { dueDate: "asc" }, select: { amount: true, dueDate: true, order: true } },
    },
  })
  if (!cotisation || !cotisation.paymentToken || !cotisation.membershipForm)
    return NextResponse.json({ error: "Aucun lien de paiement à renvoyer pour ce membre" }, { status: 404 })

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, stripeConnectId: true, plan: true, customBrandingEnabled: true, logoUrl: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })
  if (!assoc.stripeConnectId)
    return NextResponse.json({ error: "Connectez Stripe pour envoyer des liens de paiement." }, { status: 422 })

  const amountDue = nextAmountDue({
    amount:       Number(cotisation.amount),
    amountPaid:   Number(cotisation.amountPaid),
    installments: cotisation.installments.map(i => ({ amount: Number(i.amount), dueDate: i.dueDate, order: i.order })),
  })

  await sendEmail(membershipPaymentLinkEmail({
    firstName:       membre.firstName,
    email:           membre.email,
    associationName: assoc.name,
    formTitle:       cotisation.membershipForm.title,
    amount:          amountDue,
    year:            cotisation.year,
    payUrl:          `${APP_URL}/cotisation/${cotisation.paymentToken}`,
    branding:        resolveDocumentBranding(assoc),
  }), { associationId, membreId: membre.id, source: "TRANSACTION" }).catch(() => {})

  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "COTISATION_PAYMENT_LINK_RESENT",
    entity:   "Membre",
    entityId: membre.id,
    label:    `${membre.firstName} ${membre.lastName}`,
    metadata: { cotisationId: cotisation.id },
  })

  return NextResponse.json({ sent: true })
}, { roles: MANAGERS, module: "cotisations" })
