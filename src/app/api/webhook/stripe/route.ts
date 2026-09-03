import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { stripe, toSubscriptionStatus, subscriptionPeriodEnd, tierForPriceId, getPricingInfo } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { donConfirmationEmail, boutiqueConfirmationEmail, boutiqueNewOrderAdminEmail, ticketPurchaseEmail, subscriptionPaymentFailedEmail } from "@/lib/email"
import { notifyEventRegistration } from "@/lib/evenement-notify"
import { generateRecuFiscalForDon } from "@/lib/pdf/recu-fiscal"
import { buildDocumentPdf } from "@/lib/pdf/document-pdf"
import { nextBoutiqueReceiptNumber } from "@/lib/document-numbering"
import { pusherServer } from "@/lib/pusher-server"
import { writeActivityLog } from "@/lib/activity-log"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { recordCotisationPayment, sendCotisationPaymentConfirmation, CotisationOverpaymentError } from "@/lib/cotisation-payments"
import { deriveCotisationStatus } from "@/lib/cotisation-status"
import type Stripe from "stripe"
import { resolveExerciceForDate } from "@/lib/finance/exercice"
import { APP_URL } from "@/lib/env"
import {
  isDonationSubscriptionEvent, handleDonationSubscriptionCheckout, handleDonationSubscriptionSynced,
  handleDonationSubscriptionDeleted, handleDonationInvoicePaid, tryHandleDonationInvoicePaymentFailed,
} from "@/lib/webhook/donation-subscriptions"
import {
  isCotisationSubscriptionEvent, handleCotisationSubscriptionCheckout, handleCotisationSubscriptionSynced,
  handleCotisationSubscriptionDeleted, handleCotisationInvoicePaid, tryHandleCotisationInvoicePaymentFailed,
} from "@/lib/webhook/cotisation-subscriptions"
import { handleMembershipOneOffCheckout } from "@/lib/webhook/membership-forms"
import { handleMembershipMultiCheckout } from "@/lib/webhook/membership-multi"
import { notifyMembershipSignup } from "@/lib/webhook/membership-notify"
import { grantMembrePortalAccess } from "@/lib/membre-access"
import {
  isMembershipInstallmentEvent, handleMembershipInstallmentCheckout, handleInstallmentInvoicePaid,
  tryHandleInstallmentInvoicePaymentFailed, handleMembershipInstallmentDeleted,
} from "@/lib/webhook/membership-installments"

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

      // A recurring donation's Checkout Session — routed to its own module (see the file
      // for why this can't reuse the donId branch below: no DB row exists yet to carry an
      // id in metadata, since a Subscription id doesn't exist until Stripe mints it here).
      if (sess.mode === "subscription" && sess.metadata?.kind === "donation") {
        await handleDonationSubscriptionCheckout(sess)
        break
      }

      // A recurring membership signup's Checkout Session — same reasoning as the donation
      // branch above: no Membre exists yet to carry an id in metadata, since it's only
      // created once Stripe mints a real subscription id (see
      // src/lib/webhook/cotisation-subscriptions.ts).
      if (sess.mode === "subscription" && sess.metadata?.kind === "cotisation") {
        await handleCotisationSubscriptionCheckout(sess)
        break
      }

      // A one-off (non-recurring) paid membership tier — same reasoning as the two branches
      // above: no Membre exists yet to carry an id in metadata, so identity rides through
      // Stripe metadata instead (see src/lib/webhook/membership-forms.ts). Unlike a one-off
      // Don, there's no pre-created row to flip paidAt on below.
      if (sess.mode === "payment" && sess.metadata?.kind === "membership-oneoff") {
        await handleMembershipOneOffCheckout(sess)
        break
      }

      // A paid multi-registrant MembershipForm submission — the draft referenced by
      // metadata.draftId already carries every registrant's identity (see checkout/route.ts
      // and src/lib/webhook/membership-multi.ts), so unlike the branches above there's
      // nothing to reconstruct from Stripe metadata alone.
      if (sess.mode === "payment" && sess.metadata?.kind === "membership-multi") {
        await handleMembershipMultiCheckout(sess)
        break
      }

      // A ONE_OFF membership tier paid in installments — same reasoning as the two
      // subscription branches above, no Membre exists yet to carry an id in metadata.
      if (sess.mode === "subscription" && sess.metadata?.kind === "membership-installment") {
        await handleMembershipInstallmentCheckout(sess)
        break
      }

      if (commandeId) {
        const paidAt = new Date()

        const commande = await prisma.boutiqueCommande.findUnique({
          where:   { id: commandeId },
          include: {
            membre:      { select: { firstName: true, lastName: true, userId: true, user: { select: { email: true } } } },
            association: { select: { id: true, name: true, slug: true, address: true, city: true, siren: true, website: true, iban: true, bic: true, plan: true, customBrandingEnabled: true, logoUrl: true } },
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
          // Best-effort: link to whichever exercice covers today's date, but never block —
          // the payment already happened on Stripe's side, there's no user to show an error
          // to, and the early-closure rule on exercice closing means this can basically only
          // land in an open period anyway (see PATCH /finances/exercices/[id]).
          const exercice = await resolveExerciceForDate(commande.associationId, paidAt)

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
                      exerciceId:    exercice?.status === "OUVERT" ? exercice.id : null,
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
            const portalUrl = `${APP_URL}/portal/${commande.association.slug}/boutique/commandes`

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
                scope:  "GESTION",
              })),
              skipDuplicates: true,
            })
            await pusherServer.trigger(`private-association-${commande.associationId}`, "new-notification", {}).catch(() => {})

            const dashboardUrl = `${APP_URL}/dashboard/boutique`
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
        // deliveries for this cotisation will match, preventing a duplicate payment/Income
        // row from a race between two "PAYE" transitions. Re-sets stripeSessionId to its
        // already-current value — a no-op in effect, just a field the update needs to touch.
        const { count } = await prisma.cotisation.updateMany({
          where: { id: cotisationId, status: { not: "PAYE" } },
          data:  { stripeSessionId: sess.id },
        })
        if (count === 0) break

        const existingCotisation = await prisma.cotisation.findUnique({
          where:  { id: cotisationId },
          select: { associationId: true, amount: true },
        })
        if (!existingCotisation) break

        // Use what Stripe actually charged (locked in at checkout session creation), not
        // the cotisation's current `amount` — an admin could have edited the price while
        // the checkout session was still open, which would otherwise record an Income
        // that doesn't match the real payment.
        const chargedAmount = sess.amount_total != null ? sess.amount_total / 100 : Number(existingCotisation.amount)

        // Best-effort exercice link — never blocks, same reasoning as the boutique branch above.
        const exercice = await resolveExerciceForDate(existingCotisation.associationId, paidAt)

        try {
          const cotisation = await prisma.$transaction((tx) => recordCotisationPayment(tx, {
            associationId: existingCotisation.associationId,
            cotisationId,
            amount:        chargedAmount,
            method:        "En ligne",
            paidAt,
            source:        "STRIPE",
            reference:     paymentIntentId,
            exerciceId:    exercice?.status === "OUVERT" ? exercice.id : null,
          }))

          await sendCotisationPaymentConfirmation(cotisation, chargedAmount)

          await writeActivityLog({
            associationId: cotisation.associationId,
            action:        "COTISATION_PAID",
            entity:        "Cotisation",
            entityId:      cotisationId,
            label:         `${cotisation.membre.firstName} ${cotisation.membre.lastName} — ${cotisation.year}`,
            metadata:      { amount: chargedAmount },
          })

          // Adhésion remplie par un gestionnaire (admin-registration/route.ts) : le Membre
          // existe sans compte, et ce paiement — via le lien public tokenisé — est le moment
          // où la personne rejoint vraiment. On lui crée donc son accès portail (email
          // d'identifiants, mot de passe modifiable) et on notifie les gestionnaires, comme
          // une inscription self-service le fait au checkout. Le garde membre.userId == null
          // exclut naturellement tous les autres chemins : un paiement portail ou une
          // inscription publique ont toujours déjà un compte à ce stade.
          // .catch(null) : le paiement est déjà enregistré à ce stade — un pépin sur cette
          // lecture de confort ne doit ni faire échouer le webhook ni provoquer un retry
          // Stripe (qui ré-enregistrerait un paiement partiel).
          const paidCot = await prisma.cotisation.findUnique({
            where:  { id: cotisationId },
            select: {
              membershipForm: { select: { title: true, adminNotificationEmail: true } },
              membre:         { select: { id: true, firstName: true, lastName: true, email: true, userId: true } },
              association:    { select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true } },
            },
          }).catch(() => null)
          if (paidCot && paidCot.membre.email && !paidCot.membre.userId) {
            await grantMembrePortalAccess({
              membre:        paidCot.membre,
              associationId: existingCotisation.associationId,
              actorId:       null,
              association:   paidCot.association,
            }).catch(() => {})
            if (paidCot.membershipForm) {
              await notifyMembershipSignup({
                associationId:          existingCotisation.associationId,
                formTitle:              paidCot.membershipForm.title,
                adminNotificationEmail: paidCot.membershipForm.adminNotificationEmail,
                memberNames:            [`${paidCot.membre.firstName} ${paidCot.membre.lastName}`],
                amount:                 chargedAmount,
                primaryMembreId:        paidCot.membre.id,
              }).catch(() => {})
            }
          }
        } catch (err) {
          if (err instanceof CotisationOverpaymentError) {
            // Stripe already captured the charge — there's no "reject" available at this
            // point, only a rare race (an admin recorded a manual payment while this
            // checkout session was still open for the old, larger remaining balance).
            // recordCotisationPayment's transaction rolled back entirely on the throw, so
            // without this the money would be captured by Stripe but show up nowhere in the
            // app at all. Recorded as a plain Income (not linked to a CotisationPayment,
            // since crediting it there would just push amountPaid past the total again) so
            // it's at least visible for reconciliation, and flagged to finance-role admins
            // as an active notification rather than left buried in the activity log — real
            // money moved and someone needs to follow up with the member.
            await prisma.income.create({
              data: {
                associationId: existingCotisation.associationId,
                amount:        chargedAmount,
                description:   `Cotisation ${cotisationId} — payée en trop via Stripe, à vérifier`,
                source:        "STRIPE",
                status:        "PAID",
                date:          paidAt,
                reference:     paymentIntentId,
              },
            })

            await writeActivityLog({
              associationId: existingCotisation.associationId,
              action:        "COTISATION_PAYMENT_OVERPAID_STRIPE",
              entity:        "Cotisation",
              entityId:      cotisationId,
              metadata:      { chargedAmount, remainingAtCapture: err.remaining, paymentIntentId },
            })

            const admins = await prisma.user.findMany({
              where:  { associationId: existingCotisation.associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER"] }, active: true },
              select: { id: true },
            })
            if (admins.length) {
              const amountLabel = chargedAmount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
              await prisma.notification.createMany({
                data: admins.map(a => ({
                  userId: a.id,
                  title:  "Cotisation payée en trop",
                  body:   `Un paiement Stripe de ${amountLabel} a été reçu pour une cotisation déjà réglée entre-temps (probablement un paiement manuel enregistré pendant que le membre payait en ligne). Vérifiez et contactez le membre si besoin.`,
                  link:   "/dashboard/cotisations",
                  scope:  "GESTION",
                })),
                skipDuplicates: true,
              })
              await pusherServer.trigger(`private-association-${existingCotisation.associationId}`, "new-notification", {}).catch(() => {})
            }
            break
          }
          throw err
        }
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
            ticketType: { select: { price: true } },
            evenement: {
              select: {
                title:        true,
                price:        true,
                date:         true,
                location:     true,
                associationId: true,
                adminNotificationEmail: true,
                association:  { select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true } },
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
          // Each seat's own ticket type (once the event has any) drives its amount — a
          // mixed-tier order (e.g. one free seat, one paid) can no longer be split evenly
          // across the order the way a flat single-price order always could. Falls back to
          // the event's current price for untiered tickets, same acceptable-risk trade-off
          // the flat-price path already made: an admin could have edited the price while
          // the checkout session was still open. This amount also drives later self-service
          // refunds (cancel-ticket route), so getting it wrong here can make a refund
          // attempt exceed what was ever charged.
          const ticketAmounts = new Map(tickets.map(t => [t.id, Number(t.ticketType?.price ?? evenement.price ?? 0)]))
          const totalAmount   = [...ticketAmounts.values()].reduce((sum, a) => sum + a, 0)

          // Best-effort exercice link — never blocks, same reasoning as the other branches.
          const exercice = await resolveExerciceForDate(evenement.associationId, paidAt)

          await prisma.$transaction(
            tickets.map(t => prisma.participation.update({ where: { id: t.id }, data: { amount: ticketAmounts.get(t.id) } })),
          )

          // One Income row per seat (not a single lump sum) so cancelling a single
          // companion later can remove just that seat's revenue without touching the rest.
          await prisma.income.createMany({
            data: tickets.map(t => ({
              associationId:   evenement.associationId,
              exerciceId:      exercice?.status === "OUVERT" ? exercice.id : null,
              memberId:        t.membreId,
              participationId: t.id,
              amount:          ticketAmounts.get(t.id)!,
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
          if (evenement.association) {
            const assoc = evenement.association
            const portalUrl = `${APP_URL}/portal/${assoc.slug}/evenements`
            // A member's own ticket is already cancellable from the authenticated portal,
            // so a Portal order (some ticket tied to a membreId) still gets a single
            // combined confirmation sent to the buyer, same as before. A public order (no
            // membreId on any ticket) can have several attendees with their own emails and
            // its per-seat cancellation link (src/app/api/public/cancel-ticket/[token]/route.ts)
            // is self-service per attendee, so each of them gets their own confirmation
            // email with their own cancel link instead of one shared email.
            const isPublicOrder = tickets.every(t => !t.membreId)
            const ticketQrFor = (t: (typeof tickets)[number]) => t.ticketToken
              ? {
                  name:     `${t.firstName} ${t.lastName}`,
                  imageUrl: `${APP_URL}/api/public/billet/${t.ticketToken}/qr`,
                  pageUrl:  `${APP_URL}/billet/${t.ticketToken}`,
                }
              : null
            // Awaited (not fire-and-forget) — a serverless webhook handler can have its
            // execution frozen right after it responds, which would otherwise risk some
            // of these emails never actually going out.
            if (isPublicOrder) {
              await Promise.allSettled(tickets.filter(t => t.email).map(t => sendEmail(ticketPurchaseEmail({
                firstName:       t.firstName,
                email:           t.email!,
                associationName: assoc.name,
                eventTitle:      evenement.title,
                eventDate:       evenement.date,
                eventLocation:   evenement.location,
                amount:          ticketAmounts.get(t.id)!,
                quantity:        1,
                paidAt,
                portalUrl,
                cancelUrl:       t.cancelToken ? `${APP_URL}/annulation/${t.cancelToken}` : undefined,
                ticketQrs:       ticketQrFor(t) ? [ticketQrFor(t)!] : undefined,
                branding:        resolveDocumentBranding(assoc),
              }), { associationId: evenement.associationId, source: "TRANSACTION", sourceId: orderId }).catch(() => {})))
            } else if (buyerTicket.email) {
              // The buyer's single combined email carries every seat's QR (theirs + their
              // guests') — guests may have no email of their own, and the party typically
              // arrives together with the buyer's phone.
              const allQrs = tickets.map(ticketQrFor).filter((qr): qr is NonNullable<typeof qr> => qr !== null)
              await sendEmail(ticketPurchaseEmail({
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
                cancelUrl:       undefined,
                ticketQrs:       allQrs.length ? allQrs : undefined,
                branding:        resolveDocumentBranding(assoc),
              }), { associationId: evenement.associationId, membreId: buyerTicket.membreId ?? undefined, source: "TRANSACTION", sourceId: orderId }).catch(() => {})
            }
          }

          // This is the "a ticket sold" moment — the paid path deliberately notifies from
          // here rather than from the route that opened the checkout session, which only
          // ever means someone *started* paying. Outside the `evenement.association` block
          // above so a missing association relation costs the confirmation emails but not
          // the organizer's own notification. Awaited for the same reason as those emails.
          await notifyEventRegistration({
            associationId:  evenement.associationId,
            evenementId:    buyerTicket.evenementId,
            eventTitle:     evenement.title,
            eventDate:      evenement.date,
            attendeeNames:  tickets.map(t => `${t.firstName} ${t.lastName}`),
            amount:         totalAmount,
            adminNotificationEmail: evenement.adminNotificationEmail,
            membreId:       buyerTicket.membreId ?? undefined,
          }).catch(() => {})
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
          include: {
            association: { select: { id: true, name: true, address: true, city: true, siren: true, rna: true, canIssueTaxReceipts: true, objet: true, organismeCategory: true, organismeCategoryDetail: true, plan: true, customBrandingEnabled: true, logoUrl: true } },
          },
        })
        if (!don) break

        // Snapshotted onto the Don at creation time (see schema.prisma) — standalone dons
        // (no tier) keep the prior behavior of always receipting when the association can
        // issue them.
        const issueReceipt = don.receiptMode !== "NONE"

        // Best-effort exercice link — never blocks, same reasoning as the other branches.
        const exercice = await resolveExerciceForDate(don.associationId, paidAt)

        await prisma.income.create({
          data: {
            associationId: don.associationId,
            exerciceId:    exercice?.status === "OUVERT" ? exercice.id : null,
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

          if (assoc.canIssueTaxReceipts && issueReceipt) {
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
                      scope:  "GESTION",
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
              canIssueTaxReceipts: assoc.canIssueTaxReceipts && issueReceipt,
              receiptNumber:       refreshed?.receiptNumber ?? undefined,
              donorType:           don.donorType,
              deductibleAmount:    don.receiptMode === "PARTIAL" && don.deductibleAmount != null ? Number(don.deductibleAmount) : undefined,
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

      const { cotisationId, orderId, donId, commandeId, associationId, draftId } = paymentIntent.metadata

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
          // so the cut is spread proportionally to each row's own original amount — an
          // even split only holds when every seat in the order was priced identically,
          // which ticket tiers no longer guarantee (a mixed free+paid order would otherwise
          // dock the free seat's already-zero income just as much as the paid one).
          const incomes = await prisma.income.findMany({ where: { reference: paymentIntentId, status: "PAID" } })
          if (incomes.length) {
            const refundedEuros = charge.amount_refunded / 100
            const totalOriginal = incomes.reduce((sum, i) => sum + Number(i.amount), 0)
            await prisma.$transaction(
              incomes.map(i => {
                const share = totalOriginal > 0
                  ? (Number(i.amount) / totalOriginal) * refundedEuros
                  : refundedEuros / incomes.length
                return prisma.income.update({
                  where: { id: i.id },
                  data:  { amount: Math.max(0, Number(i.amount) - share) },
                })
              })
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
                scope:  "GESTION",
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
        // The Income row itself was already soft-cancelled by the generic reference-matched
        // update above (kept for the audit trail, like the don/order paths) — this just
        // brings amountPaid/status back in line with that, rather than deleting anything.
        // Status isn't simply reset to EN_ATTENTE: if the due date has since passed, the
        // refunded cotisation should land on EN_RETARD, not silently look on-time again.
        const cotisationForRefund = await prisma.cotisation.findFirst({
          where:  { id: cotisationId, status: "PAYE" },
          select: { amount: true, dueDate: true, installments: { select: { amount: true, dueDate: true, order: true } } },
        })
        if (cotisationForRefund) {
          const refundedStatus = deriveCotisationStatus({
            currentStatus: "EN_ATTENTE",
            amount:        Number(cotisationForRefund.amount),
            amountPaid:    0,
            dueDate:       cotisationForRefund.dueDate,
            installments:  cotisationForRefund.installments.map(i => ({ amount: Number(i.amount), dueDate: i.dueDate, order: i.order })),
          })
          await prisma.cotisation.update({
            where: { id: cotisationId },
            data:  { status: refundedStatus, paidAt: null, amountPaid: 0 },
          })
          if (associationId) {
            await writeActivityLog({ associationId, action: "COTISATION_REFUNDED", entity: "Cotisation", entityId: cotisationId })
          }
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
      } else if (draftId && associationId) {
        // A fully-refunded multi-registrant MembershipForm payment (see checkout/route.ts's
        // "Ajouter un autre adhérent" and src/lib/webhook/membership-multi.ts) — unlike the
        // branches above, there's no single Cotisation/Don id to flip back: the draft already
        // fanned out into N Membre/Cotisation rows by the time a refund could happen. Auto-
        // reversing all of them safely (without also undoing a since-independent status
        // change on one of them) is out of scope here — this is the same "make sure a human
        // finds out" fallback the partial-refund branch above already uses, just for the case
        // where nothing above applies.
        await writeActivityLog({ associationId, action: "MEMBERSHIP_GROUP_REFUNDED", entity: "MembershipCheckoutDraft", entityId: draftId })
        const admins = await prisma.user.findMany({
          where:  { associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER"] }, active: true },
          select: { id: true },
        })
        if (admins.length) {
          const amountLabel = (charge.amount_refunded / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
          await prisma.notification.createMany({
            data: admins.map(a => ({
              userId: a.id,
              title:  "Adhésion groupée remboursée",
              body:   `Un remboursement total de ${amountLabel} a été reçu pour une inscription groupée. Les comptes créés n'ont pas été annulés automatiquement — vérifiez et corrigez manuellement si besoin.`,
              link:   "/dashboard/membres",
              scope:  "GESTION",
            })),
            skipDuplicates: true,
          })
          await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {}).catch(() => {})
        }
      }
      break
    }

    // ── SaaS subscription lifecycle ───────────────────────────────────────
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription

      // MUST run before anything else in this handler — a donor's recurring-donation
      // Subscription lands on this exact event type too (same platform Stripe account,
      // Connect destination charges). Falling through into the Association logic below
      // for one would silently overwrite an association's plan/subscriptionStatus based
      // on a stranger's 5€/month donation. See the module for the full explanation.
      if (isDonationSubscriptionEvent(sub)) {
        await handleDonationSubscriptionSynced(sub)
        break
      }
      if (isCotisationSubscriptionEvent(sub)) {
        await handleCotisationSubscriptionSynced(sub)
        break
      }
      // Nothing to sync — an installment plan's own status (ACTIVE/COMPLETED/CANCELLED) is
      // driven entirely by invoice.paid/customer.subscription.deleted, not by Stripe's
      // subscription status field. Still needs to short-circuit here, same reasoning as the
      // two branches above: falling through would otherwise try to match this Subscription's
      // id against Association.stripeSubscriptionId.
      if (isMembershipInstallmentEvent(sub)) break

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
                  scope:  "GESTION",
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

      // Same discrimination as customer.subscription.created/updated above — a donor
      // stopping their recurring gift must never be able to cancel an association's
      // Formwise subscription.
      if (isDonationSubscriptionEvent(sub)) {
        await handleDonationSubscriptionDeleted(sub)
        break
      }
      if (isCotisationSubscriptionEvent(sub)) {
        await handleCotisationSubscriptionDeleted(sub)
        break
      }
      if (isMembershipInstallmentEvent(sub)) {
        await handleMembershipInstallmentDeleted(sub)
        break
      }

      await prisma.association.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data:  { subscriptionStatus: "CANCELLED", suspendedAt: null, cancelAtPeriodEnd: false, currentPeriodEndsAt: null },
      })
      break
    }

    // Every successful recurring-donation charge (including the very first one — see the
    // module) — nothing here concerns platform billing, so unlike the shared subscription
    // events above there's no existing logic to guard: this case simply doesn't exist for
    // anything else on this endpoint.
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice
      await handleDonationInvoicePaid(invoice)
      await handleCotisationInvoicePaid(invoice)
      await handleInstallmentInvoicePaid(invoice)
      break
    }

    // A failed subscription charge otherwise only surfaces once the account is already
    // SUSPENDED (via customer.subscription.updated, after Stripe's dunning retries run
    // out) — nothing tells the admin about the very first failed attempt, so they only
    // find out once they're already locked out. This fires proactively, once per invoice
    // attempt, so they can fix the card before that happens.
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice

      // Discriminated by invoice.subscription → DonationSubscription lookup rather than
      // metadata: Stripe doesn't copy a Subscription's metadata onto the invoices it
      // generates, so metadata.kind isn't reliably present here the way it is on the
      // Subscription object itself in the two handlers above.
      if (await tryHandleDonationInvoicePaymentFailed(invoice, event.id)) break
      if (await tryHandleCotisationInvoicePaymentFailed(invoice, event.id)) break
      if (await tryHandleInstallmentInvoicePaymentFailed(invoice, event.id)) break

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

      const billingUrl    = `${APP_URL}/dashboard/parametres`
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
          scope:  "GESTION",
        })),
        skipDuplicates: true,
      })
      await pusherServer.trigger(`private-association-${assoc.id}`, "new-notification", {}).catch(() => {})

      break
    }
  }

  return NextResponse.json({ received: true })
}
