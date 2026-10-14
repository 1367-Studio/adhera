import { NextResponse } from "next/server"
import { addMonths } from "date-fns"
import { withAdminAuth } from "@/lib/api-wrapper"
import { hasAccess } from "@/lib/permissions"
import { prisma } from "@/lib/prisma/client"
import { membreUpdateSchema } from "@/lib/schemas"
import { addressColumnsPatch } from "@/lib/address"
import { writeActivityLog, computeMemberDiff } from "@/lib/activity-log"
import { isMembreAdherent, membreAdherentCotisationSelect, currentCotisationYear } from "@/lib/membre-adherent"
import { MOBILE_ANSWER_KEY, mergeAnswers, readMobileAnswer } from "@/lib/membre-answers"
import { cancelActiveCotisationSubscriptionForMembre } from "@/lib/webhook/cotisation-subscriptions"
import { grantMembrePortalAccess } from "@/lib/membre-access"
import { assertCanDeactivateAdministrator } from "@/lib/team-access"
import { resolveMembreMembershipFormId } from "@/lib/membre-membership-form"
import { findInvalidMembershipFormAnswer } from "@/lib/membership-form-answers-validation"
import { reportError } from "@/lib/monitoring"
import {
  redactSensitiveMembreFields, stripSensitiveMembreFields,
  filterSensitiveCustomFieldAnswers, filterEditableSensitiveCustomFields, stripSensitiveCustomFieldAnswers,
} from "@/lib/membre-sensitive-fields"

const RESPONSABLE_SELECT = {
  select: {
    id: true, firstName: true, lastName: true,
    adherentOverride: true,
    cotisations: membreAdherentCotisationSelect(),
  },
} as const


export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const membre = await prisma.membre.findFirst({
    where: { id, associationId, deletedAt: null },
    include: {
      cotisations:    {
        orderBy: { year: "desc" },
        take:    50,
        include: {
          installmentPlan: { select: { id: true, status: true, installmentsPaid: true, installmentsCount: true } },
          tier:            { select: { label: true } },
        },
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
      // Only ever set on a PENDING membre created by a "validation sur demande" form (see
      // Membre.pendingTierId) — drives the approval banner in membre-detail-view.tsx, which
      // needs the requested tier's label to say what is actually being approved.
      pendingTier:    { select: { id: true, label: true, free: true } },
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
      // Both self-service (online) and admin-recorded (manual) Boutique sales — see
      // POST /api/boutique/commandes. Previously invisible anywhere on the contact's own page.
      boutiqueCommandes: {
        orderBy: { createdAt: "desc" },
        take:    50,
        include: { items: { include: { produit: { select: { name: true } }, variante: { select: { label: true } } } } },
      },
      // Lets the detail view tell "showing the 50 most recent" from "that's really all of them" —
      // a long-standing member can have far more rows than the take:50 caps above return.
      _count: { select: { cotisations: true, participations: true, materialLoans: true, meetingsAsParticipant: true, boutiqueCommandes: true } },
    },
  })

  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  // Membre.answers is keyed by "mobile" (fixed) or a MembershipFormField id — resolved here
  // so membre-detail-view.tsx can render real labels without a second round-trip. "mobile"
  // has no MembershipFormField row to look up, so it's handled separately from the rest.
  let customFieldAnswers: { label: string; value: string; sensible: boolean }[] = []
  const rawAnswers = membre.answers as Record<string, string> | null
  if (rawAnswers && Object.keys(rawAnswers).length > 0) {
    const fieldIds = Object.keys(rawAnswers).filter(k => k !== "mobile")
    const fields = fieldIds.length
      ? await prisma.membershipFormField.findMany({ where: { id: { in: fieldIds } }, select: { id: true, label: true, sensible: true } })
      : []
    const fieldById = new Map(fields.map(f => [f.id, f]))
    // An orphaned answer (its MembershipFormField was deleted from the form editor — a hard
    // delete, see custom-fields/route.ts's PUT) defaults to `sensible: true`, not false: we no
    // longer know whether it used to be marked sensitive, and failing open would silently
    // un-gate a health/guardian answer the moment its field definition is removed.
    customFieldAnswers = Object.entries(rawAnswers)
      .filter(([k]) => k !== "mobile")
      .map(([k, value]) => ({ label: fieldById.get(k)?.label ?? k, value, sensible: fieldById.get(k)?.sensible ?? true }))
  }
  customFieldAnswers = filterSensitiveCustomFieldAnswers(customFieldAnswers, ctx.permissions)

  // The full field set of the MembershipForm this member actually joined through — not just
  // the fields they already answered — so "Editar membro" can render an empty optional field
  // too. Empty for a member with no traceable form (manual creation, legacy /inscription):
  // the edit modal then shows no custom-fields section at all, unchanged from before this.
  const membershipFormId = await resolveMembreMembershipFormId(id)
  const editableCustomFields = filterEditableSensitiveCustomFields(
    membershipFormId
      ? (await prisma.membershipFormField.findMany({
          where:   { formId: membershipFormId },
          orderBy: { order: "asc" },
          select:  { id: true, type: true, label: true, required: true, options: true, sensible: true },
        })).map(field => ({ field, value: rawAnswers?.[field.id] ?? "" }))
      : [],
    ctx.permissions,
  )

  return NextResponse.json(redactSensitiveMembreFields({
    ...membre,
    mobile: readMobileAnswer(rawAnswers),
    customFieldAnswers,
    editableCustomFields,
    isAdherent: isMembreAdherent(membre),
  }, ctx.permissions))
}, { area: "membres" })

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.membre.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const body = await req.json()
  const parsed = membreUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  // Security audit M2+L8 — stripped before destructuring, not after: without the `sensible`
  // area, these 6 fields are forced to `undefined` here, so every `!== undefined` check below
  // treats them as "not submitted" and leaves the existing DB value untouched. This closes a
  // real data-loss bug, not just a visibility one — membre-form.tsx round-trips groupeSanguin/
  // allergies through hidden inputs (see its own comment), so an unauthorized user saving an
  // unrelated field change would otherwise submit an empty value for fields they never saw
  // the real content of, silently wiping someone else's data.
  const { birthDate, email, phone, mobile, answers, address, addressStreet, addressComplement, postalCode, city, country, typeId, civilite, sexe, groupeSanguin, allergies, photoUrl, preferredLocale, spokenLanguage, possedeTshirt, tailleTshirt, responsableId, adherentOverride, notes, imageRightsConsent, guardianName, guardianPhone, secondGuardianName, secondGuardianPhone, ...rest } = stripSensitiveMembreFields(parsed.data, ctx.permissions)

  // Réponses aux champs personnalisés du formulaire d'adhésion réellement suivi par ce membre —
  // revalidées contre ce même formulaire, jamais contre un autre (voir
  // resolveMembreMembershipFormId). Un membre sans formulaire rattaché ne peut pas en recevoir :
  // le modal d'édition n'envoie alors jamais cette clé.
  //
  // Seuls les champs réellement présents dans `answers` sont validés — jamais tout le
  // formulaire. Le client n'envoie que ce qui a changé (voir membre-form.tsx), donc un champ
  // devenu obligatoire après l'adhésion d'un membre, jamais rempli, ne doit jamais bloquer une
  // modification qui ne le touche pas (changer un téléphone, par exemple) : il resterait sinon
  // impossible à modifier tant que ce champ précis n'est pas renseigné.
  let sanitizedAnswers = answers
  if (answers !== undefined && Object.keys(answers).length > 0) {
    const submittedFieldIds = new Set(Object.keys(answers))
    const membershipFormId = await resolveMembreMembershipFormId(id)
    const fields = membershipFormId
      ? (await prisma.membershipFormField.findMany({ where: { formId: membershipFormId } }))
          .filter(field => submittedFieldIds.has(field.id))
      : []

    // Drops any submitted answer for a field marked "sensible" when the actor lacks the
    // "sensible" area's edit access — same defensive principle as stripSensitiveMembreFields
    // just above: a hidden/re-enabled input can't write a value the actor was never allowed to.
    const sensitiveFieldIds = new Set(fields.filter(f => f.sensible).map(f => f.id))
    sanitizedAnswers = stripSensitiveCustomFieldAnswers(answers, sensitiveFieldIds, ctx.permissions)

    const invalidAnswer = findInvalidMembershipFormAnswer(fields, sanitizedAnswers ?? {})
    if (invalidAnswer) {
      const message = invalidAnswer.kind === "required"
        ? `Le champ « ${invalidAnswer.field.label} » est requis.`
        : `Le champ « ${invalidAnswer.field.label} » est invalide.`
      return NextResponse.json({ error: message }, { status: 422 })
    }
  }

  // Forcing a member's adhérent status is equivalent to marking a cotisation paid, so it needs
  // Adhésions "edit" on top of Membres "edit" — the Secrétaire manages every other membre
  // field but not this one.
  if (adherentOverride !== undefined && !hasAccess(ctx.permissions, "adhesions", "edit")) {
    return NextResponse.json({ error: "Seuls un administrateur, président ou trésorier peuvent forcer le statut d'adhésion" }, { status: 403 })
  }

  // Any status other than ACTIF flips User.active to false below (line ~81) — blocking only
  // "INACTIF" here left PENDING/SUSPENDU as an unguarded way to lock yourself out.
  if (existing.userId === userId && rest.status !== undefined && rest.status !== "ACTIF") {
    return NextResponse.json({ error: "Vous ne pouvez pas désactiver votre propre compte" }, { status: 403 })
  }

  // Same last-administrator protection as Paramètres › Équipe et accès — deactivating a
  // member here flips their linked User.active below too, so it's just as real a way to
  // strip the association's last administrator of access as a role/permissions change.
  if (existing.userId && rest.status !== undefined && rest.status !== "ACTIF") {
    const refusal = await assertCanDeactivateAdministrator(associationId, existing.userId)
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status })
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
  // Same encoding as possedeTshirt. The answer is only re-dated when it actually changes —
  // re-saving the form must not make an old paper consent look recent.
  const imageRightsConsentValue = imageRightsConsent === undefined ? undefined : (imageRightsConsent === "" ? null : imageRightsConsent === "true")
  const imageRightsConsentChanged = imageRightsConsentValue !== undefined && imageRightsConsentValue !== existing.imageRightsConsent

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

  // Approving a free-tier pending request creates a Cotisation below — same Adhésions "edit"
  // requirement as every other cotisation write (../../cotisations/route.ts), on top of
  // Membres "edit": the Secrétaire, read-only on Adhésions, manages every other membre field
  // but cannot be the one who settles this member's adhésion.
  if (pendingTier?.free && !hasAccess(ctx.permissions, "adhesions", "edit")) {
    return NextResponse.json({ error: "Seuls un administrateur, président ou trésorier peuvent valider une adhésion en attente" }, { status: 403 })
  }

  const membre = await prisma.$transaction(async (tx) => {
    const updated = await tx.membre.update({
      where: { id },
      data: {
        ...rest,
        ...(email         !== undefined ? { email:         email         || null } : {}),
        ...(phone         !== undefined ? { phone:         phone         || null } : {}),
        // Le mobile et les réponses aux champs personnalisés du formulaire d'adhésion vivent
        // tous deux dans answers : un seul merge pour les deux, jamais un remplacement de
        // l'objet — et jamais deux écritures indépendantes qui s'écraseraient l'une l'autre
        // si les deux arrivent dans la même requête.
        ...((mobile !== undefined || sanitizedAnswers !== undefined)
          ? { answers: mergeAnswers(existing.answers, { ...(mobile !== undefined ? { [MOBILE_ANSWER_KEY]: mobile } : {}), ...sanitizedAnswers }) }
          : {}),
        // L'adresse se met à jour d'un bloc : les six colonnes sont recalculées ensemble à
        // partir de ce qui est envoyé complété par ce qui est déjà en base, sinon la colonne
        // héritée et les colonnes structurées finiraient par se contredire.
        ...addressColumnsPatch({ address, addressStreet, addressComplement, postalCode, city, country }, existing),
        ...(typeId        !== undefined ? { typeId:        typeId        || null } : {}),
        ...(civilite      !== undefined ? { civilite:      civilite      || null } : {}),
        ...(sexe          !== undefined ? { sexe:          sexe          || null } : {}),
        ...(groupeSanguin !== undefined ? { groupeSanguin: groupeSanguin || null } : {}),
        ...(allergies     !== undefined ? { allergies:     allergies     || null } : {}),
        ...(photoUrl      !== undefined ? { photoUrl:      photoUrl      || null } : {}),
        ...(preferredLocale !== undefined ? { preferredLocale: preferredLocale || null } : {}),
        ...(spokenLanguage  !== undefined ? { spokenLanguage:  spokenLanguage  || null } : {}),
        ...(possedeTshirtValue !== undefined ? { possedeTshirt: possedeTshirtValue } : {}),
        ...(tailleTshirtValue  !== undefined ? { tailleTshirt:  tailleTshirtValue  } : {}),
        ...(responsableId !== undefined ? { responsableId: responsableId || null } : {}),
        ...(birthDate     !== undefined ? { birthDate: birthDate ? new Date(birthDate + "T12:00:00") : null } : {}),
        ...(adherentOverrideValue !== undefined ? { adherentOverride: adherentOverrideValue } : {}),
        ...(notes         !== undefined ? { notes:         notes         || null } : {}),
        ...(guardianName        !== undefined ? { guardianName:        guardianName        || null } : {}),
        ...(guardianPhone       !== undefined ? { guardianPhone:       guardianPhone       || null } : {}),
        ...(secondGuardianName  !== undefined ? { secondGuardianName:  secondGuardianName  || null } : {}),
        ...(secondGuardianPhone !== undefined ? { secondGuardianPhone: secondGuardianPhone || null } : {}),
        ...(imageRightsConsentChanged
          ? { imageRightsConsent: imageRightsConsentValue, imageRightsConsentAt: imageRightsConsentValue === null ? null : new Date() }
          : {}),
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

  // A PENDING member approved through the "validation sur demande" path never got a User
  // account at signup (that form never collects a password — see checkout/route.ts's
  // willBeImmediate) — without this, an approved member would have no way to ever log in,
  // approval notwithstanding. grantMembrePortalAccess sends the invitation email itself
  // (temp password + login link), so this is also the member's "your membership is
  // confirmed" notice.
  if (isApproval && !membre.userId && membre.email) {
    const association = await prisma.association.findUnique({
      where:  { id: associationId },
      select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true },
    })
    if (association) {
      await grantMembrePortalAccess({ membre, associationId, actorId: userId, association }).catch(error => {
        reportError(error, { area: "email", action: "membres.approve-grant-portal-access", extra: { associationId, membreId: membre.id } })
      })
    }
  }

  const changes = computeMemberDiff(
    existing as unknown as Record<string, unknown>,
    membre   as unknown as Record<string, unknown>,
  )
  if (Object.keys(changes).length > 0) {
    // approvedFromPending flags the one case a control-alert investigation (src/app/api/
    // backoffice/control-alerts/route.ts's resolveOrigins) actually cares about here: a paid
    // pendingTier approved straight to ACTIF gets no Cotisation (see isApproval above), so
    // this is the moment that explains why the member is ACTIF with nothing billed yet.
    await writeActivityLog({
      associationId, actorId: userId, action: "MEMBRE_UPDATED", entity: "Membre", entityId: id,
      label: `${membre.firstName} ${membre.lastName}`,
      metadata: { changes, ...(isApproval ? { approvedFromPending: true } : {}) },
    })
  }

  // A member losing ACTIF status (suspended, marked inactive, ...) shouldn't keep being
  // billed by Stripe for a recurring cotisation. Only fires on an actual transition away
  // from ACTIF (compared against the pre-update row) — cancelActiveCotisationSubscriptionForMembre
  // is already a no-op once the subscription is CANCELLED, but comparing here avoids an
  // unnecessary Stripe API round-trip on every single edit of an already-inactive member.
  if (rest.status !== undefined && rest.status !== "ACTIF" && existing.status !== rest.status) {
    await cancelActiveCotisationSubscriptionForMembre(id, { actorId: userId, label: `${membre.firstName} ${membre.lastName}` })
  }

  // Unlike GET above, this response was never redacted — an actor without `sensible` access
  // could PATCH an unrelated field (e.g. phone) and get groupeSanguin/allergies/guardian* and
  // the raw answers Json (every custom field's real value) back in the response regardless.
  const { answers: _answers, ...membreWithoutAnswers } = membre
  return NextResponse.json(redactSensitiveMembreFields({ ...membreWithoutAnswers, isAdherent: isMembreAdherent(membre) }, ctx.permissions))
}, { area: "membres" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.membre.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  if (existing.userId === userId) {
    return NextResponse.json({ error: "Vous ne pouvez pas supprimer votre propre compte" }, { status: 403 })
  }

  if (existing.userId) {
    const refusal = await assertCanDeactivateAdministrator(associationId, existing.userId)
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status })
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
}, { area: "membres" })
