import { isSpokenLanguage } from "@/lib/languages"
import Stripe from "stripe"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { membershipWelcomeEmail } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { resolveDocumentBranding, effectiveMemberLimit } from "@/lib/plan-limits"
import { getPricingInfo, stripe } from "@/lib/stripe"
import { currentCotisationYear } from "@/lib/membre-adherent"
import { recordCotisationPayment } from "@/lib/cotisation-payments"
import { resolveExerciceForDate } from "@/lib/finance/exercice"
import { pusherServer } from "@/lib/pusher-server"
import { fireEventRule } from "@/lib/fire-event-rule"
import { APP_URL } from "@/lib/env"
import { createMembershipAddonPurchases, parseAddons } from "@/lib/webhook/membership-addons"
import { createMembershipFormProductPurchase } from "@/lib/webhook/membership-form-products"
import { notifyMembershipSignup } from "@/lib/webhook/membership-notify"
import { isMemberCardAvailable } from "@/lib/member-card/availability"
import { addressColumns } from "@/lib/address"

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

  const [assoc, form] = await Promise.all([
    prisma.association.findUnique({
      where:  { id: meta.associationId },
      select: {
        name: true, slug: true, modules: true, plan: true, customMemberLimit: true,
        customBrandingEnabled: true, logoUrl: true, canIssueTaxReceipts: true,
      },
    }),
    meta.membershipFormId
      ? prisma.membershipForm.findUnique({ where: { id: meta.membershipFormId }, select: { title: true, adminNotificationEmail: true } })
      : Promise.resolve(null),
  ])

  // Computed early: needed both inside the transaction (as the Income reference for the
  // recordCotisationPayment call below) and afterward (to backfill it onto the PaymentIntent
  // for refund reconciliation, see the comment further down).
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id
  // Single timestamp shared by the exercice lookup, the Cotisation's own paidAt, and the
  // recorded payment's paidAt — three separate `new Date()` calls could theoretically land on
  // different sides of a fiscal-year boundary and disagree with each other.
  const paidAt = new Date()
  // Best-effort exercice link — never blocks, same reasoning as every other Income-creating
  // webhook path (see e.g. the Stripe boutique/cotisation-renewal branches in webhook/stripe/route.ts).
  const exercice = isFreeTier ? null : await resolveExerciceForDate(meta.associationId, paidAt)

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
          // Les six colonnes d'adresse sont écrites ensemble, colonne héritée comprise — voir
          // addressColumns dans src/lib/address.ts. Une session créée avant le découpage en
          // colonnes structurées ne porte que `address`, et reste donc écrite telle quelle.
          ...addressColumns({
            street:     meta.addressStreet,
            complement: meta.addressComplement,
            postalCode: meta.postalCode,
            city:       meta.city,
            country:    meta.country,
            legacy:     meta.address,
          }),
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

      let cotisation = await tx.cotisation.create({
        data: {
          membreId:      membre.id,
          associationId: meta.associationId,
          year:          currentCotisationYear(),
          amount:        membershipAmount,
          amountPaid:    0,
          status:        isFreeTier ? "EXONERE" : "EN_ATTENTE",
          paidAt:        isFreeTier ? paidAt : null,
          membershipFormId: meta.membershipFormId || null,
          tierId:           meta.tierId || null,
          periodStart:      meta.periodStart ? new Date(meta.periodStart) : null,
          periodEnd:        meta.periodEnd ? new Date(meta.periodEnd) : null,
          receiptMode:      meta.receiptMode as "NONE" | "FULL" | "PARTIAL",
          deductibleAmount: meta.deductibleAmount ? Number(meta.deductibleAmount) : null,
        },
      })

      // Not free: the adhésion was actually paid via this Stripe session, so record a real
      // CotisationPayment — this is what posts the matching Income row the Compte de Résultat
      // report reads from. Without this, the Cotisation would land on PAYE (set directly above,
      // pre-fix) with no CotisationPayment/Income behind it, and the payment would silently
      // never show up as revenue.
      if (!isFreeTier) {
        cotisation = await recordCotisationPayment(tx, {
          associationId: meta.associationId,
          cotisationId:  cotisation.id,
          amount:        membershipAmount,
          method:        "En ligne",
          paidAt,
          source:        "STRIPE",
          reference:     paymentIntentId ?? null,
          exerciceId:    exercice?.status === "OUVERT" ? exercice.id : null,
        })
      }

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
  if (paymentIntentId) {
    await stripe.paymentIntents.update(paymentIntentId, { metadata: { cotisationId: created.cotisation.id } }).catch(err => {
      console.error(`[membership-oneoff] failed to backfill paymentIntent metadata for refund reconciliation (session ${session.id}):`, err)
    })
  }

  // Étape séparée délibérée, après que l'adhésion elle-même a été créée avec succès — voir
  // le commentaire de createMembershipFormProductPurchase pour pourquoi cette étape ne peut
  // pas être nichée dans la transaction principale. Un échec ici (stock épuisé sur une ligne,
  // ou l'étape entière qui échoue après ses tentatives) n'annule jamais l'adhésion déjà créée
  // — même philosophie "l'argent a déjà bougé" que la vérification de limite de membres plus
  // bas : on notifie l'équipe plutôt que de bloquer.
  let purchasedProducts: { label: string; quantity: number; amount: number }[] = []
  try {
    const productResult = await createMembershipFormProductPurchase({
      associationId:   meta.associationId,
      membreId:        created.membre.id,
      cotisationId:    created.cotisation.id,
      paymentIntentId: paymentIntentId ?? null,
      productsJson:    meta.products,
    })
    purchasedProducts = productResult?.purchased ?? []
    if (productResult?.flaggedOversells.length) {
      const admins = await prisma.user.findMany({
        where:  { associationId: meta.associationId, role: { in: ["ADMIN", "PRESIDENT"] }, active: true },
        select: { id: true },
      })
      if (admins.length) {
        await prisma.notification.createMany({
          data: admins.map(a => ({
            userId: a.id,
            title:  "Vente boutique en rupture de stock lors d'une adhésion",
            body:   `${created.membre.firstName} ${created.membre.lastName} a payé pour ${productResult.flaggedOversells.length} produit(s) boutique devenu(s) indisponible(s) entre-temps. Le montant a été encaissé — contactez le membre pour convenir d'un arrangement.`,
            link:   "/dashboard/boutique",
            scope:  "GESTION",
          })),
          skipDuplicates: true,
        })
        await pusherServer.trigger(`private-association-${meta.associationId}`, "new-notification", {}).catch(() => {})
      }
    }
  } catch (err) {
    console.error(`[membership-oneoff] failed to record boutique product purchase for checkout session ${session.id} (association ${meta.associationId}):`, err)
    const admins = await prisma.user.findMany({
      where:  { associationId: meta.associationId, role: { in: ["ADMIN", "PRESIDENT"] }, active: true },
      select: { id: true },
    })
    if (admins.length) {
      await prisma.notification.createMany({
        data: admins.map(a => ({
          userId: a.id,
          title:  "Vente boutique non enregistrée lors d'une adhésion",
          body:   `${created.membre.firstName} ${created.membre.lastName} a payé pour des produits boutique, mais l'achat n'a pas pu être enregistré automatiquement. L'adhésion elle-même est bien créée — vérifiez et enregistrez la vente manuellement si besoin.`,
          link:   "/dashboard/boutique",
          scope:  "GESTION",
        })),
        skipDuplicates: true,
      })
      await pusherServer.trigger(`private-association-${meta.associationId}`, "new-notification", {}).catch(() => {})
    }
  }

  if (assoc?.slug) {
    // La cotisation est déjà créée et encaissée (EXONERE pour un tarif gratuit, PAYE via
    // recordCotisationPayment sinon) au moment où cet email part : la carte est donc
    // disponible tout de suite, sauf si l'association ne l'a pas activée — d'où l'appel au
    // loader plutôt qu'un raisonnement local sur le statut de la cotisation.
    const memberCardAvailable = await isMemberCardAvailable(meta.associationId, created.membre.id)

    sendEmail(membershipWelcomeEmail({
      firstName:       created.membre.firstName,
      email:           meta.email,
      associationName: assoc.name,
      amount:          totalAmount,
      loginUrl:        `${APP_URL}/portal/${assoc.slug}/login`,
      memberCardUrl:   memberCardAvailable ? `${APP_URL}/portal/${assoc.slug}/carte` : undefined,
      branding:        resolveDocumentBranding(assoc),
      canIssueTaxReceipts: assoc.canIssueTaxReceipts,
      receiptMode:         meta.receiptMode as "NONE" | "FULL" | "PARTIAL",
      deductibleAmount:    meta.deductibleAmount ? Number(meta.deductibleAmount) : undefined,
      products:            purchasedProducts.length ? purchasedProducts : undefined,
      addons:              parseAddons(meta.addons).map(a => ({ label: a.label, amount: a.amount })),
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
