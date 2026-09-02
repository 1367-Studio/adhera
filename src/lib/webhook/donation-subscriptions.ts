import { randomBytes } from "crypto"
import type Stripe from "stripe"
import type { DonationSubscriptionStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { stripe, subscriptionPeriodEnd } from "@/lib/stripe"
import { sendEmail } from "@/lib/mail"
import {
  donationSubscriptionStartedEmail, donationSubscriptionPaymentFailedEmail, donConfirmationEmail,
} from "@/lib/email"
import { generateRecuFiscalForDon } from "@/lib/pdf/recu-fiscal"
import { writeActivityLog } from "@/lib/activity-log"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { resolveExerciceForDate } from "@/lib/finance/exercice"
import { APP_URL } from "@/lib/env"

// ─── Discrimination ────────────────────────────────────────────────────────────
//
// Connect here is used in destination-charges mode, so a recurring donation's Stripe
// Subscription lives on the SAME platform account as every association's own Formwise
// billing subscription — meaning customer.subscription.*, invoice.paid and
// invoice.payment_failed all land on this one webhook endpoint regardless of which kind
// of subscription they belong to. Every donation subscription is tagged
// subscription_data.metadata.kind = "donation" at checkout time specifically so the
// handlers below can tell the two apart BEFORE running any Association-billing logic —
// see route.ts, where this check runs first in each shared event type.
export function isDonationSubscriptionEvent(sub: Stripe.Subscription): boolean {
  return sub.metadata?.kind === "donation"
}

function toDonationSubscriptionStatus(status: Stripe.Subscription.Status): DonationSubscriptionStatus {
  if (status === "active" || status === "trialing") return "ACTIVE"
  if (status === "past_due" || status === "unpaid") return "PAST_DUE"
  return "CANCELLED"
}

// This API version moved the subscription id off Invoice's top level and onto
// invoice.parent.subscription_details.subscription (a quote can be an invoice's parent
// too, hence the nested optional chain).
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = invoice.parent?.subscription_details?.subscription
  return typeof sub === "string" ? sub : sub?.id ?? null
}

// ─── checkout.session.completed (mode: "subscription") ─────────────────────────
//
// Unlike a one-off Don (created before checkout, so its id can ride along in metadata),
// there's no DB row to create ahead of time here — a Subscription id doesn't exist until
// Stripe mints it. So the donor's answers travel through Stripe as session metadata
// instead, and this handler is what turns them into the actual DonationSubscription row,
// now that a real stripeSubscriptionId/stripeCustomerId exist to key it on.
export async function handleDonationSubscriptionCheckout(session: Stripe.Checkout.Session) {
  const meta = session.metadata
  if (!meta?.kind || meta.kind !== "donation" || !meta.donationFormId || !meta.tierId || !meta.associationId) return

  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id
  const customerId      = typeof session.customer === "string" ? session.customer : session.customer?.id
  if (!subscriptionId || !customerId) return

  // Redelivery of the same event — the row was already created by an earlier delivery.
  const existing = await prisma.donationSubscription.findUnique({ where: { stripeSubscriptionId: subscriptionId } })
  if (existing) return

  const tier = await prisma.donationTier.findUnique({ where: { id: meta.tierId }, select: { amount: true, interval: true, receiptMode: true, ineligibleAmount: true } })
  const sub  = await stripe.subscriptions.retrieve(subscriptionId)
  const unitAmount = sub.items.data[0]?.price.unit_amount
  const amount     = unitAmount != null ? unitAmount / 100 : Number(tier?.amount ?? 0)

  let answers: Record<string, string> = {}
  try { answers = meta.answers ? JSON.parse(meta.answers) : {} } catch { answers = {} }

  const created = await prisma.donationSubscription.create({
    data: {
      associationId:  meta.associationId,
      donationFormId: meta.donationFormId,
      tierId:         meta.tierId,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId:     customerId,
      cancelToken:          randomBytes(20).toString("hex"),
      donorType:   meta.donorType === "COMPANY" ? "COMPANY" : "INDIVIDUAL",
      firstName:   meta.firstName ?? "",
      lastName:    meta.lastName ?? "",
      companyName: meta.companyName || null,
      siret:       meta.siret || null,
      email:       meta.email ?? "",
      address:     meta.address || null,
      message:     meta.message || null,
      anonymous:   meta.anonymous === "true",
      answers:     Object.keys(answers).length ? answers : undefined,
      cguvAgreedAt: meta.cguvAgreedAt ? new Date(meta.cguvAgreedAt) : null,
      // Snapshotted from the checkout-time metadata (what the donor actually saw on the
      // public page), not re-read from the tier now — same reasoning as Don.receiptMode.
      receiptMode:      (meta.receiptMode as "NONE" | "FULL" | "PARTIAL" | undefined) || tier?.receiptMode || null,
      deductibleAmount: meta.deductibleAmount || null,
      amount,
      interval: tier?.interval ?? "MONTH",
      status:   "ACTIVE",
      currentPeriodEndsAt: subscriptionPeriodEnd(sub),
    },
    include: { association: { select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true } } },
  })

  if (created.email) {
    sendEmail(donationSubscriptionStartedEmail({
      firstName:       created.firstName,
      email:           created.email,
      associationName: created.association.name,
      amount,
      interval:        created.interval,
      cancelUrl:       `${APP_URL}/dons/annulation/${created.cancelToken}`,
      branding:        resolveDocumentBranding(created.association),
    }), { associationId: meta.associationId, source: "TRANSACTION", sourceId: created.id }).catch(() => {})
  }

  await writeActivityLog({
    associationId: meta.associationId,
    action:        "DONATION_SUBSCRIPTION_STARTED",
    entity:        "DonationSubscription",
    entityId:      created.id,
    label:         `${created.firstName} ${created.lastName} — ${amount}€/${created.interval}`,
  })
}

// ─── customer.subscription.created / updated ────────────────────────────────────
export async function handleDonationSubscriptionSynced(sub: Stripe.Subscription) {
  await prisma.donationSubscription.updateMany({
    where: { stripeSubscriptionId: sub.id },
    data: {
      status:              toDonationSubscriptionStatus(sub.status),
      currentPeriodEndsAt: subscriptionPeriodEnd(sub),
    },
  })
}

// ─── customer.subscription.deleted ──────────────────────────────────────────────
export async function handleDonationSubscriptionDeleted(sub: Stripe.Subscription) {
  await prisma.donationSubscription.updateMany({
    where: { stripeSubscriptionId: sub.id },
    data:  { status: "CANCELLED", cancelledAt: new Date() },
  })
}

// ─── invoice.paid ────────────────────────────────────────────────────────────────
//
// Fires once per billing period, including the very first charge (checkout.session.
// completed only ever tells us the subscription now exists — it never carries payment
// state). Every successful charge here produces one real Don row, same downstream shape
// (Income, fiscal receipt, confirmation email) as a one-off donation.
export async function handleDonationInvoicePaid(invoice: Stripe.Invoice) {
  const subscriptionId = invoiceSubscriptionId(invoice)
  if (!subscriptionId) return

  const donationSub = await prisma.donationSubscription.findUnique({
    where:   { stripeSubscriptionId: subscriptionId },
    include: {
      association: { select: { id: true, name: true, address: true, city: true, siren: true, rna: true, canIssueTaxReceipts: true, objet: true, organismeCategory: true, organismeCategoryDetail: true, plan: true, customBrandingEnabled: true, logoUrl: true } },
    },
  })
  if (!donationSub) return // Not a donation subscription — nothing here concerns this invoice.

  // Stripe can redeliver this event — reusing the invoice id as Don.stripeSessionId (the
  // column one-off dons key their own Stripe object on) turns a duplicate delivery into a
  // harmless unique-constraint no-op instead of a second Don for the same charge.
  const already = await prisma.don.findUnique({ where: { stripeSessionId: invoice.id } })
  if (already) return

  const paidAt  = invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : new Date()
  const amount  = invoice.amount_paid / 100
  if (amount <= 0) return // A $0 invoice (e.g. a fully-credited period) has no donation to record.

  const don = await prisma.don.create({
    data: {
      associationId:  donationSub.associationId,
      donationFormId: donationSub.donationFormId,
      tierId:         donationSub.tierId,
      subscriptionId: donationSub.id,
      donorType:      donationSub.donorType,
      firstName:      donationSub.firstName,
      lastName:       donationSub.lastName,
      companyName:    donationSub.companyName,
      siret:          donationSub.siret,
      email:           donationSub.email,
      address:         donationSub.address,
      amount,
      message:         donationSub.message,
      anonymous:       donationSub.anonymous,
      answers:         donationSub.answers ?? undefined,
      cguvAgreedAt:    donationSub.cguvAgreedAt,
      receiptMode:      donationSub.receiptMode,
      deductibleAmount: donationSub.deductibleAmount,
      paidAt,
      stripeSessionId: invoice.id,
    },
  })

  const exercice = await resolveExerciceForDate(donationSub.associationId, paidAt)
  await prisma.income.create({
    data: {
      associationId: donationSub.associationId,
      exerciceId:    exercice?.status === "OUVERT" ? exercice.id : null,
      amount,
      description:   `Don récurrent de ${donationSub.donorType === "COMPANY" ? (donationSub.companyName ?? donationSub.firstName) : `${donationSub.firstName} ${donationSub.lastName}`}`,
      paymentMethod: "STRIPE",
      source:        "STRIPE",
      status:        "PAID",
      date:          paidAt,
      // The underlying PaymentIntent id now lives under invoice.payments (a paginated
      // list Stripe doesn't inline into webhook payloads) rather than a top-level field —
      // the invoice id itself is enough to cross-reference this charge on Stripe's side.
      reference:     invoice.id ?? null,
    },
  })

  const assoc         = donationSub.association
  const issueReceipt  = don.receiptMode !== "NONE"

  if (donationSub.email) {
    let pdfAttachment: { filename: string; content: Buffer } | undefined
    if (assoc.canIssueTaxReceipts && issueReceipt) {
      try {
        const pdf = await generateRecuFiscalForDon(don, assoc)
        pdfAttachment = { filename: `recu-fiscal-${don.receiptNumber ?? don.id}.pdf`, content: pdf }
      } catch (err) {
        console.error(`[recu-fiscal] failed to generate for recurring don ${don.id}:`, err)
      }
    }

    const refreshed = await prisma.don.findUnique({ where: { id: don.id }, select: { receiptNumber: true } })

    sendEmail({
      ...donConfirmationEmail({
        firstName:           donationSub.firstName,
        email:               donationSub.email,
        associationName:     assoc.name,
        amount,
        paidAt,
        canIssueTaxReceipts: assoc.canIssueTaxReceipts && issueReceipt,
        receiptNumber:       refreshed?.receiptNumber ?? undefined,
        donorType:           donationSub.donorType,
        deductibleAmount:    don.receiptMode === "PARTIAL" && don.deductibleAmount != null ? Number(don.deductibleAmount) : undefined,
        branding:            resolveDocumentBranding(assoc),
      }),
      attachments: pdfAttachment ? [pdfAttachment] : undefined,
    }, { associationId: donationSub.associationId, source: "TRANSACTION", sourceId: don.id }).catch(() => {})
  }

  await writeActivityLog({
    associationId: donationSub.associationId,
    action:        "DON_PAID",
    entity:        "Don",
    entityId:      don.id,
    label:         `${donationSub.firstName} ${donationSub.lastName} (récurrent)`,
    metadata:      { amount },
  })
}

// ─── invoice.payment_failed ──────────────────────────────────────────────────────
//
// Returns true when this invoice belonged to a donation subscription (handled here,
// caller must not fall through to the platform-billing branch) and false otherwise.
export async function tryHandleDonationInvoicePaymentFailed(invoice: Stripe.Invoice, eventId: string): Promise<boolean> {
  const subscriptionId = invoiceSubscriptionId(invoice)
  if (!subscriptionId) return false

  const donationSub = await prisma.donationSubscription.findUnique({
    where:  { stripeSubscriptionId: subscriptionId },
    include: { association: { select: { name: true } } },
  })
  if (!donationSub) return false

  // Stripe can redeliver this event for the same failed attempt.
  const alreadyProcessed = await prisma.activityLog.findFirst({
    where: {
      associationId: donationSub.associationId,
      action:        "DONATION_SUBSCRIPTION_PAYMENT_FAILED",
      entityId:      invoice.id,
      metadata:      { path: ["stripeEventId"], equals: eventId },
    },
    select: { id: true },
  })
  if (alreadyProcessed) return true

  await prisma.donationSubscription.update({
    where: { id: donationSub.id },
    data:  { status: "PAST_DUE" },
  })

  await writeActivityLog({
    associationId: donationSub.associationId,
    action:        "DONATION_SUBSCRIPTION_PAYMENT_FAILED",
    entity:        "DonationSubscription",
    entityId:      donationSub.id,
    metadata:      { amountDue: invoice.amount_due, attemptCount: invoice.attempt_count, stripeEventId: eventId },
  })

  if (donationSub.email) {
    const nextAttemptAt = invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000) : null
    sendEmail(donationSubscriptionPaymentFailedEmail({
      firstName:       donationSub.firstName,
      email:           donationSub.email,
      associationName: donationSub.association.name,
      amount:          invoice.amount_due / 100,
      nextAttemptAt,
      cancelUrl:       `${APP_URL}/dons/annulation/${donationSub.cancelToken}`,
    }), { associationId: donationSub.associationId, source: "TRANSACTION", sourceId: donationSub.id }).catch(() => {})
  }

  return true
}
