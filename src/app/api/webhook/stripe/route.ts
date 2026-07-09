import { NextResponse } from "next/server"
import { stripe, toSubscriptionStatus, subscriptionPeriodEnd } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { paymentConfirmationEmail, donConfirmationEmail, boutiqueConfirmationEmail, ticketPurchaseEmail, subscriptionPaymentFailedEmail } from "@/lib/email"
import { generateRecuFiscalForDon } from "@/lib/pdf/recu-fiscal"
import { pusherServer } from "@/lib/pusher-server"
import { writeActivityLog } from "@/lib/activity-log"
import type Stripe from "stripe"

export const dynamic = "force-dynamic"

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
      const orderId         = sess.metadata?.orderId
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
      } else if (orderId) {
        const paidAt = new Date()
        // Atomic conditional update: only the first of any concurrent/duplicate webhook
        // deliveries for this order will match and flip ticketPaidAt, preventing a
        // duplicate Income row from a race between two "paid" transitions.
        const { count: ticketsClaimed } = await prisma.participation.updateMany({
          where: { orderId, ticketPaidAt: null },
          data:  { ticketPaidAt: paidAt, stripeSessionId: sess.id },
        })
        if (ticketsClaimed === 0) break

        const tickets = await prisma.participation.findMany({
          where:   { orderId },
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
          },
        })
        // The buyer is whichever ticket in the order is tied to the logged-in member —
        // that's who receives the purchase confirmation email, same as the checkout flow.
        const buyerTicket = tickets.find(t => t.membreId) ?? tickets[0]
        if (buyerTicket?.evenement) {
          const evenement  = buyerTicket.evenement
          const quantity   = tickets.length
          // Use what Stripe actually charged (locked in at checkout session creation),
          // not the event's current price — an admin could have edited the price while
          // the checkout session was still open. Every seat in the order shares the same
          // single line item, so amount_total is always evenly divisible by quantity.
          // This amount also drives later self-service refunds (cancel-ticket route), so
          // getting it wrong here can make a refund attempt exceed what was ever charged.
          const totalAmount = sess.amount_total != null ? sess.amount_total / 100 : Number(evenement.price!) * quantity
          const unitAmount  = totalAmount / quantity

          await prisma.participation.updateMany({ where: { orderId }, data: { amount: unitAmount } })

          // One Income row per seat (not a single lump sum) so cancelling a single
          // companion later can remove just that seat's revenue without touching the rest.
          await prisma.income.createMany({
            data: tickets.map(t => ({
              associationId:   evenement.associationId,
              memberId:        t.membreId,
              participationId: t.id,
              amount:          unitAmount,
              description:     `Billet (Stripe) — ${evenement.title} — ${t.firstName} ${t.lastName}`,
              paymentMethod:   "STRIPE",
              source:          "STRIPE",
              status:          "PAID",
              date:            paidAt,
              reference:       paymentIntentId,
            })),
          })
          await writeActivityLog({
            associationId: evenement.associationId,
            action:        "TICKET_PAID",
            entity:        "Participation",
            entityId:      buyerTicket.id,
            label:         evenement.title,
            metadata:      { quantity, amount: totalAmount, stripeSessionId: sess.id },
          })
          if (buyerTicket.email && evenement.association) {
            const assoc = evenement.association
            const portalUrl = `${process.env.NEXTAUTH_URL ?? ""}/portal/${assoc.slug}/evenements`
            sendEmail(ticketPurchaseEmail({
              firstName:       buyerTicket.firstName,
              email:           buyerTicket.email,
              associationName: assoc.name,
              eventTitle:      evenement.title,
              eventDate:       evenement.date,
              eventLocation:   evenement.location,
              amount:          totalAmount,
              quantity,
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
          include: { association: { select: { id: true, name: true, address: true, city: true, siren: true, rna: true, canIssueTaxReceipts: true, objet: true, organismeCategory: true, organismeCategoryDetail: true } } },
        })
        if (!don) break

        await prisma.income.create({
          data: {
            associationId: don.associationId,
            amount:        don.amount,
            // "anonymous" ne masque qu'un éventuel futur affichage public, jamais la
            // comptabilité interne — l'association doit toujours savoir qui a donné.
            description:   `Don de ${don.donorType === "COMPANY" ? (don.companyName ?? don.firstName) : `${don.firstName} ${don.lastName}`}`,
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
              try {
                const pdf = await generateRecuFiscalForDon(updatedDon, assoc)
                pdfAttachment = {
                  filename: `recu-fiscal-${updatedDon.receiptNumber ?? donId}.pdf`,
                  content:  pdf,
                }
              } catch (err) {
                // Previously swallowed silently — the confirmation email still goes out
                // below without the attachment, but the donor then never gets a receipt
                // and nobody notices unless they think to check. Flag it for an admin
                // instead; they (or the donor, via the portal download route) can
                // regenerate later — it reuses the receiptNumber already assigned above,
                // so retrying doesn't burn a second sequential number.
                console.error(`[recu-fiscal] failed to generate for don ${donId}:`, err)
                const admins = await prisma.user.findMany({
                  where:  { associationId: don.associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER"] }, active: true },
                  select: { id: true },
                })
                if (admins.length) {
                  const donorLabel = don.donorType === "COMPANY" ? (don.companyName ?? don.firstName) : `${don.firstName} ${don.lastName}`
                  await prisma.notification.createMany({
                    data: admins.map(a => ({
                      userId: a.id,
                      title:  "Échec de génération d'un reçu fiscal",
                      body:   `Le reçu fiscal pour le don de ${donorLabel} n'a pas pu être généré automatiquement — téléchargez-le et renvoyez-le manuellement.`,
                      link:   "/dashboard/dons",
                    })),
                    skipDuplicates: true,
                  })
                  await pusherServer.trigger(`private-association-${don.associationId}`, "new-notification", {}).catch(() => {})
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
              donorType:           don.donorType,
            }),
            attachments: pdfAttachment ? [pdfAttachment] : undefined,
          }).catch(() => {})
        }

        await writeActivityLog({
          associationId: don.associationId,
          action:        "DON_PAID",
          entity:        "Don",
          entityId:      donId,
          label:         don.donorType === "COMPANY" ? (don.companyName ?? don.firstName) : `${don.firstName} ${don.lastName}`,
          metadata:      { amount: Number(don.amount) },
        })
      }
      break
    }

    case "checkout.session.expired": {
      const sess       = event.data.object as Stripe.Checkout.Session
      const commandeId = sess.metadata?.commandeId
      const orderId    = sess.metadata?.orderId

      if (orderId) {
        const anyTicket = await prisma.participation.findFirst({
          where:  { orderId },
          select: { id: true, evenement: { select: { title: true, associationId: true } } },
        })
        // Release the held slots so someone else can take them — the rows themselves stay
        // (same orderId) so a retry from the portal reuses and renames them instead of
        // minting duplicates.
        await prisma.participation.updateMany({
          where: { orderId, ticketPaidAt: null },
          data:  { rsvp: null },
        })
        if (anyTicket?.evenement) {
          await writeActivityLog({
            associationId: anyTicket.evenement.associationId,
            action:        "TICKET_CHECKOUT_EXPIRED",
            entity:        "Participation",
            entityId:      anyTicket.id,
            label:         anyTicket.evenement.title,
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

      const { cotisationId, orderId, donId, commandeId, associationId } = paymentIntent.metadata

      // A single checkout (cotisation, ticket order, don, commande) can bundle several
      // paid seats/items behind one PaymentIntent. When the refund is partial (e.g. the
      // portal's own cancel-ticket flow refunding a single companion seat), the app has
      // already applied the matching Participation/Income change directly — blanket-
      // reversing everything tied to this paymentIntent here would also wipe out seats
      // or income rows that are still legitimately paid. Only treat this as the "external
      // refund" safety net (Stripe Dashboard, disputes) when the whole charge was refunded.
      if (charge.amount_refunded < charge.amount) {
        if (associationId) {
          // Stripe can redeliver the same event; charge.amount_refunded is the *cumulative*
          // total refunded on the charge, so blindly re-running this on a redelivery (or on
          // a second, later partial refund of the same charge that we haven't seen yet vs.
          // one we have) would double-subtract from the ledger. Guard on this specific
          // event's id — recorded in the activity log we're about to write anyway — before
          // doing anything mutating.
          const alreadyProcessed = await prisma.activityLog.findFirst({
            where: {
              associationId,
              action:   "PARTIAL_REFUND_RECEIVED",
              entityId: paymentIntentId,
              metadata: { path: ["stripeEventId"], equals: event.id },
            },
            select: { id: true },
          })
          if (alreadyProcessed) break

          await writeActivityLog({
            associationId,
            action:   "PARTIAL_REFUND_RECEIVED",
            entity:   "Payment",
            entityId: paymentIntentId,
            metadata: { amountRefunded: charge.amount_refunded, amount: charge.amount, stripeEventId: event.id },
          })

          // Reflect the actual amount kept in the ledger instead of leaving it at the
          // pre-refund total — an activity-log entry alone doesn't correct the books.
          // When one PaymentIntent backs several Income rows (a multi-seat ticket order),
          // there's no way to tell from the charge alone which seat the refund applies to,
          // so the cut is spread evenly (all seats in one order always share the same
          // price today, so this is exact, not an approximation).
          const incomes = await prisma.income.findMany({ where: { reference: paymentIntentId, status: "PAID" } })
          if (incomes.length) {
            const refundedEuros = charge.amount_refunded / 100
            const perRowCut     = refundedEuros / incomes.length
            await prisma.$transaction(
              incomes.map(i => prisma.income.update({
                where: { id: i.id },
                data:  { amount: Math.max(0, Number(i.amount) - perRowCut) },
              }))
            )
          }

          // A partial Dashboard refund is easy to miss — it doesn't touch any status the
          // admin normally looks at (Cotisation stays PAYE, Don stays un-refunded). Surface
          // it as a real notification instead of leaving it buried in the activity log.
          const admins = await prisma.user.findMany({
            where:  { associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER"] }, active: true },
            select: { id: true },
          })
          if (admins.length) {
            const amountLabel = (charge.amount_refunded / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
            let body = `Un remboursement partiel de ${amountLabel} a été reçu depuis Stripe. Le grand livre a été ajusté en conséquence.`
            if (donId) {
              const don = await prisma.don.findUnique({ where: { id: donId }, select: { receiptNumber: true } })
              if (don?.receiptNumber) {
                body += ` Ce don a déjà un reçu fiscal émis (n°${don.receiptNumber}) — vérifiez s'il doit être corrigé ou annulé manuellement.`
              }
            }
            await prisma.notification.createMany({
              data: admins.map(a => ({
                userId: a.id,
                title:  "Remboursement partiel reçu",
                body,
                link:   "/dashboard/tresorerie",
              })),
              skipDuplicates: true,
            })
            await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {}).catch(() => {})
          }
        }
        break
      }

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
      } else if (orderId) {
        const refundedTicket = await prisma.participation.findFirst({ where: { orderId }, select: { id: true } })
        const { count } = await prisma.participation.updateMany({
          where: { orderId, ticketPaidAt: { not: null } },
          data:  { ticketPaidAt: null, stripeSessionId: null, amount: null, rsvp: null },
        })
        if (count > 0 && associationId && refundedTicket) {
          await writeActivityLog({ associationId, action: "TICKET_REFUNDED", entity: "Participation", entityId: refundedTicket.id })
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
      const sub       = event.data.object as Stripe.Subscription
      const newStatus = toSubscriptionStatus(sub.status)

      // Fetched (rather than a blind updateMany) so we can tell whether this transition
      // is entering or leaving SUSPENDED — needed to stamp/clear suspendedAt, which
      // drives the "suspended since" messaging on the standby screen and backoffice.
      const assoc = await prisma.association.findFirst({
        where:  { stripeSubscriptionId: sub.id },
        select: { id: true, subscriptionStatus: true },
      })
      if (!assoc) break

      await prisma.association.update({
        where: { id: assoc.id },
        data:  {
          subscriptionStatus: newStatus,
          suspendedAt:
            newStatus === "SUSPENDED"
              ? (assoc.subscriptionStatus === "SUSPENDED" ? undefined : new Date())
              : null,
          cancelAtPeriodEnd:   sub.cancel_at_period_end,
          currentPeriodEndsAt: subscriptionPeriodEnd(sub),
        },
      })
      break
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription
      await prisma.association.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data:  { subscriptionStatus: "CANCELLED", suspendedAt: null, cancelAtPeriodEnd: false, currentPeriodEndsAt: null },
      })
      break
    }

    // A failed subscription charge otherwise only surfaces once the account is already
    // SUSPENDED (via customer.subscription.updated, after Stripe's dunning retries run
    // out) — nothing tells the admin about the very first failed attempt, so they only
    // find out once they're already locked out. This fires proactively, once per invoice
    // attempt, so they can fix the card before that happens.
    case "invoice.payment_failed": {
      const invoice    = event.data.object as Stripe.Invoice
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id
      if (!customerId) break

      const assoc = await prisma.association.findFirst({
        where:  { stripeCustomerId: customerId },
        select: { id: true, name: true },
      })
      if (!assoc) break

      // Stripe can redeliver this event for the same failed attempt — guard on it so an
      // admin doesn't get the same "your payment failed" email twice.
      const alreadyProcessed = await prisma.activityLog.findFirst({
        where: {
          associationId: assoc.id,
          action:        "SUBSCRIPTION_PAYMENT_FAILED",
          entityId:      invoice.id,
          metadata:      { path: ["stripeEventId"], equals: event.id },
        },
        select: { id: true },
      })
      if (alreadyProcessed) break

      const admins = await prisma.user.findMany({
        where:  { associationId: assoc.id, role: "ADMIN", active: true },
        select: { id: true, email: true },
      })
      if (!admins.length) break

      await writeActivityLog({
        associationId: assoc.id,
        action:        "SUBSCRIPTION_PAYMENT_FAILED",
        entity:        "Invoice",
        entityId:      invoice.id ?? null,
        metadata:      { amountDue: invoice.amount_due, attemptCount: invoice.attempt_count, stripeEventId: event.id },
      })

      const billingUrl    = `${process.env.NEXTAUTH_URL ?? ""}/dashboard/parametres`
      const attemptCount  = invoice.attempt_count ?? 1
      const nextAttemptAt = invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000) : null
      const amount        = invoice.amount_due != null ? invoice.amount_due / 100 : null

      for (const admin of admins) {
        if (!admin.email) continue
        sendEmail(subscriptionPaymentFailedEmail({
          email:           admin.email,
          associationName: assoc.name,
          amount,
          attemptCount,
          nextAttemptAt,
          billingUrl,
        })).catch(() => {})
      }

      await prisma.notification.createMany({
        data: admins.map(a => ({
          userId: a.id,
          title:  "Échec de paiement",
          body:   "Le prélèvement de votre abonnement a échoué. Mettez à jour votre moyen de paiement.",
          link:   "/dashboard/parametres",
        })),
        skipDuplicates: true,
      })
      await pusherServer.trigger(`private-association-${assoc.id}`, "new-notification", {}).catch(() => {})

      break
    }
  }

  return NextResponse.json({ received: true })
}
