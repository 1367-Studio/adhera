import type { LegalAcceptanceContext, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"

// What a form has to show and get agreement on: one entry per document the association flagged
// "must be accepted", carrying the revision in force right now.
export type RequiredDocument = {
  documentId: string
  revisionId: string
  version:    number
  title:      string
}

// Who is agreeing. A boutique visitor has no account and no Membre row, so an email alone is a
// valid identity — but never nothing, or the record proves nothing about anyone.
export type AcceptanceIdentity = {
  userId?:     string | null
  membreId?:   string | null
  guestEmail?: string | null
}

export class LegalConsentError extends Error {
  constructor(readonly code: "MISSING" | "STALE", message: string) {
    super(message)
    this.name = "LegalConsentError"
  }
}

// The documents an association currently requires agreement to, newest wording each.
//
// A flagged document always has a revision: syncDocumentRevision writes one inside the same
// transaction as the write that flagged it. One without a revision would be unenforceable, so
// it is dropped here rather than silently rendered as an un-acceptable checkbox.
export async function requiredDocuments(
  associationId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<RequiredDocument[]> {
  const documents = await client.associationDocument.findMany({
    where:   { associationId, deletedAt: null, requiresAcceptance: true },
    orderBy: { title: "asc" },
    select:  {
      id:        true,
      title:     true,
      revisions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true } },
    },
  })

  return documents.flatMap(document => {
    const [current] = document.revisions
    if (!current) return []
    return [{ documentId: document.id, revisionId: current.id, version: current.version, title: document.title }]
  })
}

// Checks what the visitor agreed to against what is actually required, and hands back the
// revision ids to record.
//
// The form sends the revision ids it displayed rather than a bare "yes", so that a page left
// open while the association rewrites its terms cannot silently register agreement to wording
// the visitor never saw: that case is a STALE error the caller turns into "the terms changed,
// please read them again", not a quiet acceptance of the new text.
export function resolveAcceptedRevisions(
  required:      RequiredDocument[],
  submittedIds:  string[] | undefined,
): string[] {
  if (required.length === 0) return []

  const submitted = new Set(submittedIds ?? [])
  const missing   = required.filter(document => !submitted.has(document.revisionId))
  if (missing.length === required.length && submitted.size === 0) {
    throw new LegalConsentError("MISSING", "Vous devez accepter les documents de l'association pour continuer.")
  }
  if (missing.length > 0) {
    throw new LegalConsentError("STALE", "Les documents de l'association ont été mis à jour, merci de les relire avant de continuer.")
  }

  return required.map(document => document.revisionId)
}

// What a member still owes agreement to: the required documents whose wording in force they
// have not accepted. Empty when the association requires nothing, or when they are up to date.
//
// `email` matters as much as the ids. Someone who joined through the public adhesion form had
// their agreement recorded against the email they typed — there was no account yet — so
// matching on userId/membreId alone would ask them to accept again something they already
// accepted, every time they log in.
export async function pendingLegalDocuments(
  associationId: string,
  identity: { userId?: string | null; membreId?: string | null; email?: string | null },
): Promise<RequiredDocument[]> {
  const required = await requiredDocuments(associationId)
  if (required.length === 0) return []

  const identityMatches = [
    ...(identity.userId   ? [{ userId:     identity.userId }]                 : []),
    ...(identity.membreId ? [{ membreId:   identity.membreId }]               : []),
    ...(identity.email    ? [{ guestEmail: identity.email.toLowerCase() }]    : []),
  ]
  // No way to identify the person: nothing can be shown as already accepted.
  if (identityMatches.length === 0) return required

  const accepted = await prisma.legalAcceptance.findMany({
    where:  { associationId, revisionId: { in: required.map(document => document.revisionId) }, OR: identityMatches },
    select: { revisionId: true },
  })
  const acceptedRevisionIds = new Set(accepted.map(acceptance => acceptance.revisionId))

  return required.filter(document => !acceptedRevisionIds.has(document.revisionId))
}

// Validate-and-record in one call — what a public checkout route wants: it either records the
// agreement or throws LegalConsentError for the caller to turn into a 422. Kept as one
// function so no flow can accidentally record without checking, or check without recording.
export async function acceptLegalDocuments(
  input: Omit<RecordInput, "revisionIds"> & { submittedRevisionIds?: string[] },
): Promise<void> {
  const { submittedRevisionIds, ...rest } = input
  const required    = await requiredDocuments(rest.associationId)
  const revisionIds = resolveAcceptedRevisions(required, submittedRevisionIds)
  await recordAcceptances({ ...rest, revisionIds })
}

type RecordInput = {
  associationId: string
  revisionIds:   string[]
  identity:      AcceptanceIdentity
  context:       LegalAcceptanceContext
  contextId?:    string | null
  ip?:           string | null
  // DASHBOARD_OFFLINE only: the manager asserting they collected the agreement in person.
  collectedById?: string | null
}

// Writes one row per document agreed to. Append-only: agreeing to a new revision later adds
// rows, it never rewrites these.
export async function recordAcceptances(
  { associationId, revisionIds, identity, context, contextId, ip, collectedById }: RecordInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  if (revisionIds.length === 0) return

  await client.legalAcceptance.createMany({
    data: revisionIds.map(revisionId => ({
      associationId,
      revisionId,
      userId:     identity.userId     ?? null,
      membreId:   identity.membreId   ?? null,
      guestEmail: identity.guestEmail ?? null,
      context,
      contextId:  contextId ?? null,
      ip:         ip ?? null,
      collectedById: collectedById ?? null,
    })),
  })
}
