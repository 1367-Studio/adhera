import { isSpokenLanguage } from "@/lib/languages"
import type Stripe from "stripe"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { membershipWelcomeEmail } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { resolveDocumentBranding, effectiveMemberLimit } from "@/lib/plan-limits"
import { getPricingInfo } from "@/lib/stripe"
import { currentCotisationYear } from "@/lib/membre-adherent"
import { pusherServer } from "@/lib/pusher-server"
import { fireEventRule } from "@/lib/fire-event-rule"
import { APP_URL } from "@/lib/env"
import { notifyMembershipSignup } from "@/lib/webhook/membership-notify"

// Mirrors exactly what checkout/route.ts serializes into MembershipCheckoutDraft.registrants —
// one entry per "Adhérent" block on the public form.
export interface MembershipMultiRegistrant {
  tierId:    string
  amount?:   number // only for a freeAmount tier
  firstName: string
  lastName:  string
  birthDate?: string
  sexe?:      "HOMME" | "FEMME"
  spokenLanguage?: string
  phone?:     string
  mobile?:    string
  address?:   string
  photoUrl?:  string
  locale?:    string
  answers:    Record<string, string>
  // Snapshotted at submission time by checkout/route.ts (ISO strings), not recomputed here —
  // the paid path can consume this draft minutes later once the webhook fires, and a
  // durationMonths window should count from when the visitor actually submitted, not from
  // whenever Stripe happens to confirm payment.
  periodStart?: string | null
  periodEnd?:   string | null
}

export type ConsumeDraftResult =
  | { status: "consumed"; membreIds: string[] }
  | { status: "already-consumed" }
  | { status: "not-found" }
  | { status: "duplicate-email" }
  | { status: "error" }

// Turns a MembershipCheckoutDraft into real Membre/Cotisation rows — the one place both the
// synchronous all-free path (checkout/route.ts calls this directly, no Stripe involved) and
// the async paid path (handleMembershipMultiCheckout, triggered by checkout.session.completed)
// actually create anything, so the two can never drift apart. registrants[0] is who filled out
// the form: they get the User/login and the account email. Everyone else becomes a Membre-only
// dependant of them (Membre.responsableId) — mirrors how a family member added by an admin
// commonly has no login of their own until someone uses "Créer un accès" on their profile.
export async function consumeMembershipCheckoutDraft(draftId: string): Promise<ConsumeDraftResult> {
  const draft = await prisma.membershipCheckoutDraft.findUnique({ where: { id: draftId } })
  if (!draft) return { status: "not-found" }
  if (draft.consumedAt) return { status: "already-consumed" } // redelivered webhook event

  const form = await prisma.membershipForm.findUnique({
    where:   { id: draft.formId },
    include: { tiers: true },
  })
  if (!form) return { status: "not-found" }

  const registrants = draft.registrants as unknown as MembershipMultiRegistrant[]
  const now = new Date()

  let membreIds: string[]
  try {
    membreIds = await prisma.$transaction(async (tx) => {
      const ids: string[] = []
      let firstMembreId: string | undefined

      for (let i = 0; i < registrants.length; i++) {
        const r    = registrants[i]
        const tier = form.tiers.find(t => t.id === r.tierId)
        // A tier deleted between checkout and now (an admin editing tiers while this
        // registrant's payment was in flight) can't be silently skipped: registrant 0 is who
        // gets the User/login for the whole group, so skipping *them* would leave everyone
        // else created as ownerless Membre rows with no way to ever log in, and payment (if
        // any) already captured with nothing to show for it. Throwing here rolls back every
        // row this transaction created so far — the outer catch below logs it and pages an
        // admin, same as a genuine race (P2002) already does.
        if (!tier) throw new Error(`registrant ${i} (${r.firstName} ${r.lastName}) references tier ${r.tierId}, which no longer exists`)

        const amount = tier.free ? 0 : (tier.freeAmount ? (r.amount ?? 0) : Number(tier.amount ?? 0))
        const periodStart = r.periodStart ? new Date(r.periodStart) : null
        const periodEnd    = r.periodEnd ? new Date(r.periodEnd) : null
        const answers      = Object.keys(r.answers ?? {}).length ? r.answers : undefined
        const birthDateValue = r.birthDate ? new Date(r.birthDate) : null
        const sexeValue       = r.sexe === "HOMME" || r.sexe === "FEMME" ? r.sexe : null
        const spokenLanguageValue = isSpokenLanguage(r.spokenLanguage) ? r.spokenLanguage : null

        let membreId: string
        if (i === 0) {
          const user = await tx.user.create({
            data: {
              email: draft.email, name: `${r.firstName} ${r.lastName}`, passwordHash: draft.passwordHash!,
              role: "MEMBRE", associationId: draft.associationId,
              termsAcceptedAt: draft.conditionsAgreedAt ?? now,
              termsAcceptedIp: draft.termsAcceptedIp ?? undefined,
            },
          })
          const membre = await tx.membre.create({
            data: {
              firstName: r.firstName, lastName: r.lastName, email: draft.email,
              phone:         r.phone || null,
              address:       r.address || null,
              birthDate:     birthDateValue,
              sexe:          sexeValue,
              spokenLanguage: spokenLanguageValue,
              photoUrl:      r.photoUrl || null,
              preferredLocale: r.locale || null,
              status:        "ACTIF",
              associationId: draft.associationId,
              typeId:        tier.membreTypeId,
              userId:        user.id,
              answers,
            },
          })
          membreId      = membre.id
          firstMembreId = membre.id
        } else {
          const membre = await tx.membre.create({
            data: {
              firstName: r.firstName, lastName: r.lastName, email: null,
              phone:         r.phone || null,
              address:       r.address || null,
              birthDate:     birthDateValue,
              sexe:          sexeValue,
              spokenLanguage: spokenLanguageValue,
              photoUrl:      r.photoUrl || null,
              preferredLocale: r.locale || null,
              status:        "ACTIF",
              associationId: draft.associationId,
              typeId:        tier.membreTypeId,
              responsableId: firstMembreId,
              answers,
            },
          })
          membreId = membre.id
        }
        ids.push(membreId)

        await tx.cotisation.create({
          data: {
            membreId, associationId: draft.associationId, year: currentCotisationYear(now),
            amount, amountPaid: amount, status: amount > 0 ? "PAYE" : "EXONERE", paidAt: now,
            membershipFormId: form.id, tierId: tier.id,
            periodStart, periodEnd, taxReceiptEligible: tier.taxReceiptEligible,
          },
        })
      }

      await tx.membershipCheckoutDraft.update({ where: { id: draftId }, data: { consumedAt: now } })
      return ids
    })
  } catch (err) {
    // Same "money (if any) already moved, a human must reconcile" reasoning as
    // handleMembershipOneOffCheckout's own catch block — a redelivered event or a genuine
    // race can throw here (e.g. draft.email now collides with a Membre created in between).
    console.error(`[membership-multi] failed to consume checkout draft ${draftId} (association ${draft.associationId}):`, err)
    const isDuplicateEmail = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
    const admins = await prisma.user.findMany({
      where:  { associationId: draft.associationId, role: { in: ["ADMIN", "PRESIDENT"] }, active: true },
      select: { id: true },
    })
    if (admins.length) {
      await prisma.notification.createMany({
        data: admins.map(a => ({
          userId: a.id,
          title:  "Adhésion multiple à vérifier manuellement",
          body:   `Une inscription de ${registrants.length} adhérents (${draft.email}) n'a pas pu être créée automatiquement${isDuplicateEmail ? " (email déjà utilisé)" : ""}. Créez les comptes manuellement.`,
          link:   "/dashboard/membres",
          scope:  "GESTION",
        })),
        skipDuplicates: true,
      })
      await pusherServer.trigger(`private-association-${draft.associationId}`, "new-notification", {}).catch(() => {})
    }
    return isDuplicateEmail ? { status: "duplicate-email" } : { status: "error" }
  }

  const assoc = await prisma.association.findUnique({
    where:  { id: draft.associationId },
    select: { name: true, slug: true, modules: true, plan: true, customMemberLimit: true, customBrandingEnabled: true, logoUrl: true },
  })

  if (assoc?.slug) {
    const primary = registrants[0]

    sendEmail(membershipWelcomeEmail({
      firstName:       primary.firstName,
      email:           draft.email,
      associationName: assoc.name,
      amount:          Number(draft.totalAmount),
      loginUrl:        `${APP_URL}/portal/${assoc.slug}/login`,
      branding:        resolveDocumentBranding(assoc),
      otherRegistrants: registrants.slice(1).map(r => `${r.firstName} ${r.lastName}`),
    }), { associationId: draft.associationId, membreId: membreIds[0], source: "TRANSACTION", sourceId: draftId }).catch(() => {})

    for (let i = 0; i < registrants.length; i++) {
      fireEventRule({
        triggerType: "MEMBER_CREATED",
        associationId: draft.associationId,
        association: { name: assoc.name, slug: assoc.slug, modules: assoc.modules, plan: assoc.plan, customBrandingEnabled: assoc.customBrandingEnabled, logoUrl: assoc.logoUrl },
        membre: { id: membreIds[i], firstName: registrants[i].firstName, lastName: registrants[i].lastName, email: i === 0 ? draft.email : null, phone: registrants[i].phone ?? null },
      }).catch(() => {})
    }
  }

  notifyMembershipSignup({
    associationId: draft.associationId, formTitle: form.title, adminNotificationEmail: form.adminNotificationEmail,
    memberNames: registrants.map(r => `${r.firstName} ${r.lastName}`), amount: Number(draft.totalAmount), primaryMembreId: membreIds[0],
  }).catch(() => {})

  await writeActivityLog({
    associationId: draft.associationId,
    action:        "MEMBRE_CREATED",
    entity:        "Membre",
    entityId:      membreIds[0],
    label:         `${registrants[0].firstName} ${registrants[0].lastName} + ${registrants.length - 1} (${form.title})`,
  })

  // The visitor already paid (if totalAmount > 0) — assertMemberLimit was only checked before
  // Stripe redirected them away (or right before this ran, for the free path), and can't be
  // re-enforced now without refunding a real charge. Same informational-only reasoning as
  // handleMembershipOneOffCheckout's own overage check, just for N members at once.
  if (assoc) {
    const [pricing, activeCount] = await Promise.all([
      getPricingInfo(),
      prisma.membre.count({ where: { associationId: draft.associationId, status: "ACTIF" } }),
    ])
    const limit = effectiveMemberLimit(assoc, pricing)
    if (activeCount > limit) {
      const admins = await prisma.user.findMany({
        where:  { associationId: draft.associationId, role: { in: ["ADMIN", "PRESIDENT"] }, active: true },
        select: { id: true },
      })
      if (admins.length) {
        await prisma.notification.createMany({
          data: admins.map(a => ({
            userId: a.id,
            title:  "Limite de membres dépassée",
            body:   `${registrants.length} adhérents ont été inscrits, mais votre formule ne couvre que ${limit} membres actifs (vous en avez maintenant ${activeCount}). Envisagez de passer à la formule supérieure.`,
            link:   "/dashboard/parametres",
            scope:  "GESTION",
          })),
          skipDuplicates: true,
        })
        await pusherServer.trigger(`private-association-${draft.associationId}`, "new-notification", {}).catch(() => {})
      }
    }
  }

  return { status: "consumed", membreIds }
}

// ─── checkout.session.completed (mode: "payment", kind: "membership-multi") ────────
//
// A paid multi-registrant submission's Checkout Session — the draft itself already carries
// every registrant's identity (see checkout/route.ts), so there's nothing to read off the
// session beyond which draft this payment was for. consumeMembershipCheckoutDraft's own
// consumedAt check makes this safe against a redelivered event.
export async function handleMembershipMultiCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const draftId = session.metadata?.draftId
  if (!session.metadata?.kind || session.metadata.kind !== "membership-multi" || !draftId) return

  const result = await consumeMembershipCheckoutDraft(draftId)
  if (result.status === "error" || result.status === "duplicate-email") {
    // consumeMembershipCheckoutDraft already logged and notified admins for both — nothing
    // left to do here besides not silently swallowing a truly unexpected "not-found" (a
    // draft the sweep cron shouldn't have been able to reach yet, given it only deletes rows
    // past expiresAt and this session completed well before that).
    return
  }
  if (result.status === "not-found") {
    console.error(`[membership-multi] checkout.session.completed for session ${session.id} referenced draft ${draftId}, which no longer exists.`)
  }
}
