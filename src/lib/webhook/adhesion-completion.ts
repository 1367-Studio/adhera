import Stripe from "stripe"
import { prisma } from "@/lib/prisma/client"
import { stripe } from "@/lib/stripe"
import { sendEmail } from "@/lib/mail"
import { adhesionCompletionConfirmationEmail } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { recordCotisationPayment } from "@/lib/cotisation-payments"
import { resolveExerciceForDate } from "@/lib/finance/exercice"
import { currentCotisationYear } from "@/lib/membre-adherent"
import { isSpokenLanguage } from "@/lib/languages"
import { addressColumns } from "@/lib/address"
import { eligibleReceiptAmount } from "@/lib/receipt-eligibility"
import { pusherServer } from "@/lib/pusher-server"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"] as const

// Thrown (and caught) purely as control flow inside the transaction below — distinguishes
// "this specific delivery lost a benign race against another one" from every other failure
// mode, which does need a human's attention (see the transaction's catch block).
class AdhesionAlreadyHasCotisationError extends Error {}

// The member has already paid at this point — same "can't auto-recover, so make sure a
// human finds out" reasoning as handleMembershipOneOffCheckout's own catch block
// (membership-forms.ts). Unlike that one, there's no membre-limit edge case here (the
// Membre already existed), just: something about writing the paid-for Cotisation failed.
async function notifyManagersOfFailedCompletion(associationId: string, membreLabel: string, amount: number) {
  const managers = await prisma.user.findMany({
    where:  { associationId, role: { in: [...MANAGERS] }, active: true },
    select: { id: true },
  })
  if (!managers.length) return
  await prisma.notification.createMany({
    data: managers.map(m => ({
      userId: m.id,
      title:  "Paiement d'adhésion non enregistré",
      body:   `${membreLabel} a payé ${amount}€ pour finaliser son adhésion, mais l'enregistrement a échoué. Vérifiez et corrigez manuellement — l'argent a bien été reçu.`,
      link:   "/dashboard/membres",
      scope:  "GESTION",
    })),
    skipDuplicates: true,
  })
  await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {}).catch(() => {})
}

// ─── checkout.session.completed (mode: "payment", kind: "adhesion-completion") ─────
//
// The one-off "finish your adhésion" flow (src/app/[slug]/complete-adhesion/[token] +
// src/app/api/public/complete-adhesion/[token]/checkout) — see that checkout route's header
// comment for why this lives in its own isolated module instead of extending
// handleMembershipOneOffCheckout (membership-forms.ts). Same "identity rides through Stripe
// metadata" reasoning as that handler, except here the Membre already exists (self-
// registered via the portal, never billed) and must be updated, never (re-)created — no User/
// password is touched at all.
export async function handleAdhesionCompletion(session: Stripe.Checkout.Session) {
  const meta = session.metadata
  if (!meta?.kind || meta.kind !== "adhesion-completion" || !meta.membreId || !meta.tierId || !meta.formId) return

  const amount = (session.amount_total ?? 0) / 100
  if (amount <= 0) return

  // Redelivery of the same event — same dedupe convention as handleMembershipOneOffCheckout
  // (no unique Stripe object id to key a row on here either).
  const alreadyProcessed = await prisma.activityLog.findFirst({
    where: {
      action:   "MEMBRE_ADHESION_COMPLETED",
      entityId: meta.membreId,
      metadata: { path: ["stripeCheckoutSessionId"], equals: session.id },
    },
    select: { id: true },
  })
  if (alreadyProcessed) return

  const membre = await prisma.membre.findUnique({
    where:  { id: meta.membreId },
    select: {
      id: true, firstName: true, lastName: true, email: true, associationId: true,
      adhesionCompletionToken: true,
      association: { select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true } },
    },
  })
  // The token is cleared the moment this handler finishes — a redelivered or replayed event
  // for an already-completed link has nothing left to update.
  if (!membre || !membre.adhesionCompletionToken) return

  const tier = await prisma.membershipTier.findUnique({
    where:  { id: meta.tierId },
    select: { receiptMode: true, ineligibleAmount: true, membreTypeId: true, durationMonths: true, fixedPeriodEnd: true },
  })
  if (!tier) return

  const paidAt      = new Date()
  const periodStart = tier.fixedPeriodEnd || tier.durationMonths ? paidAt : null
  const periodEnd    = tier.fixedPeriodEnd ?? (tier.durationMonths ? new Date(paidAt.getTime() + tier.durationMonths * 30 * 24 * 60 * 60 * 1000) : null)
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id
  const exercice = await resolveExerciceForDate(membre.associationId, paidAt)
  const answers  = meta.answers ? JSON.parse(meta.answers) : undefined

  let cotisation
  try {
    cotisation = await prisma.$transaction(async (tx) => {
      // A concurrent redelivery of this same webhook event (Stripe does this) could both pass
      // the ActivityLog dedupe check above before either has written that row — this is the
      // second line of defense, checked from inside the transaction so it sees a delivery
      // that's already committed. Also covers an admin having manually added this member's
      // cotisation for the year in the meantime: either way, creating a second row for the
      // same (membreId, year) would violate the unique constraint below, so this is caught
      // deliberately rather than left to surface as a raw P2002 in the catch block.
      const existingCotisation = await tx.cotisation.findUnique({
        where:  { membreId_year: { membreId: membre.id, year: currentCotisationYear() } },
        select: { id: true },
      })
      if (existingCotisation) throw new AdhesionAlreadyHasCotisationError()

      await tx.membre.update({
        where: { id: membre.id },
        data: {
          phone:          meta.phone || null,
          ...addressColumns({
            street: meta.addressStreet, complement: meta.addressComplement,
            postalCode: meta.postalCode, city: meta.city, country: meta.country,
          }),
          birthDate:      meta.birthDate ? new Date(meta.birthDate) : null,
          sexe:           meta.sexe === "HOMME" || meta.sexe === "FEMME" ? meta.sexe : null,
          spokenLanguage: isSpokenLanguage(meta.spokenLanguage) ? meta.spokenLanguage : null,
          photoUrl:       meta.photoUrl || null,
          typeId:         tier.membreTypeId,
          answers:        answers ?? undefined,
          // Single-use: a redelivered/replayed event for this same session is caught by the
          // ActivityLog dedupe above, and any other link still pointing here should stop working
          // now that the adhésion it was for is actually settled.
          adhesionCompletionToken:   null,
          adhesionCompletionFormId:  null,
        },
      })

      let cotisation = await tx.cotisation.create({
        data: {
          membreId: membre.id, associationId: membre.associationId,
          year: currentCotisationYear(), amount, amountPaid: 0, status: "EN_ATTENTE",
          membershipFormId: meta.formId, tierId: meta.tierId,
          periodStart, periodEnd,
          receiptMode:      tier.receiptMode,
          deductibleAmount: eligibleReceiptAmount(amount, tier.receiptMode, tier.ineligibleAmount != null ? Number(tier.ineligibleAmount) : null),
        },
      })

      cotisation = await recordCotisationPayment(tx, {
        associationId: membre.associationId,
        cotisationId:  cotisation.id,
        amount,
        method:     "En ligne",
        paidAt,
        source:     "STRIPE",
        reference:  paymentIntentId ?? null,
        exerciceId: exercice?.status === "OUVERT" ? exercice.id : null,
      })

      return cotisation
    })
  } catch (err) {
    // A benign concurrent redelivery of the same event — the other delivery already
    // recorded this payment, nothing lost, no need to alert anyone.
    if (err instanceof AdhesionAlreadyHasCotisationError) return
    // Anything else: the member has already paid, so this can't just fail silently — see
    // notifyManagersOfFailedCompletion's own comment for why this mirrors
    // handleMembershipOneOffCheckout's catch block.
    console.error(`[adhesion-completion] failed to record payment for checkout session ${session.id} (membre ${membre.id}):`, err)
    await notifyManagersOfFailedCompletion(membre.associationId, `${membre.firstName} ${membre.lastName}`, amount).catch(() => {})
    return
  }

  if (paymentIntentId) {
    await stripe.paymentIntents.update(paymentIntentId, { metadata: { cotisationId: cotisation.id } }).catch(err => {
      console.error(`[adhesion-completion] failed to backfill paymentIntent metadata for refund reconciliation (session ${session.id}):`, err)
    })
  }

  if (membre.email) {
    sendEmail(adhesionCompletionConfirmationEmail({
      firstName: membre.firstName, email: membre.email, associationName: membre.association.name,
      amount, branding: resolveDocumentBranding(membre.association),
    }), { associationId: membre.associationId, membreId: membre.id, source: "TRANSACTION", sourceId: cotisation.id }).catch(() => {})
  }

  await writeActivityLog({
    associationId: membre.associationId,
    action:        "MEMBRE_ADHESION_COMPLETED",
    entity:        "Membre",
    entityId:      membre.id,
    label:         `${membre.firstName} ${membre.lastName} — ${amount}€`,
    metadata:      { stripeCheckoutSessionId: session.id, via: "complete-adhesion" },
  })
}
