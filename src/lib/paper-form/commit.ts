import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { maybeCreateDefaultCotisation } from "@/lib/cotisation-defaults"
import {
  announceMembreCreated,
  membreColumns,
  recordOfflineAcceptances,
  type MembreCreationAssociation,
} from "@/lib/membres/create-membre"
import type { PaperFormCommitResult, ParsedPaperFormCommitForm } from "@/lib/schemas"

// Documents ticked on a sheet → the revision to record acceptance against, or null when the
// document no longer requires acceptance (no wording in force to point at — same rule as
// requiredDocuments in src/lib/legal/acceptance.ts). `unknownDocument` is true as soon as one
// id is not a live document of this association.
export async function resolveTickedDocumentRevisions(
  associationId: string,
  documentIds: string[],
): Promise<{ unknownDocument: boolean; revisionIdByDocumentId: Map<string, string | null> }> {
  const uniqueDocumentIds = [...new Set(documentIds)]
  const revisionIdByDocumentId = new Map<string, string | null>()
  if (uniqueDocumentIds.length === 0) return { unknownDocument: false, revisionIdByDocumentId }

  const documents = await prisma.associationDocument.findMany({
    where:  { id: { in: uniqueDocumentIds }, associationId, deletedAt: null },
    select: {
      id:                 true,
      requiresAcceptance: true,
      revisions:          { orderBy: { version: "desc" }, take: 1, select: { id: true } },
    },
  })
  for (const document of documents) {
    const [currentRevision] = document.revisions
    revisionIdByDocumentId.set(document.id, document.requiresAcceptance && currentRevision ? currentRevision.id : null)
  }
  return { unknownDocument: documents.length !== uniqueDocumentIds.length, revisionIdByDocumentId }
}

type CommitContext = {
  associationId:          string
  actorId:                string
  association:            MembreCreationAssociation | null
  revisionIdByDocumentId: Map<string, string | null>
}

// Creates one scanned sheet's member — the student only — in a transaction of its own, so
// one bad sheet never rolls back the others: student (parents written on their record) →
// notes, image rights, default cotisation → the offline acceptances of the ticked documents.
export async function commitPaperForm(form: ParsedPaperFormCommitForm, context: CommitContext): Promise<PaperFormCommitResult> {
  const { associationId, actorId, association, revisionIdByDocumentId } = context

  const tickedDocumentIds       = [...new Set(form.acceptedLegalDocumentIds)]
  const revisionIds             = tickedDocumentIds.flatMap((documentId) => revisionIdByDocumentId.get(documentId) ?? [])
  const skippedLegalDocumentIds = tickedDocumentIds.filter((documentId) => !revisionIdByDocumentId.get(documentId))

  let createdStudent: Awaited<ReturnType<typeof createSheetStudent>>
  try {
    createdStudent = await prisma.$transaction((tx) => createSheetStudent(tx, form, { associationId, actorId, association, revisionIds }))
  } catch (error) {
    console.error(`[membres/scan/commit] failed to create sheet ${form.ref}:`, error)
    return { ref: form.ref, status: "error", error: "Erreur lors de la création de cette fiche" }
  }

  // Same trail as a manual add: one MEMBRE_CREATED entry (and automation).
  await announceMembreCreated({ associationId, actorId, association, membre: createdStudent, fireMemberCreatedRule: true, metadata: { source: "PAPER_FORM" } })

  return {
    ref:      form.ref,
    status:   "created",
    membreId: createdStudent.id,
    skippedLegalDocumentIds,
  }
}

async function createSheetStudent(
  tx: Prisma.TransactionClient,
  form: ParsedPaperFormCommitForm,
  sheet: {
    associationId: string
    actorId:       string
    association:   MembreCreationAssociation | null
    revisionIds:   string[]
  },
) {
  const { associationId, actorId, association, revisionIds } = sheet

  const { student, guardian, secondGuardian } = form
  const createdStudent = await tx.membre.create({
    data: {
      ...membreColumns(associationId, {
        email:               student.email,
        phone:               student.phone,
        birthDate:           student.birthDate,
        civilite:            student.civilite,
        sexe:                student.sexe,
        addressStreet:       student.addressStreet,
        addressComplement:   student.addressComplement,
        postalCode:          student.postalCode,
        city:                student.city,
        country:             student.country,
        // The parents stay text on the student's record (see Membre.guardianName) — never
        // members of their own, never a responsableId.
        guardianName:        guardian?.name,
        guardianPhone:       guardian?.phone,
        secondGuardianName:  secondGuardian?.name,
        secondGuardianPhone: secondGuardian?.phone,
      }),
      firstName: student.firstName,
      lastName:  student.lastName,
      status:    "ACTIF",
      notes:     form.notes,
      // Only an explicit answer on the sheet is recorded; an absent or unreadable box stays
      // null ("never asked"), see Membre.imageRightsConsent.
      ...(form.imageRights !== null ? { imageRightsConsent: form.imageRights, imageRightsConsentAt: new Date() } : {}),
    },
  })

  if (association) await maybeCreateDefaultCotisation(tx, createdStudent.id, associationId, association)

  await recordOfflineAcceptances({ associationId, revisionIds, membre: createdStudent, collectedById: actorId }, tx)

  return createdStudent
}
