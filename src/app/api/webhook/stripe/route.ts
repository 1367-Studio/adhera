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

      if (commandeId) {
        const commande = await prisma.boutiqueCommande.findUnique({
          where:   { id: commandeId },
          include: {
            membre:      { select: { firstName: true, userId: true, user: { select: { email: true } } } },
            association: { select: { id: true, name: true, slug: true } },
            items:       {
              include: {
                produit:  { select: { name: true } },
                variante: { select: { label: true } },
              },
            },
          },
        })
        if (commande && commande.status !== "PAID") {
          const paidAt = new Date()

          await prisma.boutiqueCommande.update({
            where: { id: commandeId },
            data:  { status: "PAID" },
          })
          await prisma.income.create({
            data: {
              associationId: commande.associationId,
              memberId:      commande.membreId ?? undefined,
              amount:        commande.totalAmount / 100,
              description:   `Vente boutique #${commandeId} (Stripe)`,
              source:        "STRIPE",
              status:        "PAID",
              date:          paidAt,
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

        if (cotisation.amount != null) {
          await prisma.income.create({
            data: {
              associationId: cotisation.associationId,
              memberId:      cotisation.membreId,
              amount:        cotisation.amount,
              description:   `Cotisation ${cotisation.year} — ${cotisation.membre.firstName} ${cotisation.membre.lastName}`,
              source:        "STRIPE",
              status:        "PAID",
              date:          paidAt,
            },
          })
        }

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

        await writeActivityLog({
          associationId: cotisation.associationId,
          action:        "COTISATION_PAID",
          entity:        "Cotisation",
          entityId:      cotisationId,
          label:         `${cotisation.membre.firstName} ${cotisation.membre.lastName} — ${cotisation.year}`,
          metadata:      { amount: Number(cotisation.amount) },
        })
      } else if (participationId) {
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
        if (participation && !participation.ticketPaidAt && participation.evenement) {
          const paidAt = new Date()
          await prisma.participation.update({
            where: { id: participationId },
            data:  { ticketPaidAt: paidAt, stripeSessionId: sess.id, paidQuantity: participation.quantity ?? 1 },
          })
          const totalAmount = Number(participation.evenement.price!) * (participation.quantity ?? 1)
          await prisma.income.create({
            data: {
              associationId: participation.evenement.associationId,
              memberId:      participation.membreId,
              amount:        totalAmount,
              description:   `Billet (Stripe) — ${participation.evenement.title}`,
              source:        "STRIPE",
              status:        "PAID",
              date:          paidAt,
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

        await prisma.income.create({
          data: {
            associationId: don.associationId,
            amount:        don.amount,
            description:   don.anonymous
              ? "Don anonyme"
              : `Don de ${don.firstName} ${don.lastName}`,
            source:        "STRIPE",
            status:        "PAID",
            date:          paidAt,
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
