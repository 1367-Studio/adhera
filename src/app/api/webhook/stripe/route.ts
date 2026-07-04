import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { paymentConfirmationEmail, donConfirmationEmail, boutiqueConfirmationEmail, ticketPurchaseEmail } from "@/lib/email"
import { generateRecuFiscal } from "@/lib/pdf/recu-fiscal"
import { pusherServer } from "@/lib/pusher-server"
import { writeActivityLog } from "@/lib/activity-log"
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
      // Stored on the Income row so a later `charge.refunded` event can find and
      // reverse the exact record it created, instead of matching on description text.
      const paymentIntentId = typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent?.id ?? null

      if (commandeId) {
        const paidAt = new Date()
        // Atomic conditional update: only the first of any concurrent/duplicate webhook
        // deliveries for this commande will match and flip the status, preventing a
        // duplicate Income row from a race between two "PAID" transitions.
        const { count: commandeClaimed } = await prisma.boutiqueCommande.updateMany({
          where: { id: commandeId, status: "PENDING" },
          data:  { status: "PAID" },
        })
        if (commandeClaimed === 0) break

        const commande = await prisma.boutiqueCommande.findUnique({
          where:   { id: commandeId },
          include: {
            membre:      { select: { firstName: true, lastName: true, userId: true, user: { select: { email: true } } } },
            association: { select: { id: true, name: true, slug: true } },
            items:       {
              include: {
                produit:  { select: { name: true } },
                variante: { select: { label: true } },
              },
            },
          },
        })
        if (commande) {
          await prisma.income.create({
            data: {
              associationId: commande.associationId,
              memberId:      commande.membreId ?? undefined,
              amount:        commande.totalAmount / 100,
              description:   commande.membre ? `Vente boutique — ${commande.membre.firstName} ${commande.membre.lastName}` : "Vente boutique",
              paymentMethod: "STRIPE",
              source:        "STRIPE",
              status:        "PAID",
              date:          paidAt,
              reference:     paymentIntentId,
            },
          })

          // Email confirmation to member
          const memberEmail = commande.membre?.user?.email
          if (memberEmail && commande.membre) {
            const portalUrl = `${process.env.NEXTAUTH_URL ?? ""}/portal/${commande.association.slug}/boutique/commandes`
            sendEmail(boutiqueConfirmationEmail({
              firstName:       commande.membre.firstName,
              email:           memberEmail,
              associationName: commande.association.name,
              totalAmount:     commande.totalAmount,
              paidAt,
              items: commande.items.map(i => ({
                name:      `${i.produit.name} – ${i.variante.label}`,
                quantity:  i.quantity,
                unitPrice: i.unitPrice,
              })),
              portalUrl,
            })).catch(() => {})
          }

          // Push notification to association admins
          const admins = await prisma.user.findMany({
            where:  { associationId: commande.associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"] }, active: true },
            select: { id: true },
          })
          if (admins.length) {
            const memberName = commande.membre?.firstName ?? "Un membre"
            await prisma.notification.createMany({
              data: admins.map(a => ({
                userId: a.id,
                title:  "Nouvelle commande boutique",
                body:   `${memberName} a passé une commande de ${(commande.totalAmount / 100).toFixed(2)} €`,
                link:   `/dashboard/boutique`,
              })),
              skipDuplicates: true,
            })
            await pusherServer.trigger(`private-association-${commande.associationId}`, "new-notification", {}).catch(() => {})
          }
        }
      } else if (cotisationId) {
        const paidAt = new Date()
        // Atomic conditional update: only the first of any concurrent/duplicate webhook
        // deliveries for this cotisation will match and flip the status, preventing a
        // duplicate Income row from a race between two "PAYE" transitions.
        const { count } = await prisma.cotisation.updateMany({
          where: { id: cotisationId, status: { not: "PAYE" } },
          data:  { status: "PAYE", paidAt },
        })
        if (count === 0) break

        const cotisation = await prisma.cotisation.findUnique({
          where:   { id: cotisationId },
          include: {
            membre:      { select: { firstName: true, lastName: true, email: true } },
            association: { select: { name: true } },
          },
        })
        if (!cotisation) break

        // Use what Stripe actually charged (locked in at checkout session creation), not
        // the cotisation's current `amount` — an admin could have edited the price while
        // the checkout session was still open, which would otherwise record an Income
        // that doesn't match the real payment.
        const chargedAmount = sess.amount_total != null ? sess.amount_total / 100 : Number(cotisation.amount)

        if (cotisation.amount != null) {
          await prisma.income.create({
            data: {
              associationId: cotisation.associationId,
              memberId:      cotisation.membreId,
              amount:        chargedAmount,
              description:   `Cotisation ${cotisation.year} — ${cotisation.membre.firstName} ${cotisation.membre.lastName}`,
              paymentMethod: "STRIPE",
              source:        "STRIPE",
              status:        "PAID",
              date:          paidAt,
              reference:     paymentIntentId,
            },
          })
        }

        if (cotisation.membre.email) {
          sendEmail(paymentConfirmationEmail({
            firstName:       cotisation.membre.firstName,
            email:           cotisation.membre.email,
            associationName: cotisation.association.name,
            amount:          chargedAmount,
            period:          String(cotisation.year),
            paidAt,
          })).catch(() => {})
        }

        await writeActivityLog({
          associationId: cotisation.associationId,
          action:        "COTISATION_PAID",
          entity:        "Cotisation",
          entityId:      cotisationId,
          label:         `${cotisation.membre.firstName} ${cotisation.membre.lastName} — ${cotisation.year}`,
          metadata:      { amount: Number(cotisation.amount) },
        })
      } else if (participationId) {
        const paidAt = new Date()
        // Atomic conditional update: only the first of any concurrent/duplicate webhook
        // deliveries for this ticket will match and flip ticketPaidAt, preventing a
        // duplicate Income row from a race between two "paid" transitions.
        const { count: ticketClaimed } = await prisma.participation.updateMany({
          where: { id: participationId, ticketPaidAt: null },
          data:  { ticketPaidAt: paidAt, stripeSessionId: sess.id },
        })
        if (ticketClaimed === 0) break

        const participation = await prisma.participation.findUnique({
          where:   { id: participationId },
          include: {
            evenement: {
              select: {
                title:        true,
                price:        true,
                date:         true,
                location:     true,
                associationId: true,
                association:  { select: { name: true, slug: true } },
              },
            },
            membre: { select: { firstName: true, email: true } },
          },
        })
        if (participation && participation.evenement) {
          await prisma.participation.update({
            where: { id: participationId },
            data:  { paidQuantity: participation.quantity ?? 1 },
          })
          const totalAmount = Number(participation.evenement.price!) * (participation.quantity ?? 1)
          await prisma.income.create({
            data: {
              associationId: participation.evenement.associationId,
              memberId:      participation.membreId,
              amount:        totalAmount,
              description:   `Billet (Stripe) — ${participation.evenement.title}`,
              paymentMethod: "STRIPE",
              source:        "STRIPE",
              status:        "PAID",
              date:          paidAt,
              reference:     paymentIntentId,
            },
          })
          await writeActivityLog({
            associationId: participation.evenement.associationId,
            action:        "TICKET_PAID",
            entity:        "Participation",
            entityId:      participationId,
            label:         participation.evenement.title,
            metadata:      { quantity: participation.quantity ?? 1, amount: totalAmount, stripeSessionId: sess.id },
          })
          if (participation.membre?.email && participation.evenement.association) {
            const ev    = participation.evenement
            const assoc = ev.association!
            const portalUrl = `${process.env.NEXTAUTH_URL ?? ""}/portal/${assoc.slug}/evenements`
            sendEmail(ticketPurchaseEmail({
              firstName:       participation.membre.firstName,
              email:           participation.membre.email,
              associationName: assoc.name,
              eventTitle:      ev.title,
              eventDate:       ev.date,
              eventLocation:   ev.location,
              amount:          totalAmount,
              quantity:        participation.quantity ?? 1,
              paidAt,
              portalUrl,
            })).catch(() => {})
          }
        }
      } else if (donId) {
        const paidAt = new Date()
        // Atomic conditional update: only the first of any concurrent/duplicate webhook
        // deliveries for this don will match and flip paidAt, preventing a duplicate
        // Income row (and a duplicate fiscal receipt number) from a race between two
        // "paid" transitions.
        const { count: donClaimed } = await prisma.don.updateMany({
          where: { id: donId, paidAt: null },
          data:  { paidAt, stripeSessionId: sess.id },
        })
        if (donClaimed === 0) break

        const don = await prisma.don.findUnique({
          where:   { id: donId },
          include: { association: { select: { id: true, name: true, address: true, city: true, siren: true, rna: true, canIssueTaxReceipts: true } } },
        })
        if (!don) break

        await prisma.income.create({
          data: {
            associationId: don.associationId,
            amount:        don.amount,
            description:   don.anonymous
              ? "Don anonyme"
              : `Don de ${don.firstName} ${don.lastName}`,
            paymentMethod: "STRIPE",
            source:        "STRIPE",
            status:        "PAID",
            date:          paidAt,
            reference:     paymentIntentId,
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

        await writeActivityLog({
          associationId: don.associationId,
          action:        "DON_PAID",
          entity:        "Don",
          entityId:      donId,
          label:         don.anonymous ? "Don anonyme" : `${don.firstName} ${don.lastName}`,
          metadata:      { amount: Number(don.amount) },
        })
      }
      break
    }

    case "checkout.session.expired": {
      const sess            = event.data.object as Stripe.Checkout.Session
      const commandeId      = sess.metadata?.commandeId
      const participationId = sess.metadata?.participationId

      if (participationId) {
        const expiredParticipation = await prisma.participation.findUnique({
          where:  { id: participationId },
          select: { evenement: { select: { title: true, associationId: true } } },
        })
        await prisma.participation.updateMany({
          where: { id: participationId, ticketPaidAt: null },
          data:  { rsvp: null, quantity: 1 },
        })
        if (expiredParticipation?.evenement) {
          await writeActivityLog({
            associationId: expiredParticipation.evenement.associationId,
            action:        "TICKET_CHECKOUT_EXPIRED",
            entity:        "Participation",
            entityId:      participationId,
            label:         expiredParticipation.evenement.title,
            metadata:      { stripeSessionId: sess.id },
          })
        }
        break
      }

      if (!commandeId) break

      const commande = await prisma.boutiqueCommande.findUnique({
        where:   { id: commandeId },
        include: { items: { select: { varianteId: true, quantity: true } } },
      })
      if (!commande || commande.status !== "PENDING") break

      await prisma.$transaction([
        prisma.boutiqueCommande.update({
          where: { id: commandeId },
          data:  { status: "CANCELLED" },
        }),
        ...commande.items.map(item =>
          prisma.boutiqueVariante.update({
            where: { id: item.varianteId },
            data:  { stock: { increment: item.quantity } },
          })
        ),
      ])
      break
    }

    // Safety net for refunds issued outside the app's own self-service cancellation
    // flows (Stripe Dashboard, disputes/chargebacks) — reverses the Income and the
    // paid state of whichever entity the charge belongs to.
    case "charge.refunded": {
      const charge         = event.data.object as Stripe.Charge
      const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id
      if (!paymentIntentId) break

      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId).catch(() => null)
      if (!paymentIntent) break

      const { cotisationId, participationId, donId, commandeId, associationId } = paymentIntent.metadata

      await prisma.income.updateMany({
        where: { reference: paymentIntentId, status: "PAID" },
        data:  { status: "CANCELLED" },
      })

      if (donId) {
        const { count } = await prisma.don.updateMany({
          where: { id: donId, refundedAt: null },
          data:  { refundedAt: new Date() },
        })
        if (count > 0 && associationId) {
          await writeActivityLog({ associationId, action: "DON_REFUNDED", entity: "Don", entityId: donId })
        }
      } else if (cotisationId) {
        const { count } = await prisma.cotisation.updateMany({
          where: { id: cotisationId, status: "PAYE" },
          data:  { status: "EN_ATTENTE", paidAt: null },
        })
        if (count > 0 && associationId) {
          await writeActivityLog({ associationId, action: "COTISATION_REFUNDED", entity: "Cotisation", entityId: cotisationId })
        }
      } else if (participationId) {
        const { count } = await prisma.participation.updateMany({
          where: { id: participationId, ticketPaidAt: { not: null } },
          data:  { ticketPaidAt: null, stripeSessionId: null, paidQuantity: null, rsvp: null, quantity: 1 },
        })
        if (count > 0 && associationId) {
          await writeActivityLog({ associationId, action: "TICKET_REFUNDED", entity: "Participation", entityId: participationId })
        }
      } else if (commandeId) {
        const commande = await prisma.boutiqueCommande.findUnique({
          where:   { id: commandeId },
          include: { items: { select: { varianteId: true, quantity: true } } },
        })
        if (commande && commande.status === "PAID") {
          await prisma.$transaction([
            prisma.boutiqueCommande.update({ where: { id: commandeId }, data: { status: "CANCELLED" } }),
            ...commande.items.map(item =>
              prisma.boutiqueVariante.update({
                where: { id: item.varianteId },
                data:  { stock: { increment: item.quantity } },
              })
            ),
          ])
          if (associationId) {
            await writeActivityLog({ associationId, action: "COMMANDE_REFUNDED", entity: "BoutiqueCommande", entityId: commandeId })
          }
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
