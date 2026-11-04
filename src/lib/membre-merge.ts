import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { assertCanDeactivateAdministrator } from "@/lib/team-access"
import { cancelActiveCotisationSubscriptionForMembre } from "@/lib/webhook/cotisation-subscriptions"
import { MERGEABLE_MEMBRE_FIELDS, type FieldResolutions } from "@/lib/membre-merge-fields"

export type { FieldResolution, FieldResolutions, MergeableMembreField } from "@/lib/membre-merge-fields"

export type MergeConflict = { table: string; id: string; reason: string }

export type MergeMembresResult = {
  relationCounts: Record<string, number>
  conflicts: MergeConflict[]
  portalAccountDeactivated: boolean
}

export class MergeMembresError extends Error {
  status: number
  constructor(message: string, status = 422) {
    super(message)
    this.status = status
  }
}

type MergeMembresInput = {
  associationId: string
  primaryMembreId: string
  secondaryMembreId: string
  fieldResolutions: FieldResolutions
  performedById: string
}

// Reassigns every table that references a Membre from the secondary record onto the primary,
// then soft-deletes the secondary (mergedIntoId/mergedAt/mergedById) — it is never
// hard-deleted, so any row that couldn't be reassigned because of a unique-constraint
// collision stays fully intact and queryable on that now-archived row. One entry point for
// both the dashboard and backoffice merge routes.
export async function mergeMembres(input: MergeMembresInput): Promise<MergeMembresResult> {
  const { associationId, primaryMembreId, secondaryMembreId, fieldResolutions, performedById } = input

  if (primaryMembreId === secondaryMembreId) {
    throw new MergeMembresError("Impossible de fusionner un membre avec lui-même")
  }

  const [primary, secondary] = await Promise.all([
    prisma.membre.findFirst({ where: { id: primaryMembreId, associationId, deletedAt: null } }),
    prisma.membre.findFirst({ where: { id: secondaryMembreId, associationId, deletedAt: null } }),
  ])
  if (!primary) throw new MergeMembresError("Membre principal introuvable", 404)
  if (!secondary) throw new MergeMembresError("Membre secondaire introuvable", 404)

  // The secondary's User always risks deactivation (see bothHaveAccounts below) — if that User
  // is the one performing this very request, a successful merge would lock them out of their
  // own session mid-action. Same guard as DELETE /api/membres/[id]'s self-delete check.
  if (secondary.userId === performedById) {
    throw new MergeMembresError("Vous ne pouvez pas fusionner votre propre compte comme membre secondaire", 403)
  }

  // Both have a portal account — can't merge two logins, so the secondary's gets deactivated
  // exactly like a plain member delete would (see DELETE /api/membres/[id]). If that account
  // happens to be the association's last administrator, refuse up front rather than silently
  // locking everyone out — same guard the delete route already applies.
  const bothHaveAccounts = !!primary.userId && !!secondary.userId
  if (bothHaveAccounts && secondary.userId) {
    const refusal = await assertCanDeactivateAdministrator(associationId, secondary.userId)
    if (refusal) throw new MergeMembresError(refusal.error, refusal.status)
  }

  const conflicts: MergeConflict[] = []
  const relationCounts: Record<string, number> = {}

  // 1:1 relation (unique membreId): reassign only if the primary doesn't already have one.
  async function reassignOneToOne(
    tx: Prisma.TransactionClient,
    model: "cotisationSubscription" | "membreControlAlert",
    label: string,
  ) {
    const [onPrimary, onSecondary] = await Promise.all([
      (tx[model] as { findUnique: (args: unknown) => Promise<{ id: string } | null> }).findUnique({ where: { membreId: primaryMembreId } }),
      (tx[model] as { findUnique: (args: unknown) => Promise<{ id: string } | null> }).findUnique({ where: { membreId: secondaryMembreId } }),
    ])
    if (!onSecondary) return
    if (onPrimary) {
      conflicts.push({ table: label, id: onSecondary.id, reason: "Le membre principal a déjà un enregistrement actif de ce type" })
      return
    }
    await (tx[model] as { update: (args: unknown) => Promise<unknown> }).update({
      where: { id: onSecondary.id },
      data:  { membreId: primaryMembreId },
    })
    relationCounts[label] = (relationCounts[label] ?? 0) + 1
  }

  // Composite-unique / natural-key relation: a Postgres transaction aborts entirely after any
  // statement error, so a would-be collision can never be caught-and-continued mid-transaction
  // (unlike a bare P2002 outside one) — conflicts must be detected in memory, before issuing
  // any write, not discovered by letting the database reject a row. Reassigns every secondary
  // row EXCEPT those whose natural key (year/actualiteId/sondageId/meetingId) the primary
  // already has — a `notIn` exclusion rather than an `in` allowlist, since ActualiteRecipient
  // and SondageRecipient have no single `id` column (composite primary key) to collect.
  async function reassignByNaturalKey(
    tx: Prisma.TransactionClient,
    model: "cotisation" | "actualiteRecipient" | "sondageRecipient" | "sondageReponse" | "meetingParticipant",
    label: string,
    keyField: string,
    primaryKeys: (string | number)[],
    secondaryKeys: (string | number)[],
    reason: string,
  ) {
    const primaryKeySet = new Set(primaryKeys)
    const conflictingKeys = [...new Set(secondaryKeys.filter(key => primaryKeySet.has(key)))]
    for (const key of conflictingKeys) conflicts.push({ table: label, id: `${key}`, reason })

    const { count } = await (tx[model] as { updateMany: (args: unknown) => Promise<{ count: number }> }).updateMany({
      where: { membreId: secondaryMembreId, [keyField]: { notIn: conflictingKeys } },
      data:  { membreId: primaryMembreId },
    })
    if (count > 0) relationCounts[label] = count
  }

  let portalAccountDeactivated = false
  let leftoverCotisationSubscriptionOnSecondary = false

  await prisma.$transaction(async (tx) => {
    // ─── Scalar fields ──────────────────────────────────────────────────────────────────
    const scalarUpdate: Record<string, unknown> = {}
    for (const field of MERGEABLE_MEMBRE_FIELDS) {
      if (fieldResolutions[field] === "SECONDARY") {
        scalarUpdate[field] = secondary[field as keyof typeof secondary]
      }
    }

    // ─── Self-relation guards ───────────────────────────────────────────────────────────
    // A record can't be its own parent after the merge.
    if (primary.responsableId === secondaryMembreId) scalarUpdate.responsableId = null

    if (Object.keys(scalarUpdate).length > 0) {
      await tx.membre.update({ where: { id: primaryMembreId }, data: scalarUpdate })
    }

    // Reassign the secondary's dependants to the primary — excluding the primary itself, in
    // case the primary happens to be one of the secondary's own dependants (would otherwise
    // try to set a member as its own responsable).
    const { count: dependantsCount } = await tx.membre.updateMany({
      where: { responsableId: secondaryMembreId, id: { not: primaryMembreId } },
      data:  { responsableId: primaryMembreId },
    })
    if (dependantsCount > 0) relationCounts.dependants = dependantsCount

    // ─── 1:1 relations ──────────────────────────────────────────────────────────────────
    await reassignOneToOne(tx, "cotisationSubscription", "cotisationSubscription")
    await reassignOneToOne(tx, "membreControlAlert", "controlAlert")
    leftoverCotisationSubscriptionOnSecondary = conflicts.some(c => c.table === "cotisationSubscription")

    // ─── Composite-unique / natural-key relations ───────────────────────────────────────
    const [
      primaryCotisationYears, secondaryCotisationYears,
      primaryActualiteIds, secondaryActualiteIds,
      primarySondageRecipientIds, secondarySondageRecipientIds,
      primarySondageReponseIds, secondarySondageReponseIds,
      primaryMeetingIds, secondaryMeetingIds,
      primaryActiveErasure, secondaryActiveErasureRequests,
    ] = await Promise.all([
      tx.cotisation.findMany({ where: { membreId: primaryMembreId }, select: { year: true } }).then(r => r.map(x => x.year)),
      tx.cotisation.findMany({ where: { membreId: secondaryMembreId }, select: { year: true } }).then(r => r.map(x => x.year)),
      tx.actualiteRecipient.findMany({ where: { membreId: primaryMembreId }, select: { actualiteId: true } }).then(r => r.map(x => x.actualiteId)),
      tx.actualiteRecipient.findMany({ where: { membreId: secondaryMembreId }, select: { actualiteId: true } }).then(r => r.map(x => x.actualiteId)),
      tx.sondageRecipient.findMany({ where: { membreId: primaryMembreId }, select: { sondageId: true } }).then(r => r.map(x => x.sondageId)),
      tx.sondageRecipient.findMany({ where: { membreId: secondaryMembreId }, select: { sondageId: true } }).then(r => r.map(x => x.sondageId)),
      tx.sondageReponse.findMany({ where: { membreId: primaryMembreId }, select: { sondageId: true } }).then(r => r.map(x => x.sondageId)),
      tx.sondageReponse.findMany({ where: { membreId: secondaryMembreId }, select: { sondageId: true } }).then(r => r.map(x => x.sondageId)),
      tx.meetingParticipant.findMany({ where: { membreId: primaryMembreId }, select: { meetingId: true } }).then(r => r.map(x => x.meetingId)),
      tx.meetingParticipant.findMany({ where: { membreId: secondaryMembreId }, select: { meetingId: true } }).then(r => r.map(x => x.meetingId)),
      tx.erasureRequest.findFirst({ where: { membreId: primaryMembreId, status: { in: ["REVIEW", "PENDING", "HELD"] } }, select: { id: true } }),
      tx.erasureRequest.findMany({ where: { membreId: secondaryMembreId, status: { in: ["REVIEW", "PENDING", "HELD"] } }, select: { id: true } }),
    ])
    await reassignByNaturalKey(tx, "cotisation", "cotisations", "year", primaryCotisationYears, secondaryCotisationYears,
      "Le membre principal a déjà une cotisation pour cette année")
    await reassignByNaturalKey(tx, "actualiteRecipient", "actualiteRecipients", "actualiteId", primaryActualiteIds, secondaryActualiteIds,
      "Le membre principal est déjà destinataire de cette actualité")
    await reassignByNaturalKey(tx, "sondageRecipient", "sondageRecipients", "sondageId", primarySondageRecipientIds, secondarySondageRecipientIds,
      "Le membre principal est déjà destinataire de ce sondage")
    await reassignByNaturalKey(tx, "sondageReponse", "sondageReponses", "sondageId", primarySondageReponseIds, secondarySondageReponseIds,
      "Le membre principal a déjà répondu à ce sondage")
    await reassignByNaturalKey(tx, "meetingParticipant", "meetingParticipants", "meetingId", primaryMeetingIds, secondaryMeetingIds,
      "Le membre principal participe déjà à cette réunion")

    // Active erasure requests: at most one per member (partial unique index, not expressible
    // in the Prisma schema — see ErasureRequest's comment). If the primary already has one,
    // every active request on the secondary is a conflict; otherwise reassign the (at most
    // one) active request directly.
    if (secondaryActiveErasureRequests.length > 0) {
      if (primaryActiveErasure) {
        for (const row of secondaryActiveErasureRequests) conflicts.push({ table: "erasureRequests", id: row.id, reason: "Le membre principal a déjà une demande d'effacement active" })
      } else {
        await tx.erasureRequest.updateMany({
          where: { id: { in: secondaryActiveErasureRequests.map(r => r.id) } },
          data:  { membreId: primaryMembreId },
        })
        relationCounts.erasureRequests = (relationCounts.erasureRequests ?? 0) + secondaryActiveErasureRequests.length
      }
    }

    // Historical (PROCESSED) erasure requests carry no uniqueness constraint — safe to move
    // in bulk, same as the plain relations below.
    const { count: processedErasureCount } = await tx.erasureRequest.updateMany({
      where: { membreId: secondaryMembreId, status: "PROCESSED" },
      data:  { membreId: primaryMembreId },
    })
    if (processedErasureCount > 0) relationCounts.erasureRequests = (relationCounts.erasureRequests ?? 0) + processedErasureCount

    // ─── Plain relations (no unique constraint on membreId) ────────────────────────────
    const plainRelations: { model: "participation" | "don" | "membershipAddonPurchase" | "automationLog" | "emailMessage" | "smsMessage" | "materialLoan" | "boutiqueCommande"; label: string }[] = [
      { model: "participation",            label: "participations" },
      { model: "don",                      label: "dons" },
      { model: "membershipAddonPurchase",  label: "membershipAddonPurchases" },
      { model: "automationLog",            label: "automationLogs" },
      { model: "emailMessage",             label: "emailMessages" },
      { model: "smsMessage",               label: "smsMessages" },
      { model: "materialLoan",             label: "materialLoans" },
      { model: "boutiqueCommande",         label: "boutiqueCommandes" },
    ]
    for (const { model, label } of plainRelations) {
      const { count } = await (tx[model] as { updateMany: (args: unknown) => Promise<{ count: number }> }).updateMany({
        where: { membreId: secondaryMembreId },
        data:  { membreId: primaryMembreId },
      })
      if (count > 0) relationCounts[label] = count
    }

    // Income uses `memberId`, not `membreId` — the one inconsistently-named FK column on this
    // relation (see prisma/schema.prisma Income model), so it can't share the generic loop above.
    const { count: incomeCount } = await tx.income.updateMany({
      where: { memberId: secondaryMembreId },
      data:  { memberId: primaryMembreId },
    })
    if (incomeCount > 0) relationCounts.incomes = incomeCount

    // ─── Portal account (User) ──────────────────────────────────────────────────────────
    if (!primary.userId && secondary.userId) {
      // Only the secondary has a portal login — adopt it onto the primary rather than losing
      // it. secondary.userId is freed first since Membre.userId is @unique.
      await tx.membre.update({ where: { id: secondaryMembreId }, data: { userId: null } })
      await tx.membre.update({ where: { id: primaryMembreId }, data: { userId: secondary.userId } })
    } else if (bothHaveAccounts && secondary.userId) {
      // Can't merge two logins — deactivate the secondary's, same scrambled-email convention
      // as the plain delete route (the email must be released for `@@unique([email,
      // associationId])`, which has no soft-delete exclusion).
      await tx.user.update({
        where: { id: secondary.userId },
        data:  { active: false, deletedAt: new Date(), email: `deleted+${secondary.userId}@deleted.invalid` },
      })
      portalAccountDeactivated = true
    }

    // ─── Stamp the secondary ────────────────────────────────────────────────────────────
    await tx.membre.update({
      where: { id: secondaryMembreId },
      data:  { deletedAt: new Date(), mergedIntoId: primaryMembreId, mergedAt: new Date(), mergedById: performedById },
    })

    // ─── Duplicate-match bookkeeping ────────────────────────────────────────────────────
    await tx.membreDuplicateMatch.updateMany({
      where: {
        status: "PENDING",
        OR: [
          { membreAId: primaryMembreId, membreBId: secondaryMembreId },
          { membreAId: secondaryMembreId, membreBId: primaryMembreId },
        ],
      },
      data: { status: "MERGED" },
    })
    await tx.membreDuplicateMatch.updateMany({
      where: {
        status: "PENDING",
        OR: [{ membreAId: secondaryMembreId }, { membreBId: secondaryMembreId }],
      },
      data: { status: "DISMISSED", autoDismissed: true, dismissedAt: new Date() },
    })

    // ─── Audit log ──────────────────────────────────────────────────────────────────────
    await tx.membreMergeLog.create({
      data: {
        associationId, primaryMembreId, secondaryMembreId, performedById,
        fieldResolutions: fieldResolutions as Prisma.InputJsonValue,
        relationCounts:   relationCounts as Prisma.InputJsonValue,
        conflicts:        conflicts as unknown as Prisma.InputJsonValue,
      },
    })
  }, {
    // Default is 5s — easily exceeded here: the merge reads and writes ~15 relations, several
    // as their own round-trip (composite-key tables can't be batched into one query), on top
    // of whatever latency the pooler connection adds. 20s gives real headroom without masking
    // a genuinely hung query.
    timeout: 20_000,
  })

  await writeActivityLog({
    associationId, actorId: performedById, action: "MEMBRE_MERGED", entity: "Membre", entityId: primaryMembreId,
    label: `${primary.firstName} ${primary.lastName}`,
    metadata: { secondaryMembreId, relationCounts, conflictCount: conflicts.length },
  })

  // Best-effort, outside the transaction (external Stripe call) — a member merged away must
  // stop being billed under its own identity, same reasoning as the plain delete route. Only
  // relevant when the secondary's subscription was left in place by the 1:1 conflict above
  // (if it was reassigned, it now correctly bills the primary and must keep running).
  if (leftoverCotisationSubscriptionOnSecondary) {
    await cancelActiveCotisationSubscriptionForMembre(secondaryMembreId, {
      actorId: performedById, label: `${secondary.firstName} ${secondary.lastName}`,
    })
  }

  return { relationCounts, conflicts, portalAccountDeactivated }
}
