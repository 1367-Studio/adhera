import { isSpokenLanguage } from "@/lib/languages"
import { randomBytes } from "crypto"
import { addMonths } from "date-fns"
import Stripe from "stripe"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { stripe } from "@/lib/stripe"
import { sendEmail } from "@/lib/mail"
import { membershipWelcomeEmail, membershipInstallmentPaymentFailedEmail, membershipInstallmentPaymentFailedAdminEmail } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { resolveExerciceForDate } from "@/lib/finance/exercice"
import { recordCotisationPayment, sendCotisationPaymentConfirmation } from "@/lib/cotisation-payments"
import { currentCotisationYear } from "@/lib/membre-adherent"
import { pusherServer } from "@/lib/pusher-server"
import { fireEventRule } from "@/lib/fire-event-rule"
import { APP_URL } from "@/lib/env"
import { notifyMembershipSignup } from "@/lib/webhook/membership-notify"

// ─── Discrimination ────────────────────────────────────────────────────────────
//
// Same reasoning as isCotisationSubscriptionEvent (src/lib/webhook/cotisation-subscriptions.ts)
// — this Subscription shares the platform Stripe account with every other kind this webhook
// handles, tagged subscription_data.metadata.kind = "membership-installment" at checkout time
// specifically so the shared customer.subscription.* handlers in route.ts can dispatch here
// before running any unrelated Association-billing/donation/membership logic.
export function isMembershipInstallmentEvent(sub: Stripe.Subscription): boolean {
  return sub.metadata?.kind === "membership-installment"
}

// Same API-version note as cotisation-subscriptions.ts's own copy of this helper.
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = invoice.parent?.subscription_details?.subscription
  return typeof sub === "string" ? sub : sub?.id ?? null
}

// ─── checkout.session.completed (mode: "subscription", kind: "membership-installment") ──
//
// Unlike handleCotisationSubscriptionCheckout (a genuine recurring membership, one new
// Cotisation per year forever), this Subscription exists purely to bill installmentsCount
// fixed monthly charges against ONE Cotisation created right here — see
// handleInstallmentInvoicePaid below, which never creates a second Cotisation the way
// handleCotisationInvoicePaid does for real renewals.
export async function handleMembershipInstallmentCheckout(session: Stripe.Checkout.Session) {
  const meta = session.metadata
  if (!meta?.kind || meta.kind !== "membership-installment" || !meta.associationId || !meta.email || !meta.passwordHash) return
  if (!meta.installmentsCount || !meta.perInstallmentAmount) return

  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id
  const customerId      = typeof session.customer === "string" ? session.customer : session.customer?.id
  if (!subscriptionId || !customerId) return

  // Redelivery of the same event — the row was already created by an earlier delivery.
  const existing = await prisma.cotisationInstallmentPlan.findUnique({ where: { stripeSubscriptionId: subscriptionId } })
  if (existing) return

  const sub               = await stripe.subscriptions.retrieve(subscriptionId)
  const installmentsCount = Number(meta.installmentsCount)
  const perInstallment    = Number(meta.perInstallmentAmount)
  // What's actually going to be collected over installmentsCount cycles — may be a few cents
  // above the tier's nominal amount (see checkout/route.ts's Math.ceil comment), stored here
  // rather than the tier's own amount so recordCotisationPayment's overpayment guard never
  // misfires on the final installment.
  const totalAmount = Math.round(perInstallment * installmentsCount * 100) / 100
  const startedAt   = new Date(sub.start_date * 1000)

  const [assoc, form] = await Promise.all([
    prisma.association.findUnique({
      where:  { id: meta.associationId },
      select: { name: true, slug: true, modules: true, plan: true, customBrandingEnabled: true, logoUrl: true, canIssueTaxReceipts: true },
    }),
    meta.membershipFormId
      ? prisma.membershipForm.findUnique({ where: { id: meta.membershipFormId }, select: { title: true, adminNotificationEmail: true } })
      : Promise.resolve(null),
  ])

  let created
  try {
    created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email:           meta.email,
          name:            `${meta.firstName} ${meta.lastName}`,
          passwordHash:    meta.passwordHash,
          role:            "MEMBRE",
          associationId:   meta.associationId,
          termsAcceptedAt: new Date(),
          termsVersion:    meta.termsVersion || undefined,
          termsAcceptedIp: meta.termsAcceptedIp || undefined,
        },
      })

      const membre = await tx.membre.create({
        data: {
          firstName:     meta.firstName ?? "",
          lastName:      meta.lastName ?? "",
          email:         meta.email,
          phone:         meta.phone || null,
          address:       meta.address || null,
          birthDate:     meta.birthDate ? new Date(meta.birthDate) : null,
          sexe:          meta.sexe === "HOMME" || meta.sexe === "FEMME" ? meta.sexe : null,
          spokenLanguage: isSpokenLanguage(meta.spokenLanguage) ? meta.spokenLanguage : null,
          photoUrl:      meta.photoUrl || null,
          preferredLocale: meta.locale || null,
          status:        "ACTIF",
          associationId: meta.associationId,
          typeId:        meta.typeId || null,
          userId:        user.id,
          answers:       meta.answers ? JSON.parse(meta.answers) : undefined,
        },
      })

      const cotisation = await tx.cotisation.create({
        data: {
          membreId:      membre.id,
          associationId: meta.associationId,
          year:          currentCotisationYear(startedAt),
          amount:        totalAmount,
          amountPaid:    0,
          status:        "EN_ATTENTE",
          membershipFormId: meta.membershipFormId || null,
          tierId:           meta.tierId || null,
          periodStart:      meta.periodStart ? new Date(meta.periodStart) : null,
          periodEnd:        meta.periodEnd ? new Date(meta.periodEnd) : null,
          receiptMode:      meta.receiptMode as "NONE" | "FULL" | "PARTIAL",
          deductibleAmount: meta.deductibleAmount ? Number(meta.deductibleAmount) : null,
          installments: {
            // Due dates mirror when Stripe will actually invoice each cycle (t=0, 1mo, ...,
            // (installmentsCount-1)mo) — cosmetic/display only (see InstallmentSchedule in
            // the portal), the real collection is driven entirely by Stripe's own billing.
            create: Array.from({ length: installmentsCount }, (_, i) => ({
              amount:  perInstallment,
              dueDate: addMonths(startedAt, i),
              order:   i,
            })),
          },
          installmentPlan: {
            create: {
              associationId:        meta.associationId,
              stripeSubscriptionId: subscriptionId,
              stripeCustomerId:     customerId,
              cancelToken:          randomBytes(20).toString("hex"),
              installmentsCount,
            },
          },
        },
      })

      return { user, membre, cotisation }
    })
  } catch (err) {
    // The person has already paid the first installment at this point — same "can't
    // auto-recover, so make sure a person finds out" reasoning as handleCotisationSubscription
    // Checkout's own catch block.
    console.error(`[membership-installments] failed to create account for subscription ${subscriptionId} (association ${meta.associationId}, email ${meta.email}):`, err)
    const isDuplicateEmail = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
    const admins = await prisma.user.findMany({
      where:  { associationId: meta.associationId, role: { in: ["ADMIN", "PRESIDENT"] }, active: true },
      select: { id: true },
    })
    if (admins.length) {
      await prisma.notification.createMany({
        data: admins.map(a => ({
          userId: a.id,
          title:  "Adhésion payée sans compte créé",
          body:   `${meta.firstName} ${meta.lastName} (${meta.email}) a payé la 1ère mensualité de son adhésion mais son compte n'a pas pu être créé automatiquement${isDuplicateEmail ? " (email déjà utilisé)" : ""}. Créez-le manuellement.`,
          link:   "/dashboard/membres",
          scope:  "GESTION",
        })),
        skipDuplicates: true,
      })
      await pusherServer.trigger(`private-association-${meta.associationId}`, "new-notification", {}).catch(() => {})
    }
    return
  }

  // Caps billing at installmentsCount cycles — Checkout's subscription_data has no cancel_at
  // field (only settable on the Subscription resource once it exists, see checkout/route.ts),
  // so this is the earliest point it can be applied. A failure here is not silently
  // acceptable — without it the subscription renews indefinitely, charging the member every
  // month beyond what they agreed to — so it pages the association's admins directly rather
  // than only logging, since nothing else in this flow would ever surface that mismatch.
  await stripe.subscriptions.update(subscriptionId, {
    cancel_at: Math.floor(addMonths(startedAt, installmentsCount).getTime() / 1000),
  }).catch(async err => {
    console.error(`[membership-installments] failed to cap subscription ${subscriptionId} at ${installmentsCount} cycles:`, err)
    const admins = await prisma.user.findMany({
      where:  { associationId: meta.associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER"] }, active: true },
      select: { id: true },
    })
    if (admins.length) {
      await prisma.notification.createMany({
        data: admins.map(a => ({
          userId: a.id,
          title:  "Échéancier automatique à vérifier manuellement",
          body:   `Le paiement en ${installmentsCount} fois de ${created.membre.firstName} ${created.membre.lastName} n'a pas pu être limité automatiquement — l'abonnement Stripe pourrait continuer à prélever au-delà des ${installmentsCount} mensualités prévues. Vérifiez-le manuellement dans le dashboard Stripe.`,
          link:   `/dashboard/membres/${created.membre.id}`,
          scope:  "GESTION",
        })),
        skipDuplicates: true,
      })
      await pusherServer.trigger(`private-association-${meta.associationId}`, "new-notification", {}).catch(() => {})
    }
  })

  if (assoc?.slug) {
    sendEmail(membershipWelcomeEmail({
      firstName:       created.membre.firstName,
      email:           meta.email,
      associationName: assoc.name,
      amount:          totalAmount,
      loginUrl:        `${APP_URL}/portal/${assoc.slug}/login`,
      branding:        resolveDocumentBranding(assoc),
      canIssueTaxReceipts: assoc.canIssueTaxReceipts,
      receiptMode:         meta.receiptMode as "NONE" | "FULL" | "PARTIAL",
      deductibleAmount:    meta.deductibleAmount ? Number(meta.deductibleAmount) : undefined,
    }), { associationId: meta.associationId, membreId: created.membre.id, source: "TRANSACTION", sourceId: created.cotisation.id }).catch(() => {})

    fireEventRule({
      triggerType: "MEMBER_CREATED",
      associationId: meta.associationId,
      association: { name: assoc.name, slug: assoc.slug, modules: assoc.modules, plan: assoc.plan, customBrandingEnabled: assoc.customBrandingEnabled, logoUrl: assoc.logoUrl },
      membre: { id: created.membre.id, firstName: created.membre.firstName, lastName: created.membre.lastName, email: created.membre.email, phone: created.membre.phone },
    }).catch(() => {})
  }

  if (form) {
    notifyMembershipSignup({
      associationId: meta.associationId, formTitle: form.title, adminNotificationEmail: form.adminNotificationEmail,
      memberNames: [`${created.membre.firstName} ${created.membre.lastName}`], amount: totalAmount, primaryMembreId: created.membre.id,
    }).catch(() => {})
  }

  await writeActivityLog({
    associationId: meta.associationId,
    action:        "MEMBRE_CREATED",
    entity:        "Membre",
    entityId:      created.membre.id,
    label:         `${created.membre.firstName} ${created.membre.lastName} (paiement en ${installmentsCount} fois)`,
  })
}

// ─── invoice.paid ────────────────────────────────────────────────────────────────
//
// Fires once per installment charge, including the very first one. Every charge applies to
// the SAME Cotisation created in handleMembershipInstallmentCheckout above — unlike
// handleCotisationInvoicePaid, there is no per-year upsert here.
export async function handleInstallmentInvoicePaid(invoice: Stripe.Invoice) {
  const subscriptionId = invoiceSubscriptionId(invoice)
  if (!subscriptionId) return

  const plan = await prisma.cotisationInstallmentPlan.findUnique({
    where:  { stripeSubscriptionId: subscriptionId },
    select: { id: true, associationId: true, cotisationId: true, installmentsCount: true, installmentsPaid: true, status: true },
  })
  if (!plan) return // Not an installment plan — nothing here concerns this invoice.
  if (plan.status === "COMPLETED") return // Redelivered event for a plan already fully paid.

  const amount = invoice.amount_paid / 100
  if (amount <= 0) return

  const paidAt = invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : new Date()

  const cotisation = await prisma.cotisation.findUnique({ where: { id: plan.cotisationId }, select: { status: true } })
  // Already fully paid (e.g. an admin recorded a manual payment in the meantime) —
  // recordCotisationPayment would throw on the overpayment guard, and there's nothing left
  // for this charge to represent on our side even though Stripe did capture it — same
  // acceptance as handleCotisationInvoicePaid's identical guard.
  if (cotisation?.status === "PAYE") return

  const exercice = await resolveExerciceForDate(plan.associationId, paidAt)

  const updated = await prisma.$transaction((tx) => recordCotisationPayment(tx, {
    associationId: plan.associationId,
    cotisationId:  plan.cotisationId,
    amount,
    method:        "Prélèvement automatique (échéance)",
    paidAt,
    source:        "STRIPE",
    reference:     invoice.id,
    exerciceId:    exercice?.status === "OUVERT" ? exercice.id : null,
  }))

  const installmentsPaid = plan.installmentsPaid + 1
  await prisma.cotisationInstallmentPlan.update({
    where: { id: plan.id },
    data:  {
      installmentsPaid,
      status: installmentsPaid >= plan.installmentsCount ? "COMPLETED" : plan.status,
    },
  })

  await sendCotisationPaymentConfirmation(updated, amount)

  await writeActivityLog({
    associationId: plan.associationId,
    action:        "COTISATION_PAID",
    entity:        "Cotisation",
    entityId:      plan.cotisationId,
    label:         `${updated.membre.firstName} ${updated.membre.lastName} — échéance ${installmentsPaid}/${plan.installmentsCount}`,
    metadata:      { amount },
  })
}

// ─── invoice.payment_failed ──────────────────────────────────────────────────────
//
// Returns true when this invoice belonged to an installment plan (handled here, caller must
// not fall through to the platform-billing branch) and false otherwise. Stripe's own dunning
// retries the failed cycle a few times before giving up — see handleMembershipInstallment
// Deleted for what happens if every retry fails.
export async function tryHandleInstallmentInvoicePaymentFailed(invoice: Stripe.Invoice, eventId: string): Promise<boolean> {
  const subscriptionId = invoiceSubscriptionId(invoice)
  if (!subscriptionId) return false

  const plan = await prisma.cotisationInstallmentPlan.findUnique({
    where:   { stripeSubscriptionId: subscriptionId },
    include: {
      cotisation:  { select: { membreId: true, membre: { select: { firstName: true, lastName: true, email: true } } } },
      association: { select: { name: true } },
    },
  })
  if (!plan) return false

  // Stripe can redeliver this event for the same failed attempt.
  const alreadyProcessed = await prisma.activityLog.findFirst({
    where: {
      associationId: plan.associationId,
      action:        "COTISATION_INSTALLMENT_PAYMENT_FAILED",
      entityId:      invoice.id,
      metadata:      { path: ["stripeEventId"], equals: eventId },
    },
    select: { id: true },
  })
  if (alreadyProcessed) return true

  const amount           = invoice.amount_due / 100
  const memberName       = `${plan.cotisation.membre.firstName} ${plan.cotisation.membre.lastName}`
  const nextAttemptAt    = invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000) : null
  const installmentNumber = plan.installmentsPaid + 1

  await writeActivityLog({
    associationId: plan.associationId,
    action:        "COTISATION_INSTALLMENT_PAYMENT_FAILED",
    entity:        "CotisationInstallmentPlan",
    entityId:      plan.id,
    label:         memberName,
    metadata:      { amountDue: invoice.amount_due, attemptCount: invoice.attempt_count, stripeEventId: eventId },
  })

  if (plan.cotisation.membre.email && plan.cancelToken) {
    const assoc = await prisma.association.findUnique({
      where:  { id: plan.associationId },
      select: { plan: true, customBrandingEnabled: true, logoUrl: true },
    })
    sendEmail(membershipInstallmentPaymentFailedEmail({
      firstName:       plan.cotisation.membre.firstName,
      email:           plan.cotisation.membre.email,
      associationName: plan.association.name,
      amount, nextAttemptAt,
      installmentNumber, installmentsCount: plan.installmentsCount,
      cancelUrl: `${APP_URL}/adhesion/annulation-echeancier/${plan.cancelToken}`,
      branding:  assoc ? resolveDocumentBranding(assoc) : undefined,
    }), { associationId: plan.associationId, membreId: plan.cotisation.membreId, source: "TRANSACTION", sourceId: plan.id }).catch(() => {})
  }

  const admins = await prisma.user.findMany({
    where:  { associationId: plan.associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER"] }, active: true },
    select: { id: true, email: true },
  })
  if (admins.length) {
    const dashboardUrl = `${APP_URL}/dashboard/membres/${plan.cotisation.membreId}`
    await prisma.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        title:  "Échec de prélèvement d'une mensualité",
        body:   `Le prélèvement automatique de ${amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} (échéance ${installmentNumber}/${plan.installmentsCount}) pour ${memberName} a échoué.`,
        link:   `/dashboard/membres/${plan.cotisation.membreId}`,
        scope:  "GESTION",
      })),
      skipDuplicates: true,
    })
    await pusherServer.trigger(`private-association-${plan.associationId}`, "new-notification", {}).catch(() => {})

    for (const admin of admins) {
      if (!admin.email) continue
      sendEmail(membershipInstallmentPaymentFailedAdminEmail({
        email:           admin.email,
        associationName: plan.association.name,
        memberName, amount, installmentNumber, installmentsCount: plan.installmentsCount,
        dashboardUrl,
      }), { associationId: plan.associationId, source: "TRANSACTION", sourceId: plan.id })
        .catch(err => console.error(`[membership-installments] failed to email admin ${admin.email}:`, err))
    }
  }

  return true
}

// ─── customer.subscription.deleted ──────────────────────────────────────────────
export async function handleMembershipInstallmentDeleted(sub: Stripe.Subscription) {
  // Never overwrite a plan that already collected every installment — the cancel_at set in
  // handleMembershipInstallmentCheckout above triggers this same deletion event once the
  // final cycle completes, which is the expected, successful end of a plan's life, not a
  // cancellation.
  await prisma.cotisationInstallmentPlan.updateMany({
    where: { stripeSubscriptionId: sub.id, status: { not: "COMPLETED" } },
    data:  { status: "CANCELLED" },
  })
}

// ─── Cancellation from inside the app (admin dashboard) ──────────────────────────
//
// Mirrors cancelActiveCotisationSubscriptionForMembre — cancels immediately (not at period
// end), flips the DB status here rather than waiting on customer.subscription.deleted.
export async function cancelActiveInstallmentPlanForMembre(
  membreId: string,
  opts: { actorId?: string; label?: string } = {},
): Promise<boolean> {
  const plan = await prisma.cotisationInstallmentPlan.findFirst({
    where:  { cotisation: { membreId }, status: "ACTIVE" },
    select: { id: true, stripeSubscriptionId: true, associationId: true },
  })
  if (!plan) return false

  try {
    await stripe.subscriptions.cancel(plan.stripeSubscriptionId)
  } catch (err) {
    // Same reasoning as cancelActiveCotisationSubscriptionForMembre's identical guard — an
    // invalid-request error means Stripe already has nothing left to cancel.
    if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) {
      console.error(`[membership-installments] failed to cancel subscription ${plan.stripeSubscriptionId} for membre ${membreId}:`, err)
      return false
    }
  }

  await prisma.cotisationInstallmentPlan.update({
    where: { id: plan.id },
    data:  { status: "CANCELLED" },
  })

  await writeActivityLog({
    associationId: plan.associationId,
    actorId:       opts.actorId,
    action:        "COTISATION_INSTALLMENT_CANCELLED",
    entity:        "CotisationInstallmentPlan",
    entityId:      plan.id,
    label:         opts.label ?? "",
  })

  return true
}

// ─── Cancellation via the member's own unguessable link (see cancelToken) ────────
export async function cancelInstallmentPlanByToken(token: string): Promise<
  | { status: "ok" }
  | { status: "not-found" }
  | { status: "already-cancelled" }
  | { status: "error" }
> {
  const plan = await prisma.cotisationInstallmentPlan.findUnique({
    where:  { cancelToken: token },
    select: {
      id: true, status: true, stripeSubscriptionId: true, associationId: true,
      cotisation: { select: { membre: { select: { firstName: true, lastName: true } } } },
    },
  })
  if (!plan) return { status: "not-found" }
  if (plan.status !== "ACTIVE") return { status: "already-cancelled" }

  try {
    await stripe.subscriptions.cancel(plan.stripeSubscriptionId)
  } catch (err) {
    if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) {
      console.error(`[membership-installments] self-service cancel failed for plan ${plan.id}:`, err)
      return { status: "error" }
    }
  }

  await prisma.cotisationInstallmentPlan.update({
    where: { id: plan.id },
    data:  { status: "CANCELLED" },
  })

  await writeActivityLog({
    associationId: plan.associationId,
    action:        "COTISATION_INSTALLMENT_CANCELLED_BY_MEMBRE",
    entity:        "CotisationInstallmentPlan",
    entityId:      plan.id,
    label:         `${plan.cotisation.membre.firstName} ${plan.cotisation.membre.lastName}`,
  })

  return { status: "ok" }
}
