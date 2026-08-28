import { randomBytes } from "crypto"
import { addMonths } from "date-fns"
import Stripe from "stripe"
import { Prisma, type CotisationSubscriptionStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { stripe, subscriptionPeriodEnd } from "@/lib/stripe"
import { sendEmail } from "@/lib/mail"
import {
  membershipSubscriptionStartedEmail, cotisationSubscriptionPaymentFailedEmail,
  cotisationSubscriptionPaymentFailedAdminEmail,
} from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { resolveExerciceForDate } from "@/lib/finance/exercice"
import { recordCotisationPayment, sendCotisationPaymentConfirmation } from "@/lib/cotisation-payments"
import { currentCotisationYear } from "@/lib/membre-adherent"
import { pusherServer } from "@/lib/pusher-server"
import { fireEventRule } from "@/lib/fire-event-rule"
import { APP_URL } from "@/lib/env"
import { createMembershipAddonPurchases } from "@/lib/webhook/membership-addons"
import { notifyMembershipSignup } from "@/lib/webhook/membership-notify"

// ─── Discrimination ────────────────────────────────────────────────────────────
//
// Same reasoning as isDonationSubscriptionEvent (src/lib/webhook/donation-subscriptions.ts):
// Connect destination-charges puts this Subscription on the same platform account as every
// other kind handled by this webhook, so every recurring cotisation is tagged
// subscription_data.metadata.kind = "cotisation" at checkout time specifically so the
// shared customer.subscription.* handlers in route.ts can dispatch here before running any
// unrelated Association-billing or donation logic.
export function isCotisationSubscriptionEvent(sub: Stripe.Subscription): boolean {
  return sub.metadata?.kind === "cotisation"
}

function toCotisationSubscriptionStatus(status: Stripe.Subscription.Status): CotisationSubscriptionStatus {
  if (status === "active" || status === "trialing") return "ACTIVE"
  if (status === "past_due" || status === "unpaid") return "PAST_DUE"
  return "CANCELLED"
}

// This API version moved the subscription id off Invoice's top level and onto
// invoice.parent.subscription_details.subscription — same helper as donation-subscriptions.ts.
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = invoice.parent?.subscription_details?.subscription
  return typeof sub === "string" ? sub : sub?.id ?? null
}

// ─── checkout.session.completed (mode: "subscription") ─────────────────────────
//
// Only checkout.session.completed proves the Stripe Subscription exists — it never
// carries payment state (that's invoice.paid, below). This is what turns the metadata
// carried since /api/public/[slug]/inscription/checkout into a real Membre, since there
// was nothing to create a row for before Stripe minted a subscription id.
export async function handleCotisationSubscriptionCheckout(session: Stripe.Checkout.Session) {
  const meta = session.metadata
  if (!meta?.kind || meta.kind !== "cotisation" || !meta.associationId || !meta.email || !meta.passwordHash) return

  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id
  const customerId      = typeof session.customer === "string" ? session.customer : session.customer?.id
  if (!subscriptionId || !customerId) return

  // Redelivery of the same event — the row was already created by an earlier delivery.
  const existing = await prisma.cotisationSubscription.findUnique({ where: { stripeSubscriptionId: subscriptionId } })
  if (existing) return

  const sub        = await stripe.subscriptions.retrieve(subscriptionId)
  const unitAmount = sub.items.data[0]?.price.unit_amount
  const amount     = unitAmount != null ? unitAmount / 100 : 0

  // Needed inside the transaction below (receiptMode on any embedded-donation addon) — fetched
  // once here rather than twice, since the rest of this handler already needs assoc afterwards.
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
          // address/birthDate/sexe/answers are only ever present when meta came from a
          // MembershipForm (see .../adhesion/[formSlug]/checkout/route.ts) — the legacy
          // /inscription/checkout route's metadata never sets these keys, so they're
          // undefined/"" there and every field below falls back to null exactly as before.
          address:       meta.address || null,
          birthDate:     meta.birthDate ? new Date(meta.birthDate) : null,
          sexe:          meta.sexe === "HOMME" || meta.sexe === "FEMME" ? meta.sexe : null,
          photoUrl:      meta.photoUrl || null,
          preferredLocale: meta.locale || null,
          status:        "ACTIF",
          associationId: meta.associationId,
          typeId:        meta.typeId || null,
          userId:        user.id,
          answers:       meta.answers ? JSON.parse(meta.answers) : undefined,
        },
      })

      const cotisationSubscription = await tx.cotisationSubscription.create({
        data: {
          associationId:        meta.associationId,
          membreId:              membre.id,
          stripeSubscriptionId:  subscriptionId,
          stripeCustomerId:      customerId,
          cancelToken:          randomBytes(20).toString("hex"),
          amount,
          status:               "ACTIVE",
          currentPeriodEndsAt:  subscriptionPeriodEnd(sub),
          // Set only when this subscription came from a MembershipForm (see
          // src/app/api/public/[slug]/adhesion/[formSlug]/checkout/route.ts) — null for the
          // legacy /inscription/checkout flow. Copied onto every yearly Cotisation this
          // subscription produces in handleCotisationInvoicePaid below.
          membershipFormId: meta.membershipFormId || null,
          tierId:           meta.tierId || null,
          // Snapshotted from MembershipTier.durationMonths at signup (see checkout/route.ts's
          // commonMeta comment) — null keeps the historical yearly-billing behavior exactly as
          // it was before this field existed.
          durationMonths:   meta.durationMonths ? Number(meta.durationMonths) : null,
          // Snapshotted from MembershipTier.taxReceiptEligible at signup, same reasoning as
          // durationMonths above — copied onto every yearly Cotisation this subscription
          // produces (see handleCotisationInvoicePaid).
          taxReceiptEligible: meta.taxReceiptEligible === "1",
        },
      })

      // Any paid add-on/embedded donation rides as a one-time invoice item on this same
      // checkout — Stripe bills it once on the first invoice, never on renewals, which is
      // exactly why this only runs here and not in handleCotisationInvoicePaid below.
      await createMembershipAddonPurchases(tx, {
        associationId: meta.associationId,
        membreId:      membre.id,
        firstName:     meta.firstName ?? "",
        lastName:      meta.lastName ?? "",
        email:         meta.email,
        addonsJson:    meta.addons,
        canIssueTaxReceipts: assoc?.canIssueTaxReceipts ?? false,
      })

      return { user, membre, cotisationSubscription }
    })
  } catch (err) {
    // The person has already paid at this point — Stripe won't retry a checkout.session.
    // completed delivery that throws in a way that matters here (it'll retry the HTTP
    // call, but the DB write that failed, e.g. a duplicate (email, associationId) from a
    // race with another signup, will fail identically every time). Rather than crash-loop
    // this delivery for days with no one aware money changed hands, log loudly and alert
    // the association's directors so a human reconciles the account manually — same
    // "can't auto-recover, so make sure a person finds out" reasoning as the recu-fiscal
    // generation failure in the main webhook route.
    console.error(`[cotisation-subscription] failed to create account for subscription ${subscriptionId} (association ${meta.associationId}, email ${meta.email}):`, err)
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
          body:   `${meta.firstName} ${meta.lastName} (${meta.email}) a payé son adhésion mais son compte n'a pas pu être créé automatiquement${isDuplicateEmail ? " (email déjà utilisé)" : ""}. Créez-le manuellement.`,
          link:   "/dashboard/membres",
          scope:  "GESTION",
        })),
        skipDuplicates: true,
      })
      await pusherServer.trigger(`private-association-${meta.associationId}`, "new-notification", {}).catch(() => {})
    }
    return
  }

  if (assoc?.slug) {
    sendEmail(membershipSubscriptionStartedEmail({
      firstName:       created.membre.firstName,
      email:           meta.email,
      associationName: assoc.name,
      amount,
      loginUrl:        `${APP_URL}/portal/${assoc.slug}/login`,
      branding:        resolveDocumentBranding(assoc),
      durationMonths:  meta.durationMonths ? Number(meta.durationMonths) : null,
    }), { associationId: meta.associationId, membreId: created.membre.id, source: "TRANSACTION", sourceId: created.cotisationSubscription.id }).catch(() => {})

    // Not fired before this session's own edge-case review — a recurring MembershipForm
    // signup (like the one-off/free/offline paths in checkout/route.ts) is still a real new
    // member, and staff-configured "nouveau membre" automations should see it too.
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
      memberNames: [`${created.membre.firstName} ${created.membre.lastName}`], amount, primaryMembreId: created.membre.id,
    }).catch(() => {})
  }

  await writeActivityLog({
    associationId: meta.associationId,
    action:        "COTISATION_SUBSCRIPTION_STARTED",
    entity:        "CotisationSubscription",
    entityId:      created.cotisationSubscription.id,
    label:         `${created.membre.firstName} ${created.membre.lastName} — ${amount}€/an`,
  })
}

// ─── customer.subscription.created / updated ────────────────────────────────────
export async function handleCotisationSubscriptionSynced(sub: Stripe.Subscription) {
  await prisma.cotisationSubscription.updateMany({
    where: { stripeSubscriptionId: sub.id },
    data: {
      status:              toCotisationSubscriptionStatus(sub.status),
      currentPeriodEndsAt: subscriptionPeriodEnd(sub),
    },
  })
}

// ─── customer.subscription.deleted ──────────────────────────────────────────────
export async function handleCotisationSubscriptionDeleted(sub: Stripe.Subscription) {
  await prisma.cotisationSubscription.updateMany({
    where: { stripeSubscriptionId: sub.id },
    data:  { status: "CANCELLED", cancelledAt: new Date() },
  })
}

// ─── invoice.paid ────────────────────────────────────────────────────────────────
//
// Fires once per billing period, including the very first charge. Upserts the Cotisation
// for whichever year is current when the invoice is paid, then reuses
// recordCotisationPayment (src/lib/cotisation-payments.ts) — the exact same
// Income-creation/status-derivation/overpayment-guard path every other cotisation payment
// (manual, portal one-off, Stripe one-off) already shares.
export async function handleCotisationInvoicePaid(invoice: Stripe.Invoice) {
  const subscriptionId = invoiceSubscriptionId(invoice)
  if (!subscriptionId) return

  const cotisationSub = await prisma.cotisationSubscription.findUnique({
    where:  { stripeSubscriptionId: subscriptionId },
    select: { id: true, associationId: true, membreId: true, amount: true, membershipFormId: true, tierId: true, durationMonths: true, taxReceiptEligible: true },
  })
  if (!cotisationSub) return // Not a cotisation subscription — nothing here concerns this invoice.

  const amount = invoice.amount_paid / 100
  if (amount <= 0) return // A $0 invoice (e.g. a fully-credited period) has nothing to record.

  const paidAt = invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : new Date()
  const year   = currentCotisationYear(paidAt)
  const periodStart = cotisationSub.durationMonths ? paidAt : null
  const periodEnd    = cotisationSub.durationMonths ? addMonths(paidAt, cotisationSub.durationMonths) : null

  if (cotisationSub.durationMonths) {
    // A custom-duration subscription (< 12 months) can renew more than once inside the same
    // calendar year (e.g. a 6-month tier signed up for in January renews again in July) —
    // Cotisation's @@unique([membreId, year]) has no room for a second row that same year.
    // Detected here as a same-subscription row whose previous period has already closed by
    // the time this new charge lands. Rather than silently reuse/overwrite January's period
    // (which would make isMembreAdherent start reporting this member as expired the moment
    // the July renewal actually arrives), this is deliberately left as a rare, honestly-
    // failing edge case — see the Fase 2 plan's own scoping note — a human gets paged instead
    // of the data quietly going wrong.
    const existingForYear = await prisma.cotisation.findUnique({
      where:  { membreId_year: { membreId: cotisationSub.membreId, year } },
      select: { subscriptionId: true, periodEnd: true },
    })
    if (existingForYear?.subscriptionId === cotisationSub.id && existingForYear.periodEnd && existingForYear.periodEnd < paidAt) {
      console.error(`[cotisation-subscription] a second same-year renewal landed for subscription ${cotisationSub.id} (membre ${cotisationSub.membreId}, year ${year}) — Cotisation's one-row-per-year constraint can't represent it; needs manual reconciliation.`)
      const admins = await prisma.user.findMany({
        where:  { associationId: cotisationSub.associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER"] }, active: true },
        select: { id: true },
      })
      if (admins.length) {
        await prisma.notification.createMany({
          data: admins.map(a => ({
            userId: a.id,
            title:  "Renouvellement d'adhésion à vérifier manuellement",
            body:   "Un abonnement à durée personnalisée s'est renouvelé une seconde fois dans la même année civile — le paiement a bien été reçu mais nécessite une vérification manuelle.",
            link:   `/dashboard/membres/${cotisationSub.membreId}`,
            scope:  "GESTION",
          })),
          skipDuplicates: true,
        })
        await pusherServer.trigger(`private-association-${cotisationSub.associationId}`, "new-notification", {}).catch(() => {})
      }
      return
    }
  }

  // Reuses the exact upsert shape maybeCreateDefaultCotisation already uses elsewhere
  // (src/lib/cotisation-defaults.ts) — this year's row may or may not already exist
  // (e.g. an admin created one manually before the renewal charge landed).
  const cotisation = await prisma.cotisation.upsert({
    where:  { membreId_year: { membreId: cotisationSub.membreId, year } },
    update: { subscriptionId: cotisationSub.id, periodStart, periodEnd, taxReceiptEligible: cotisationSub.taxReceiptEligible },
    create: {
      membreId:       cotisationSub.membreId,
      associationId:  cotisationSub.associationId,
      year,
      amount:         cotisationSub.amount,
      status:         "EN_ATTENTE",
      subscriptionId: cotisationSub.id,
      membershipFormId: cotisationSub.membershipFormId,
      tierId:           cotisationSub.tierId,
      periodStart,
      periodEnd,
      taxReceiptEligible: cotisationSub.taxReceiptEligible,
    },
  })

  // Any add-on/embedded donation bought alongside this subscription's first checkout was
  // recorded with cotisationId: null (see createMembershipAddonPurchases in
  // handleCotisationSubscriptionCheckout above) — the Cotisation it belongs to didn't exist
  // until just now. Safe to run on every invoice, not just the first: once linked, the where
  // clause below simply matches nothing on later renewals.
  await prisma.membershipAddonPurchase.updateMany({
    where: { membreId: cotisationSub.membreId, cotisationId: null },
    data:  { cotisationId: cotisation.id },
  })

  // Already fully paid (e.g. a redelivered event, or an admin recorded a manual payment in
  // the meantime) — recordCotisationPayment would throw CotisationOverpaymentError here,
  // and there's nothing left for this charge to represent on our side even though Stripe
  // did capture it. Same "nothing to reconcile automatically" acceptance as the one-off
  // Stripe webhook branch's overpayment path in route.ts.
  if (cotisation.status === "PAYE") return

  const exercice = await resolveExerciceForDate(cotisationSub.associationId, paidAt)

  const updated = await prisma.$transaction((tx) => recordCotisationPayment(tx, {
    associationId: cotisationSub.associationId,
    cotisationId:  cotisation.id,
    amount,
    method:        "Prélèvement automatique",
    paidAt,
    source:        "STRIPE",
    reference:     invoice.id,
    exerciceId:    exercice?.status === "OUVERT" ? exercice.id : null,
  }))

  await sendCotisationPaymentConfirmation(updated, amount)

  await writeActivityLog({
    associationId: cotisationSub.associationId,
    action:        "COTISATION_PAID",
    entity:        "Cotisation",
    entityId:      cotisation.id,
    label:         `${updated.membre.firstName} ${updated.membre.lastName} — ${year} (récurrent)`,
    metadata:      { amount },
  })
}

// ─── invoice.payment_failed ──────────────────────────────────────────────────────
//
// Returns true when this invoice belonged to a cotisation subscription (handled here,
// caller must not fall through to the platform-billing branch) and false otherwise.
export async function tryHandleCotisationInvoicePaymentFailed(invoice: Stripe.Invoice, eventId: string): Promise<boolean> {
  const subscriptionId = invoiceSubscriptionId(invoice)
  if (!subscriptionId) return false

  const cotisationSub = await prisma.cotisationSubscription.findUnique({
    where:   { stripeSubscriptionId: subscriptionId },
    include: {
      membre:      { select: { firstName: true, lastName: true, email: true } },
      association: { select: { id: true, name: true, slug: true } },
    },
  })
  if (!cotisationSub) return false

  // Stripe can redeliver this event for the same failed attempt.
  const alreadyProcessed = await prisma.activityLog.findFirst({
    where: {
      associationId: cotisationSub.associationId,
      action:        "COTISATION_SUBSCRIPTION_PAYMENT_FAILED",
      entityId:      invoice.id,
      metadata:      { path: ["stripeEventId"], equals: eventId },
    },
    select: { id: true },
  })
  if (alreadyProcessed) return true

  await prisma.cotisationSubscription.update({
    where: { id: cotisationSub.id },
    data:  { status: "PAST_DUE" },
  })

  const amount        = invoice.amount_due / 100
  const nextAttemptAt = invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000) : null
  const memberName    = `${cotisationSub.membre.firstName} ${cotisationSub.membre.lastName}`

  await writeActivityLog({
    associationId: cotisationSub.associationId,
    action:        "COTISATION_SUBSCRIPTION_PAYMENT_FAILED",
    entity:        "CotisationSubscription",
    entityId:      cotisationSub.id,
    label:         memberName,
    metadata:      { amountDue: invoice.amount_due, attemptCount: invoice.attempt_count, stripeEventId: eventId },
  })

  if (cotisationSub.membre.email && cotisationSub.cancelToken) {
    sendEmail(cotisationSubscriptionPaymentFailedEmail({
      firstName:       cotisationSub.membre.firstName,
      email:           cotisationSub.membre.email,
      associationName: cotisationSub.association.name,
      amount,
      nextAttemptAt,
      cancelUrl:       `${APP_URL}/adhesion/annulation/${cotisationSub.cancelToken}`,
    }), { associationId: cotisationSub.associationId, source: "TRANSACTION", sourceId: cotisationSub.id }).catch(() => {})
  }

  // The member email alone leaves the association finding out only if the member happens
  // to mention it — same reasoning as the platform-billing failure notifying an
  // association's own admins in route.ts, mirrored here for a member's cotisation instead.
  const admins = await prisma.user.findMany({
    where:  { associationId: cotisationSub.associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER"] }, active: true },
    select: { id: true, email: true },
  })
  if (admins.length) {
    const dashboardUrl = `${APP_URL}/dashboard/membres/${cotisationSub.membreId}`
    await prisma.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        title:  "Échec de prélèvement de cotisation",
        body:   `Le prélèvement automatique de ${amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} pour ${memberName} a échoué.`,
        link:   `/dashboard/membres/${cotisationSub.membreId}`,
        scope:  "GESTION",
      })),
      skipDuplicates: true,
    })
    await pusherServer.trigger(`private-association-${cotisationSub.associationId}`, "new-notification", {}).catch(() => {})

    for (const admin of admins) {
      if (!admin.email) continue
      sendEmail(cotisationSubscriptionPaymentFailedAdminEmail({
        email:           admin.email,
        associationName: cotisationSub.association.name,
        memberName,
        amount,
        dashboardUrl,
      }), { associationId: cotisationSub.associationId, source: "TRANSACTION", sourceId: cotisationSub.id })
        .catch(err => console.error(`[cotisation-subscription] failed to email admin ${admin.email}:`, err))
    }
  }

  return true
}

// ─── Cancellation from inside the app (admin dashboard, member deactivation/deletion) ──
//
// Mirrors the self-service cancel route's Stripe call — cancels immediately (not at period
// end). Unlike the webhook-driven flows elsewhere, this flips the DB status right here
// instead of waiting on customer.subscription.deleted: that event can take a few seconds to
// arrive, and in the meantime the admin dashboard's status badge (read straight from the DB)
// would still say "Active" right after a cancel that just succeeded — confusing when the
// admin is looking at the page that very moment. The eventual webhook delivery is then a
// harmless no-op update over the same already-CANCELLED row.
// Best-effort: callers (member deactivate/delete) must not be blocked by a Stripe outage, so
// this never throws — it logs and returns false instead.
export async function cancelActiveCotisationSubscriptionForMembre(
  membreId: string,
  opts: { actorId?: string; label?: string } = {},
): Promise<boolean> {
  const sub = await prisma.cotisationSubscription.findUnique({
    where:  { membreId },
    select: { id: true, stripeSubscriptionId: true, status: true, associationId: true },
  })
  if (!sub || sub.status === "CANCELLED") return false

  try {
    await stripe.subscriptions.cancel(sub.stripeSubscriptionId)
  } catch (err) {
    // The subscription can already be canceled/gone on Stripe's side (cancelled directly in
    // the Stripe Dashboard, or a webhook race with another cancel request) while our DB
    // still says ACTIVE/PAST_DUE — Stripe rejects re-cancelling it with an invalid_request_
    // error in that case. There's nothing left to cancel, so treat it as the success it
    // functionally is (sync our DB to match) instead of reporting a failure that would send
    // an admin looking for a problem that doesn't exist. A real outage (connection/API/auth/
    // rate-limit error) falls through to the generic failure path below.
    if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) {
      console.error(`[cotisation-subscription] failed to cancel subscription ${sub.id} for membre ${membreId}:`, err)
      return false
    }
  }

  await prisma.cotisationSubscription.update({
    where: { id: sub.id },
    data:  { status: "CANCELLED", cancelledAt: new Date() },
  })

  await writeActivityLog({
    associationId: sub.associationId,
    actorId:       opts.actorId,
    action:        "COTISATION_SUBSCRIPTION_CANCELLED",
    entity:        "CotisationSubscription",
    entityId:      sub.id,
    label:         opts.label,
  })

  return true
}
