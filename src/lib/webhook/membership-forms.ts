import Stripe from "stripe"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { membershipWelcomeEmail } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { resolveDocumentBranding, effectiveMemberLimit } from "@/lib/plan-limits"
import { getPricingInfo, stripe } from "@/lib/stripe"
import { currentCotisationYear } from "@/lib/membre-adherent"
import { pusherServer } from "@/lib/pusher-server"
import { fireEventRule } from "@/lib/fire-event-rule"
import { APP_URL } from "@/lib/env"
import { createMembershipAddonPurchases } from "@/lib/webhook/membership-addons"

// ─── checkout.session.completed (mode: "payment", kind: "membership-oneoff") ───────
//
// A one-off (non-recurring) paid MembershipTier. Same reasoning as
// handleCotisationSubscriptionCheckout: no Membre exists yet to carry an id in metadata, so
// the full identity rides through Stripe metadata instead, resolved here once payment is
// actually confirmed. Unlike the recurring branch, there is no ongoing Subscription — this
// is the only event this signup will ever produce.
export async function handleMembershipOneOffCheckout(session: Stripe.Checkout.Session) {
  const meta = session.metadata
  if (!meta?.kind || meta.kind !== "membership-oneoff" || !meta.associationId || !meta.email || !meta.passwordHash) return

  const totalAmount = (session.amount_total ?? 0) / 100
  if (totalAmount <= 0) return

  // membershipAmount snapshots just the adhésion's own share of the payment — session.
  // amount_total also carries any paid add-ons/embedded donation, which must not inflate
  // Cotisation.amount (see checkout/route.ts's commonMeta comment). Falls back to the full
  // total for older sessions created before this field existed.
  const membershipAmount = meta.membershipAmount ? Number(meta.membershipAmount) : totalAmount
  const isFreeTier       = meta.tierFree === "1"

  // Redelivery of the same event — dedupe on the activity log we write at the very end,
  // same convention used for invoice.payment_failed's idempotency check elsewhere in this
  // module family (there's no unique Stripe object id to key a row on here the way
  // stripeSubscriptionId does for the recurring branch).
  const alreadyProcessed = await prisma.activityLog.findFirst({
    where: {
      associationId: meta.associationId,
      action:        "MEMBRE_CREATED",
      metadata:      { path: ["stripeCheckoutSessionId"], equals: session.id },
    },
    select: { id: true },
  })
  if (alreadyProcessed) return

  const assoc = await prisma.association.findUnique({
    where:  { id: meta.associationId },
    select: {
      name: true, slug: true, modules: true, plan: true, customMemberLimit: true,
      customBrandingEnabled: true, logoUrl: true, canIssueTaxReceipts: true,
    },
  })

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
          year:          currentCotisationYear(),
          amount:        membershipAmount,
          amountPaid:    isFreeTier ? 0 : membershipAmount,
          status:        isFreeTier ? "EXONERE" : "PAYE",
          paidAt:        new Date(),
          membershipFormId: meta.membershipFormId || null,
          tierId:           meta.tierId || null,
          periodStart:      meta.periodStart ? new Date(meta.periodStart) : null,
          periodEnd:        meta.periodEnd ? new Date(meta.periodEnd) : null,
        },
      })

      await createMembershipAddonPurchases(tx, {
        associationId: meta.associationId,
        membreId:      membre.id,
        cotisationId:  cotisation.id,
        firstName:     meta.firstName ?? "",
        lastName:      meta.lastName ?? "",
        email:         meta.email,
        addonsJson:    meta.addons,
        canIssueTaxReceipts: assoc?.canIssueTaxReceipts ?? false,
      })

      return { user, membre, cotisation }
    })
  } catch (err) {
    // The person has already paid at this point — same "can't auto-recover, so make sure a
    // human finds out" reasoning as handleCotisationSubscriptionCheckout's own catch block.
    console.error(`[membership-oneoff] failed to create account for checkout session ${session.id} (association ${meta.associationId}, email ${meta.email}):`, err)
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

  // The shared charge.refunded handler (src/app/api/webhook/stripe/route.ts) reconciles a
  // full refund by reading cotisationId/donId/orderId/commandeId off the PaymentIntent's own
  // metadata — none of which could be set at session-creation time here, since the Cotisation
  // this payment is for doesn't exist until the transaction above just created it. Patching it
  // in now (Stripe merges metadata updates, it doesn't replace) is what lets a later refund
  // flip this Cotisation back off PAYE automatically instead of silently going stale.
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id
  if (paymentIntentId) {
    await stripe.paymentIntents.update(paymentIntentId, { metadata: { cotisationId: created.cotisation.id } }).catch(err => {
      console.error(`[membership-oneoff] failed to backfill paymentIntent metadata for refund reconciliation (session ${session.id}):`, err)
    })
  }

  if (assoc?.slug) {
    sendEmail(membershipWelcomeEmail({
      firstName:       created.membre.firstName,
      email:           meta.email,
      associationName: assoc.name,
      amount:          totalAmount,
      loginUrl:        `${APP_URL}/portal/${assoc.slug}/login`,
      branding:        resolveDocumentBranding(assoc),
    }), { associationId: meta.associationId, membreId: created.membre.id, source: "TRANSACTION", sourceId: created.cotisation.id }).catch(() => {})

    fireEventRule({
      triggerType: "MEMBER_CREATED",
      associationId: meta.associationId,
      association: { name: assoc.name, slug: assoc.slug, modules: assoc.modules, plan: assoc.plan, customBrandingEnabled: assoc.customBrandingEnabled, logoUrl: assoc.logoUrl },
      membre: { id: created.membre.id, firstName: created.membre.firstName, lastName: created.membre.lastName, email: created.membre.email, phone: created.membre.phone },
    }).catch(() => {})
  }

  await writeActivityLog({
    associationId: meta.associationId,
    action:        "MEMBRE_CREATED",
    entity:        "Membre",
    entityId:      created.membre.id,
    label:         `${created.membre.firstName} ${created.membre.lastName} — ${totalAmount}€`,
    metadata:      { stripeCheckoutSessionId: session.id },
  })

  // The visitor already paid — assertMemberLimit was only checked before Stripe redirected
  // them away, and can't be re-enforced now without refunding a real charge, so this is
  // informational only: same "money already moved, a human must reconcile" reasoning as the
  // duplicate-email branch above, just for a full plan instead of a broken transaction.
  if (assoc) {
    const [pricing, activeCount] = await Promise.all([
      getPricingInfo(),
      prisma.membre.count({ where: { associationId: meta.associationId, status: "ACTIF" } }),
    ])
    const limit = effectiveMemberLimit(assoc, pricing)
    if (activeCount > limit) {
      const admins = await prisma.user.findMany({
        where:  { associationId: meta.associationId, role: { in: ["ADMIN", "PRESIDENT"] }, active: true },
        select: { id: true },
      })
      if (admins.length) {
        await prisma.notification.createMany({
          data: admins.map(a => ({
            userId: a.id,
            title:  "Limite de membres dépassée",
            body:   `${created.membre.firstName} ${created.membre.lastName} a payé son adhésion, mais votre formule ne couvre que ${limit} membres actifs (vous en avez maintenant ${activeCount}). Envisagez de passer à la formule supérieure.`,
            link:   "/dashboard/parametres",
            scope:  "GESTION",
          })),
          skipDuplicates: true,
        })
        await pusherServer.trigger(`private-association-${meta.associationId}`, "new-notification", {}).catch(() => {})
      }
    }
  }
}
