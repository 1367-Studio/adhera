import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { paymentConfirmationEmail } from "@/lib/email"
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

      if (cotisationId) {
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
