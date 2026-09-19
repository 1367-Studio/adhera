import type { Prisma } from "@prisma/client"

// The fields a revision is cut from. Callers pass the document as it stands after their write.
type DocumentSnapshot = {
  id:                 string
  title:              string
  content:            string
  requiresAcceptance: boolean
}

export type DocumentRevision = {
  id:      string
  version: number
  title:   string
  content: string
}

const REVISION_SELECT = { id: true, version: true, title: true, content: true } as const

// Freezes the wording currently in force, so a LegalAcceptance can point at text that will
// still exist after the manager edits the document again.
//
// Called from inside the write transaction of every create/update of an AssociationDocument:
//   - document does not require acceptance → nothing to freeze, returns null
//   - wording unchanged since the last revision → that revision stays in force
//   - anything else (first time, edited text, acceptance just switched on) → a new version
//
// Two concurrent edits racing here both compute the same next version and one hits the
// (documentId, version) unique index. That is the intended outcome: the loser's PATCH fails
// rather than two different texts quietly sharing a version number.
export async function syncDocumentRevision(
  tx:       Prisma.TransactionClient,
  document: DocumentSnapshot,
): Promise<DocumentRevision | null> {
  if (!document.requiresAcceptance) return null

  const latest = await tx.associationDocumentRevision.findFirst({
    where:   { documentId: document.id },
    orderBy: { version: "desc" },
    select:  REVISION_SELECT,
  })

  if (latest && latest.title === document.title && latest.content === document.content) return latest

  return tx.associationDocumentRevision.create({
    data: {
      documentId: document.id,
      version:    (latest?.version ?? 0) + 1,
      title:      document.title,
      content:    document.content,
    },
    select: REVISION_SELECT,
  })
}
