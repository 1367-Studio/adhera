import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { paymentConfirmationEmail, donConfirmationEmail } from "@/lib/email"
import { generateRecuFiscal } from "@/lib/pdf/recu-fiscal"
import type Stripe from "stripe"

export const dynamic = "force-dynamic"

function toSubscriptionStatus(status: Stripe.Subscription.Status) {
  if (status === "trialing") return "TRIAL"    as const
  if (status === "active")   return "ACTIVE"   as const
  if (status === "past_due") return "PAST_DUE" as const
  return "CANCELLED" as const
}

export async function POST(req: Request) {
  const body      = await req.text()
  const signature = req.headers.get("stripe-signature") ?? ""

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: "Signature invalide" }, { status: 400 })
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const sess            = event.data.object as Stripe.Checkout.Session
      const cotisationId    = sess.metadata?.cotisationId
      const participationId = sess.metadata?.participationId
      const donId           = sess.metadata?.donId
      const commandeId      = sess.metadata?.commandeId

      if (commandeId) {
        const commande = await prisma.boutiqueCommande.findUnique({
          where:   { id: commandeId },
          select:  { id: true, status: true, totalAmount: true, associationId: true },
        })
        if (commande && commande.status !== "PAID") {
          await prisma.boutiqueCommande.update({
            where: { id: commandeId },
            data:  { status: "PAID" },
          })
          await prisma.tresorerieEntry.create({
            data: {
              associationId: commande.associationId,
              type:          "ENTREE",
              amount:        commande.totalAmount / 100,
              description:   "Vente boutique (Stripe)",
              date:          new Date(),
              category:      "Boutique",
            },
          })
        }
      } else if (cotisationId) {
        const cotisation = await prisma.cotisation.findUnique({
          where:   { id: cotisationId },
          include: {
            membre:      { select: { firstName: true, lastName: true, email: true } },
            association: { select: { name: true } },
          },
        })
        if (!cotisation || cotisation.status === "PAYE") break

        const paidAt = new Date()
        await prisma.cotisation.update({
          where: { id: cotisationId },
          data:  { status: "PAYE", paidAt },
        })

        if (cotisation.membre.email) {
          sendEmail(paymentConfirmationEmail({
            firstName:       cotisation.membre.firstName,
            email:           cotisation.membre.email,
            associationName: cotisation.association.name,
            amount:          Number(cotisation.amount),
            period:          String(cotisation.year),
            paidAt,
          })).catch(() => {})
        }
      } else if (participationId) {
        await prisma.participation.updateMany({
          where: { id: participationId, ticketPaidAt: null },
          data:  { ticketPaidAt: new Date(), stripeSessionId: sess.id },
        })
      } else if (donId) {
        const don = await prisma.don.findUnique({
          where:   { id: donId },
          include: { association: { select: { id: true, name: true, address: true, city: true, siren: true, rna: true, canIssueTaxReceipts: true } } },
        })
        if (!don || don.paidAt) break

        const paidAt = new Date()
        await prisma.don.update({
          where: { id: donId },
          data:  { paidAt, stripeSessionId: sess.id },
        })

        await prisma.tresorerieEntry.create({
          data: {
            associationId: don.associationId,
            type:          "ENTREE",
            amount:        don.amount,
            description:   don.anonymous
              ? "Don anonyme"
              : `Don de ${don.firstName} ${don.lastName}`,
            date:     paidAt,
            category: "Don",
          },
        })

        if (don.email) {
          const assoc = don.association
          let pdfAttachment: { filename: string; content: Buffer } | undefined

          if (assoc.canIssueTaxReceipts) {
            const updatedDon = await prisma.don.findUnique({ where: { id: donId } })
            if (updatedDon) {
              const pdf = await generateRecuFiscal(updatedDon, assoc).catch(() => null)
              if (pdf) {
                pdfAttachment = {
                  filename: `recu-fiscal-${updatedDon.receiptNumber ?? donId}.pdf`,
                  content:  pdf,
                }
              }
            }
          }

          const refreshed = await prisma.don.findUnique({ where: { id: donId }, select: { receiptNumber: true } })

          sendEmail({
            ...donConfirmationEmail({
              firstName:           don.firstName,
              email:               don.email,
              associationName:     assoc.name,
              amount:              Number(don.amount),
              paidAt,
              canIssueTaxReceipts: assoc.canIssueTaxReceipts,
              receiptNumber:       refreshed?.receiptNumber ?? undefined,
            }),
            attachments: pdfAttachment ? [pdfAttachment] : undefined,
          }).catch(() => {})
        }
      }
      break
    }

    // ── SaaS subscription lifecycle ───────────────────────────────────────
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription
      await prisma.association.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data:  { subscriptionStatus: toSubscriptionStatus(sub.status) },
      })
      break
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription
      await prisma.association.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data:  { subscriptionStatus: "CANCELLED" },
      })
      break
    }
  }

  return NextResponse.json({ received: true })
}
