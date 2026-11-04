import { prisma } from "@/lib/prisma/client"
import { isPlaceholderEmail, normalizeName } from "@/lib/membre-import-matching"

// Distinct from src/lib/membre-duplicates.ts (findPossibleDuplicates), which only flags a
// hint to staff right after a public signup. This is the admin-facing review-and-merge
// system (MembreDuplicateMatch) — an on-demand scan across every existing active member,
// surfaced on /dashboard/membres/duplicates and /backoffice/membre-duplicates.

export type MembreDuplicateScanSummary = {
  pendingCount: number
  newCount: number
  autoDismissedCount: number
}

function nameKey(firstName: string, lastName: string): string {
  return `${normalizeName(firstName)}|${normalizeName(lastName)}`
}

// Canonical ordering so a pair only ever has one row — [membreAId, membreBId] with
// membreAId < membreBId by plain string compare, matching the @@unique on the model.
function pairKey(idA: string, idB: string): [string, string] {
  return idA < idB ? [idA, idB] : [idB, idA]
}

// On-demand scan for one association — no cron, triggered by the "Rechercher les doublons"
// button (dashboard) or the association picker (backoffice). Same bucketing idea as
// findPaperFormDuplicates (src/lib/paper-form/duplicates.ts), just self-paired across every
// active member instead of one scanned person against the existing set.
export async function detectMembreDuplicates(associationId: string): Promise<MembreDuplicateScanSummary> {
  const membres = await prisma.membre.findMany({
    where:  { associationId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true },
  })

  const byEmail = new Map<string, string[]>()
  const byName  = new Map<string, string[]>()
  for (const membre of membres) {
    const email = membre.email?.trim().toLowerCase()
    if (email && !isPlaceholderEmail(email)) {
      byEmail.set(email, [...(byEmail.get(email) ?? []), membre.id])
    }
    const key = nameKey(membre.firstName, membre.lastName)
    byName.set(key, [...(byName.get(key) ?? []), membre.id])
  }

  // pairKeyString -> matched fields, so a pair found via both buckets is recorded once with
  // both criteria.
  const matchedFieldsByPair = new Map<string, Set<"EMAIL" | "NAME">>()

  function addPairs(ids: string[], field: "EMAIL" | "NAME") {
    if (ids.length < 2) return
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = pairKey(ids[i], ids[j])
        const key = `${a}:${b}`
        const fields = matchedFieldsByPair.get(key) ?? new Set()
        fields.add(field)
        matchedFieldsByPair.set(key, fields)
      }
    }
  }
  for (const ids of byEmail.values()) addPairs(ids, "EMAIL")
  for (const ids of byName.values())  addPairs(ids, "NAME")

  let newCount = 0
  for (const [key, fields] of matchedFieldsByPair) {
    const [membreAId, membreBId] = key.split(":")
    const matchedFields = [...fields]
    const existing = await prisma.membreDuplicateMatch.findUnique({
      where: { membreAId_membreBId: { membreAId, membreBId } },
    })
    if (!existing) newCount++
    await prisma.membreDuplicateMatch.upsert({
      where:  { membreAId_membreBId: { membreAId, membreBId } },
      create: { associationId, membreAId, membreBId, matchedFields, lastSeenAt: new Date() },
      update: {
        // Union with whatever was already recorded — a rescan that only matched on NAME this
        // time must not drop an EMAIL match found on a previous scan.
        matchedFields: [...new Set([...(existing?.matchedFields ?? []), ...matchedFields])],
        lastSeenAt:    new Date(),
      },
    })
  }

  // Stale PENDING rows: this scan's pair set no longer includes them (an edit broke the
  // match). Never touches DISMISSED/MERGED rows — those are final, same convention as
  // MembreControlAlert never being recreated after resolution.
  const stillPendingPairs = await prisma.membreDuplicateMatch.findMany({
    where:  { associationId, status: "PENDING" },
    select: { id: true, membreAId: true, membreBId: true },
  })
  const currentPairKeys = new Set(matchedFieldsByPair.keys())
  const staleIds = stillPendingPairs
    .filter(row => !currentPairKeys.has(`${row.membreAId}:${row.membreBId}`))
    .map(row => row.id)

  let autoDismissedCount = 0
  if (staleIds.length > 0) {
    const { count } = await prisma.membreDuplicateMatch.updateMany({
      where: { id: { in: staleIds } },
      data:  { status: "DISMISSED", autoDismissed: true, dismissedAt: new Date() },
    })
    autoDismissedCount = count
  }

  const pendingCount = await prisma.membreDuplicateMatch.count({
    where: { associationId, status: "PENDING" },
  })

  return { pendingCount, newCount, autoDismissedCount }
}

// ─── Detail view helpers (dashboard + backoffice compare screens) ───────────────────────

export type MembreRelationCounts = Record<string, number>

// Same relation list the merge engine (src/lib/membre-merge.ts) actually reassigns — kept in
// sync manually since the two serve different purposes (a live DB round-trip for display vs.
// a transactional reassignment) and don't share a single source of truth worth the indirection.
export async function countMembreRelations(membreId: string): Promise<MembreRelationCounts> {
  const [
    cotisations, participations, dons, membershipAddonPurchases, automationLogs,
    emailMessages, smsMessages, incomes, materialLoans, boutiqueCommandes,
    actualiteRecipients, sondageRecipients, sondageReponses, meetingParticipants,
    erasureRequests, dependants, hasCotisationSubscription, hasControlAlert,
  ] = await Promise.all([
    prisma.cotisation.count({ where: { membreId } }),
    prisma.participation.count({ where: { membreId } }),
    prisma.don.count({ where: { membreId } }),
    prisma.membershipAddonPurchase.count({ where: { membreId } }),
    prisma.automationLog.count({ where: { membreId } }),
    prisma.emailMessage.count({ where: { membreId } }),
    prisma.smsMessage.count({ where: { membreId } }),
    prisma.income.count({ where: { memberId: membreId } }),
    prisma.materialLoan.count({ where: { membreId } }),
    prisma.boutiqueCommande.count({ where: { membreId } }),
    prisma.actualiteRecipient.count({ where: { membreId } }),
    prisma.sondageRecipient.count({ where: { membreId } }),
    prisma.sondageReponse.count({ where: { membreId } }),
    prisma.meetingParticipant.count({ where: { membreId } }),
    prisma.erasureRequest.count({ where: { membreId } }),
    prisma.membre.count({ where: { responsableId: membreId } }),
    prisma.cotisationSubscription.findUnique({ where: { membreId }, select: { id: true } }),
    prisma.membreControlAlert.findUnique({ where: { membreId }, select: { id: true } }),
  ])
  return {
    cotisations, participations, dons, membershipAddonPurchases, automationLogs,
    emailMessages, smsMessages, incomes, materialLoans, boutiqueCommandes,
    actualiteRecipients, sondageRecipients, sondageReponses, meetingParticipants,
    erasureRequests, dependants,
    cotisationSubscription: hasCotisationSubscription ? 1 : 0,
    controlAlert:           hasControlAlert ? 1 : 0,
  }
}

export type PotentialConflict = { table: string; reason: string }

// Read-only, best-effort preview of what the merge engine's own conflict handling would
// report — lets the compare screen warn before the admin commits to anything. Not
// exhaustive (sondage/meeting/actualite overlaps are rare enough to skip here and are still
// safely handled, just not previewed, by mergeMembres itself).
export async function previewMergeConflicts(membreAId: string, membreBId: string): Promise<PotentialConflict[]> {
  const conflicts: PotentialConflict[] = []

  const [cotisationsA, cotisationsB] = await Promise.all([
    prisma.cotisation.findMany({ where: { membreId: membreAId }, select: { year: true } }),
    prisma.cotisation.findMany({ where: { membreId: membreBId }, select: { year: true } }),
  ])
  const yearsA = new Set(cotisationsA.map(c => c.year))
  const overlappingYears = cotisationsB.map(c => c.year).filter(year => yearsA.has(year))
  for (const year of new Set(overlappingYears)) {
    conflicts.push({ table: "cotisations", reason: `Les deux membres ont une cotisation ${year}` })
  }

  const [subA, subB] = await Promise.all([
    prisma.cotisationSubscription.findUnique({ where: { membreId: membreAId }, select: { id: true } }),
    prisma.cotisationSubscription.findUnique({ where: { membreId: membreBId }, select: { id: true } }),
  ])
  if (subA && subB) conflicts.push({ table: "cotisationSubscription", reason: "Les deux membres ont un abonnement de cotisation actif" })

  const [alertA, alertB] = await Promise.all([
    prisma.membreControlAlert.findUnique({ where: { membreId: membreAId }, select: { id: true } }),
    prisma.membreControlAlert.findUnique({ where: { membreId: membreBId }, select: { id: true } }),
  ])
  if (alertA && alertB) conflicts.push({ table: "controlAlert", reason: "Les deux membres ont une alerte de contrôle active" })

  const [erasureA, erasureB] = await Promise.all([
    prisma.erasureRequest.findFirst({ where: { membreId: membreAId, status: { in: ["REVIEW", "PENDING", "HELD"] } }, select: { id: true } }),
    prisma.erasureRequest.findFirst({ where: { membreId: membreBId, status: { in: ["REVIEW", "PENDING", "HELD"] } }, select: { id: true } }),
  ])
  if (erasureA && erasureB) conflicts.push({ table: "erasureRequest", reason: "Les deux membres ont une demande d'effacement active" })

  return conflicts
}
