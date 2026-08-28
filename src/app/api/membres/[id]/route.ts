import { NextResponse } from "next/server"
import { addMonths } from "date-fns"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { membreUpdateSchema } from "@/lib/schemas"
import { writeActivityLog, computeMemberDiff } from "@/lib/activity-log"
import { isMembreAdherent, membreAdherentCotisationSelect, currentCotisationYear } from "@/lib/membre-adherent"
import { cancelActiveCotisationSubscriptionForMembre } from "@/lib/webhook/cotisation-subscriptions"

const RESPONSABLE_SELECT = {
  select: {
    id: true, firstName: true, lastName: true,
    adherentOverride: true,
    cotisations: membreAdherentCotisationSelect(),
  },
} as const

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
// Forcing a member's adhérent status is a financial call equivalent to marking a cotisation
// paid — same role set as /api/association/cotisation-defaults, narrower than MANAGERS so
// SECRETAIRE can still manage every other membre field but not this one.
const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const membre = await prisma.membre.findFirst({
    where: { id, associationId, deletedAt: null },
    include: {
      cotisations:    {
        orderBy: { year: "desc" },
        take:    50,
        include: { installmentPlan: { select: { id: true, status: true, installmentsPaid: true, installmentsCount: true } } },
      },
      participations: { include: { evenement: true }, orderBy: { createdAt: "desc" }, take: 50 },
      // Ordered by the meeting's createdAt (always set), not scheduledAt (null for
      // "start now" instant meetings) — same reasoning as /api/meetings's own ordering:
      // sorting by a nullable column puts every instant meeting first regardless of how
      // old it is, since Postgres sorts NULL first on DESC.
      meetingsAsParticipant: {
        include: { meeting: { select: { id: true, title: true, status: true, scheduledAt: true, createdAt: true } } },
        orderBy: { meeting: { createdAt: "desc" } },
        take:    50,
      },
      materialLoans:  { include: { material: { select: { id: true, name: true } } }, orderBy: { borrowedAt: "desc" }, take: 50 },
      type:           { select: { id: true, name: true, color: true } },
      user:           { select: { role: true } },
      responsable:    RESPONSABLE_SELECT,
      dependants:     { select: { id: true, firstName: true, lastName: true } },
      cotisationSubscription: { select: { id: true, amount: true, status: true, currentPeriodEndsAt: true } },
      // Options bought alongside a MembershipForm signup (see membership-tiers-editor.tsx's
      // ADDON item type) — otherwise invisible anywhere in the admin.
      membershipAddonPurchases: { orderBy: { purchasedAt: "desc" }, take: 50 },
      // The DONATION-item-type counterpart — a real Don, not a MembershipAddonPurchase (see
      // Don.membershipAddonTierId). Scoped with a `where` to just that link — membre.dons in
      // general stays out of the adhésion detail view (that's the Dons module's own list, and
      // it isn't necessarily even enabled for this association).
      dons: {
        where:   { membershipAddonTierId: { not: null } },
        orderBy: { paidAt: "desc" },
        take:    50,
        select:  { id: true, amount: true, paidAt: true, membershipAddonTier: { select: { label: true } } },
      },
      // Lets the detail view tell "showing the 50 most recent" from "that's really all of them" —
      // a long-standing member can have far more rows than the take:50 caps above return.
      _count: { select: { cotisations: true, participations: true, materialLoans: true, meetingsAsParticipant: true } },
    },
  })

  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  // Membre.answers is keyed by "mobile" (fixed) or a MembershipFormField id — resolved here
  // so membre-detail-view.tsx can render real labels without a second round-trip. "mobile"
  // has no MembershipFormField row to look up, so it's handled separately from the rest.
  let customFieldAnswers: { label: string; value: string }[] = []
  const rawAnswers = membre.answers as Record<string, string> | null
  if (rawAnswers && Object.keys(rawAnswers).length > 0) {
    const fieldIds = Object.keys(rawAnswers).filter(k => k !== "mobile")
    const fields = fieldIds.length
      ? await prisma.membershipFormField.findMany({ where: { id: { in: fieldIds } }, select: { id: true, label: true } })
      : []
    const labelById = new Map(fields.map(f => [f.id, f.label]))
    customFieldAnswers = Object.entries(rawAnswers)
      .filter(([k]) => k !== "mobile")
      .map(([k, value]) => ({ label: labelById.get(k) ?? k, value }))
  }

  return NextResponse.json({
    ...membre,
    mobile: rawAnswers?.mobile ?? null,
    customFieldAnswers,
    isAdherent: isMembreAdherent(membre),
  })
})

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId, role: actorRole } = ctx

  const existing = await prisma.membre.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const body = await req.json()
  const parsed = membreUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { birthDate, email, phone, address, typeId, civilite, sexe, groupeSanguin, allergies, photoUrl, preferredLocale, possedeTshirt, tailleTshirt, responsableId, adherentOverride, ...rest } = parsed.data

  if (adherentOverride !== undefined && !FINANCE.includes(actorRole)) {
    return NextResponse.json({ error: "Seuls un administrateur, président ou trésorier peuvent forcer le statut d'adhésion" }, { status: 403 })
  }

  // Any status other than ACTIF flips User.active to false below (line ~81) — blocking only
  // "INACTIF" here left PENDING/SUSPENDU as an unguarded way to lock yourself out.
  if (existing.userId === userId && rest.status !== undefined && rest.status !== "ACTIF") {
    return NextResponse.json({ error: "Vous ne pouvez pas désactiver votre propre compte" }, { status: 403 })
  }

  if (responsableId) {
    if (responsableId === id) {
      return NextResponse.json({ error: "Un membre ne peut pas être son propre responsable" }, { status: 422 })
    }
    // Guards against a stale client (dropdown loaded before the candidate was deleted/
    // reassigned elsewhere) and against cross-tenant ids — without this, an invalid id
    // falls through to the FK constraint on save and crashes with a raw 500.
    const responsableExists = await prisma.membre.findFirst({
      where:  { id: responsableId, associationId, deletedAt: null },
      select: { id: true },
    })
    if (!responsableExists) {
      return NextResponse.json({ error: "Membre responsable introuvable" }, { status: 422 })
    }
  }

  // Server-side backstop for the client's reactive clear (membre-form.tsx): never persist
  // "does not have a t-shirt" alongside a size, regardless of what the request body says.
  const possedeTshirtValue = possedeTshirt === undefined ? undefined : (possedeTshirt === "" ? null : possedeTshirt === "true")
  const tailleTshirtValue  = possedeTshirtValue === false ? null : (tailleTshirt === undefined ? undefined : (tailleTshirt || null))
  const adherentOverrideValue = adherentOverride === undefined ? undefined : (adherentOverride === "" ? null : adherentOverride === "true")

  const emailChanged = email !== undefined && email !== existing.email

  if (emailChanged && email) {
    // Members created via public self-registration have no linked User (userId: null) —
    // check for conflicts against other Membre rows too, not just the User table, so two
    // members can't silently end up sharing an email.
    const membreConflict = await prisma.membre.findFirst({
      where: { email, associationId, deletedAt: null, id: { not: id } },
    })
    if (membreConflict) {
      return NextResponse.json({ field: "email", error: "Cet email est déjà utilisé par un autre membre." }, { status: 409 })
    }
    if (existing.userId) {
      const conflict = await prisma.user.findFirst({
        where: { email, associationId, id: { not: existing.userId }, deletedAt: null },
      })
      if (conflict) {
        return NextResponse.json({ field: "email", error: "Cet email est déjà utilisé." }, { status: 409 })
      }
    }
  }

  // A PENDING member approved into ACTIF who requested a free MembershipForm tier (see
  // Membre.pendingTierId) never got a Cotisation at signup time on purpose — creating one
  // then would have made isMembreAdherent() true before an admin ever reviewed the request,
  // defeating the whole point of "sur demande" validation. This is the one moment that
  // matters: read the tier once, consumed and cleared right after.
  const isApproval = existing.status === "PENDING" && rest.status === "ACTIF" && !!existing.pendingTierId
  const pendingTier = isApproval
    ? await prisma.membershipTier.findUnique({ where: { id: existing.pendingTierId! }, select: { id: true, free: true, formId: true, durationMonths: true, fixedPeriodEnd: true } })
    : null

  const membre = await prisma.$transaction(async (tx) => {
    const updated = await tx.membre.update({
      where: { id },
      data: {
        ...rest,
        ...(email         !== undefined ? { email:         email         || null } : {}),
        ...(phone         !== undefined ? { phone:         phone         || null } : {}),
        ...(address       !== undefined ? { address:       address       || null } : {}),
        ...(typeId        !== undefined ? { typeId:        typeId        || null } : {}),
        ...(civilite      !== undefined ? { civilite:      civilite      || null } : {}),
        ...(sexe          !== undefined ? { sexe:          sexe          || null } : {}),
        ...(groupeSanguin !== undefined ? { groupeSanguin: groupeSanguin || null } : {}),
        ...(allergies     !== undefined ? { allergies:     allergies     || null } : {}),
        ...(photoUrl      !== undefined ? { photoUrl:      photoUrl      || null } : {}),
        ...(preferredLocale !== undefined ? { preferredLocale: preferredLocale || null } : {}),
        ...(possedeTshirtValue !== undefined ? { possedeTshirt: possedeTshirtValue } : {}),
        ...(tailleTshirtValue  !== undefined ? { tailleTshirt:  tailleTshirtValue  } : {}),
        ...(responsableId !== undefined ? { responsableId: responsableId || null } : {}),
        ...(birthDate     !== undefined ? { birthDate: birthDate ? new Date(birthDate + "T12:00:00") : null } : {}),
        ...(adherentOverrideValue !== undefined ? { adherentOverride: adherentOverrideValue } : {}),
        ...(pendingTier   ? { pendingTierId: null } : {}),
      },
      include: { cotisations: membreAdherentCotisationSelect(), responsable: RESPONSABLE_SELECT },
    })

    if (existing.userId) {
      const userUpdate: { email?: string; active?: boolean } = {}
      if (emailChanged)            userUpdate.email  = email || existing.email!
      if (rest.status !== undefined) userUpdate.active = rest.status === "ACTIF"
      if (Object.keys(userUpdate).length > 0) {
        await tx.user.update({ where: { id: existing.userId }, data: userUpdate })
      }
    }

    // Only for a free tier — a paid one never leaves a member PENDING in the first place
    // (see checkout/route.ts's willBeImmediate), so this is defensive, not the normal path.
    if (pendingTier?.free) {
      const year = currentCotisationYear()
      const alreadyHasCotisation = await tx.cotisation.findUnique({
        where: { membreId_year: { membreId: id, year } }, select: { id: true },
      })
      if (!alreadyHasCotisation) {
        const now = new Date()
        await tx.cotisation.create({
          data: {
            membreId: id, associationId, year,
            amount: 0, amountPaid: 0, status: "EXONERE", paidAt: now,
            membershipFormId: pendingTier.formId, tierId: pendingTier.id,
            // Same durationMonths → periodStart/periodEnd snapshot as checkout/route.ts —
            // without it, a "3-month trial" tier requiring approval would silently become a
            // full calendar-year membership the moment an admin approves it.
            periodStart: pendingTier.fixedPeriodEnd || pendingTier.durationMonths ? now : null,
            periodEnd:   pendingTier.fixedPeriodEnd ?? (pendingTier.durationMonths ? addMonths(now, pendingTier.durationMonths) : null),
          },
        })
      }
    }

    return updated
  })

  const changes = computeMemberDiff(
    existing as unknown as Record<string, unknown>,
    membre   as unknown as Record<string, unknown>,
  )
  if (Object.keys(changes).length > 0) {
    await writeActivityLog({ associationId, actorId: userId, action: "MEMBRE_UPDATED", entity: "Membre", entityId: id, label: `${membre.firstName} ${membre.lastName}`, metadata: { changes } })
  }

  // A member losing ACTIF status (suspended, marked inactive, ...) shouldn't keep being
  // billed by Stripe for a recurring cotisation. Only fires on an actual transition away
  // from ACTIF (compared against the pre-update row) — cancelActiveCotisationSubscriptionForMembre
  // is already a no-op once the subscription is CANCELLED, but comparing here avoids an
  // unnecessary Stripe API round-trip on every single edit of an already-inactive member.
  if (rest.status !== undefined && rest.status !== "ACTIF" && existing.status !== rest.status) {
    await cancelActiveCotisationSubscriptionForMembre(id, { actorId: userId, label: `${membre.firstName} ${membre.lastName}` })
  }

  return NextResponse.json({ ...membre, isAdherent: isMembreAdherent(membre) })
}, { roles: MANAGERS })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.membre.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  if (existing.userId === userId) {
    return NextResponse.json({ error: "Vous ne pouvez pas supprimer votre propre compte" }, { status: 403 })
  }

  const unlinkedDependants = await prisma.$transaction(async (tx) => {
    await tx.membre.update({ where: { id }, data: { deletedAt: new Date() } })
    if (existing.userId) {
      // Scramble the email so it's released for reuse — `@@unique([email, associationId])`
      // has no exclusion for soft-deleted rows, so leaving the real email in place would
      // permanently block anyone from ever registering with it again in this association.
      await tx.user.update({
        where: { id: existing.userId },
        data:  { active: false, deletedAt: new Date(), email: `deleted+${existing.userId}@deleted.invalid` },
      })
    }

    // onDelete: SetNull on the schema only fires on a hard delete — this is a soft delete
    // (deletedAt), so without this, any minor whose "responsable" was this member would be
    // left pointing at an archived, unreachable Membre (dead link on their fiche).
    const { count } = await tx.membre.updateMany({
      where: { responsableId: id, associationId },
      data:  { responsableId: null },
    })
    return count
  })

  await writeActivityLog({ associationId, actorId: userId, action: "MEMBRE_DELETED", entity: "Membre", entityId: id, label: `${existing.firstName} ${existing.lastName}` })

  // A deleted member must stop being billed by Stripe for a recurring cotisation.
  await cancelActiveCotisationSubscriptionForMembre(id, { actorId: userId, label: `${existing.firstName} ${existing.lastName}` })

  return NextResponse.json({ deletedId: id, unlinkedDependants })
}, { roles: MANAGERS })
