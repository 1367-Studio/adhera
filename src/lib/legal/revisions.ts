import type { Prisma } from "@prisma/client"

// The fields a revision is cut from. Callers pass the document as it stands after their write.
type DocumentSnapshot = {
  id:                 string
  title:              string
  content:            string
  fileUrl:            string | null
  fileName:           string | null
  requiresAcceptance: boolean
}

export type DocumentRevision = {
  id:       string
  version:  number
  title:    string
  content:  string
  fileUrl:  string | null
  fileName: string | null
}

const REVISION_SELECT = { id: true, version: true, title: true, content: true, fileUrl: true, fileName: true } as const

// A revision's PDF lives in R2, not in this table — so R2 objects of legal documents are never
// deleted, whether the PDF is replaced, removed, or the document soft-deleted. An accepted
// revision may still point at the old file, and that file is the evidence of what was agreed to.

// Freezes the wording currently in force, so a LegalAcceptance can point at text that will
// still exist after the manager edits the document again.
//
// Called from inside the write transaction of every create/update of an AssociationDocument:
//   - document does not require acceptance → nothing to freeze, returns null
//   - wording unchanged since the last revision → that revision stays in force
//   - anything else (first time, edited text, new/removed PDF, acceptance just switched on)
//     → a new version. A renamed PDF alone (same fileUrl) is not a new wording.
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

  const wordingUnchanged = latest !== null
    && latest.title   === document.title
    && latest.content === document.content
    && latest.fileUrl === document.fileUrl
  if (wordingUnchanged) return latest

  return tx.associationDocumentRevision.create({
    data: {
      documentId: document.id,
      version:    (latest?.version ?? 0) + 1,
      title:      document.title,
      content:    document.content,
      fileUrl:    document.fileUrl,
      fileName:   document.fileName,
    },
    select: REVISION_SELECT,
  })
}
