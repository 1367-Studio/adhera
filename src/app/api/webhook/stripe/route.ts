import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { stripe, toSubscriptionStatus, subscriptionPeriodEnd, tierForPriceId, getPricingInfo } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { paymentConfirmationEmail, donConfirmationEmail, boutiqueConfirmationEmail, boutiqueNewOrderAdminEmail, ticketPurchaseEmail, subscriptionPaymentFailedEmail } from "@/lib/email"
import { generateRecuFiscalForDon } from "@/lib/pdf/recu-fiscal"
import { buildDocumentPdf } from "@/lib/pdf/document-pdf"
import { nextBoutiqueReceiptNumber } from "@/lib/document-numbering"
import { pusherServer } from "@/lib/pusher-server"
import { writeActivityLog } from "@/lib/activity-log"
import { resolveDocumentBranding } from "@/lib/plan-limits"
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

        const commande = await prisma.boutiqueCommande.findUnique({
          where:   { id: commandeId },
          include: {
            membre:      { select: { firstName: true, lastName: true, userId: true, user: { select: { email: true } } } },
            association: { select: { id: true, name: true, slug: true, address: true, city: true, siren: true, website: true, iban: true, bic: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true } },
            items:       {
              include: {
                produit:  { select: { name: true } },
                variante: { select: { label: true } },
              },
            },
          },
        })

        let claimed = false
        let receiptNumber = ""
        const buyerLabel = commande?.membre ? `${commande.membre.firstName} ${commande.membre.lastName}` : null

        if (commande && commande.status === "PENDING") {
          // One Income row per accounting category — a mixed-category order posts
          // several partial rows instead of forcing one row into a single category. Grouped
          // by the category snapshot taken when the item was ordered, not the product's
          // current category, so recategorizing a product doesn't retroactively change how
          // an already-placed order books once it's encaissé.
          const byCategory = new Map<string | null, { amount: number; names: Set<string> }>()
          for (const item of commande.items) {
            const key   = item.categoryId
            const group = byCategory.get(key) ?? { amount: 0, names: new Set<string>() }
            group.amount += item.unitPrice * item.quantity
            group.names.add(item.produit.name)
            byCategory.set(key, group)
          }

          // Claim (PENDING → PAID), receipt numbering, and Income booking all happen inside
          // one interactive transaction so a receiptNumber collision — or any other failure —
          // rolls the status flip back too. Without this, a failure after an unprotected
          // claim left the commande stuck as PAID with no Income row, no receiptNumber, and
          // no way to recover on webhook redelivery (the claim would just see status !=
          // PENDING and skip everything again). Retried up to 5x on unique-constraint
          // collision, same pattern as the Devis/Facture numbering call sites.
          for (let attempt = 0; attempt < 5; attempt++) {
            const candidateNumber = await nextBoutiqueReceiptNumber(commande.associationId)
            try {
              claimed = await prisma.$transaction(async tx => {
                // Atomic conditional update: only the first of any concurrent/duplicate
                // webhook deliveries for this commande will match and flip the status,
                // preventing a duplicate Income row from a race between two "PAID" transitions.
                const { count } = await tx.boutiqueCommande.updateMany({
                  where: { id: commandeId, status: "PENDING" },
                  data:  { status: "PAID", receiptNumber: candidateNumber, paidAt },
                })
                if (count === 0) return false

                for (const [categoryId, group] of byCategory) {
                  const itemsLabel = [...group.names].join(", ")
                  await tx.income.create({
                    data: {
                      associationId: commande.associationId,
                      memberId:      commande.membreId ?? undefined,
                      amount:        group.amount / 100,
                      categoryId:    categoryId ?? undefined,
                      description:   buyerLabel ? `Vente boutique — ${buyerLabel} — ${itemsLabel}` : `Vente boutique — ${itemsLabel}`,
                      paymentMethod: "STRIPE",
                      source:        "STRIPE",
                      status:        "PAID",
                      date:          paidAt,
                      reference:     paymentIntentId,
                    },
                  })
                }
                return true
              })
              receiptNumber = candidateNumber
              break
            } catch (err) {
              if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && attempt < 4) continue
              throw err
            }
          }
        }

        if (commande && claimed) {
          // Email confirmation to member, with the receipt PDF attached when it builds cleanly
          const memberEmail = commande.membre?.user?.email
          if (memberEmail && commande.membre) {
            const portalUrl = `${process.env.NEXTAUTH_URL ?? ""}/portal/${commande.association.slug}/boutique/commandes`

            let pdfAttachment: { filename: string; content: Buffer } | undefined
            try {
              const pdf = await buildDocumentPdf({
                kind:           "BOUTIQUE",
                number:         receiptNumber,
                issueDate:      commande.createdAt,
                secondaryLabel: "Payé le",
                secondaryDate:  paidAt,
                association: { ...commande.association, ...resolveDocumentBranding(commande.association) },
                fournisseur: {
                  companyName: buyerLabel ?? `${commande.membre.firstName} ${commande.membre.lastName}`,
                  address: null, city: null, postalCode: null, siret: null, vatNumber: null,
                },
                items: commande.items.map(i => ({
                  description: `${i.produit.name} – ${i.variante.label}`,
                  quantity:    i.quantity,
                  unitPrice:   i.unitPrice / 100,
                  vatRate:     0,
                  discount:    0,
                })),
                subtotal:       commande.totalAmount / 100,
                vatAmount:      0,
                discountAmount: 0,
                total:          commande.totalAmount / 100,
                amountPaid:     commande.totalAmount / 100,
                notes:          commande.note,
                paymentTerms:   "Payé par carte bancaire (en ligne).",
              })
              pdfAttachment = { filename: `recu-${receiptNumber}.pdf`, content: pdf }
            } catch (err) {
              console.error(`[boutique-pdf] failed to generate for commande ${commande.id}:`, err)
            }

            sendEmail({
              ...boutiqueConfirmationEmail({
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
                branding: resolveDocumentBranding(commande.association),
              }),
              attachments: pdfAttachment ? [pdfAttachment] : undefined,
            }, { associationId: commande.associationId, membreId: commande.membreId ?? undefined, source: "TRANSACTION", sourceId: commande.id }).catch(() => {})
          }

          // Push notification + email to association admins
          const admins = await prisma.user.findMany({
            where:  { associationId: commande.associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"] }, active: true },
            select: { id: true, email: true },
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

            const dashboardUrl = `${process.env.NEXTAUTH_URL ?? ""}/dashboard/boutique`
            for (const admin of admins) {
              if (!admin.email) continue
              // Logged via `context` (status SENT/FAILED on EmailMessage) instead of a bare
              // .catch swallow — the whole point of this email is "the admin finds out", so
              // a silent Resend failure here must stay diagnosable, not disappear.
              sendEmail(boutiqueNewOrderAdminEmail({
                email:           admin.email,
                associationName: commande.association.name,
                buyerLabel:      commande.membre ? `${commande.membre.firstName} ${commande.membre.lastName}` : "Un invité",
                totalAmount:     commande.totalAmount,
                dashboardUrl,
              }), { associationId: commande.associationId, source: "BOUTIQUE_ADMIN_ALERT", sourceId: commande.id })
                .catch(err => console.error(`[boutique-admin-alert] failed to email admin ${admin.email} for commande ${commande.id}:`, err))
            }
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
            association: { select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true } },
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
            branding:        resolveDocumentBranding(cotisation.association),
          }), { associationId: cotisation.associationId, membreId: cotisation.membreId, source: "TRANSACTION", sourceId: cotisationId }).catch(() => {})
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
                association:  { select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true } },
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
              branding:        resolveDocumentBranding(assoc),
            }), { associationId: evenement.associationId, membreId: buyerTicket.membreId ?? undefined, source: "TRANSACTION", sourceId: orderId }).catch(() => {})
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
          include: { association: { select: { id: true, name: true, address: true, city: true, siren: true, rna: true, canIssueTaxReceipts: true, objet: true, organismeCategory: true, organismeCategoryDetail: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true } } },
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
              branding:            resolveDocumentBranding(assoc),
            }),
            attachments: pdfAttachment ? [pdfAttachment] : undefined,
          }, { associationId: don.associationId, membreId: don.membreId ?? undefined, source: "TRANSACTION", sourceId: donId }).catch(() => {})
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
        select: { id: true, subscriptionStatus: true, plan: true },
      })
      if (!assoc) break

      // An admin switching Essentiel↔Pro from the Stripe Customer Portal lands here as a
      // price change on the existing subscription item — this is what syncs Association.plan
      // back so the member limit and IA gating (src/lib/plan-limits.ts, src/lib/modules.ts)
      // reflect the new tier. Prices outside PLAN_PRICES (the legacy single-product price)
      // resolve to null and leave `plan` untouched.
      const priceId    = sub.items.data[0]?.price.id
      const newTier    = priceId ? tierForPriceId(priceId) : null
      const newPlan    = newTier ? (newTier === "pro" ? "PRO" as const : "ESSENTIAL" as const) : null

      await prisma.association.update({
        where: { id: assoc.id },
        data:  {
          subscriptionStatus: newStatus,
          ...(newPlan ? { plan: newPlan } : {}),
          suspendedAt:
            newStatus === "SUSPENDED"
              ? (assoc.subscriptionStatus === "SUSPENDED" ? undefined : new Date())
              : null,
          cancelAtPeriodEnd:   sub.cancel_at_period_end,
          currentPeriodEndsAt: subscriptionPeriodEnd(sub),
        },
      })

      // Unlike /api/billing/reactivate, a Customer Portal downgrade can't be blocked ahead
      // of time — Stripe has already committed the price change by the time this event
      // arrives. Only option left is to catch it right after the fact: if it actually moved
      // the association to a smaller tier (not just a routine renewal — newPlan differs from
      // what it was) and that leaves them over the new cap, tell the admins immediately
      // instead of letting them find out later from a failed member-creation attempt.
      if (newPlan && newPlan !== assoc.plan) {
        const [pricing, activeCount] = await Promise.all([
          getPricingInfo(),
          prisma.membre.count({ where: { associationId: assoc.id, status: "ACTIF" } }),
        ])
        const newLimit = newPlan === "PRO" ? pricing.plans.pro.memberLimit : pricing.plans.essential.memberLimit
        if (activeCount > newLimit) {
          // Stripe can redeliver this same event; skipDuplicates on the notification insert
          // below wouldn't actually catch that (Notification has no unique constraint to
          // collide on) — guard explicitly on this event's id instead, same pattern as
          // invoice.payment_failed above.
          const alreadyNotified = await prisma.activityLog.findFirst({
            where: {
              associationId: assoc.id,
              action:        "SUBSCRIPTION_DOWNGRADE_OVER_LIMIT",
              entityId:      assoc.id,
              metadata:      { path: ["stripeEventId"], equals: event.id },
            },
            select: { id: true },
          })

          if (!alreadyNotified) {
            const admins = await prisma.user.findMany({
              where:  { associationId: assoc.id, role: { in: ["ADMIN", "PRESIDENT"] }, active: true },
              select: { id: true },
            })
            if (admins.length) {
              const tierLabel = newPlan === "PRO" ? "Pro" : "Essentiel"
              await prisma.notification.createMany({
                data: admins.map(a => ({
                  userId: a.id,
                  title:  "Formule en dessous du nombre de membres",
                  body:   `Votre formule ${tierLabel} limite à ${newLimit} membres actifs, mais votre association en compte ${activeCount}. Vous ne pourrez pas ajouter de nouveaux membres tant que vous n'aurez pas repris une formule supérieure.`,
                  link:   "/dashboard/parametres?tab=abonnement",
                })),
              })
              await pusherServer.trigger(`private-association-${assoc.id}`, "new-notification", {}).catch(() => {})
            }

            await writeActivityLog({
              associationId: assoc.id,
              action:        "SUBSCRIPTION_DOWNGRADE_OVER_LIMIT",
              entity:        "Association",
              entityId:      assoc.id,
              metadata:      { newPlan, activeCount, newLimit, stripeEventId: event.id },
            })
          }
        }
      }
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
