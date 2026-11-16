import type { PlatformLegalDocumentSlug } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { PLATFORM_LEGAL_DOCUMENTS, type PlatformLegalDocumentDef } from "@/lib/legal/platform-documents"

export class PlatformLegalValidationError extends Error {
  constructor(readonly code: "MISSING" | "STALE", message: string) {
    super(message)
    this.name = "PlatformLegalValidationError"
  }
}

// What this account still owes a confirmation for, against the current version of each of
// the six boxes. Empty for the overwhelming majority of accounts (requiresLegalValidation is
// false), in which case this is a single indexed lookup and nothing else — the DASHBOARD_OFFLINE-
// style cost of this gate is paid only by the handful of flagged accounts.
export async function pendingPlatformValidations(userId: string): Promise<PlatformLegalDocumentDef[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { requiresLegalValidation: true } })
  if (!user?.requiresLegalValidation) return []

  const confirmed = await prisma.platformLegalValidation.findMany({
    where:  { userId },
    select: { documentSlug: true, version: true },
  })
  const confirmedKeys = new Set(confirmed.map(row => `${row.documentSlug}:${row.version}`))

  return PLATFORM_LEGAL_DOCUMENTS.filter(document => !confirmedKeys.has(`${document.slug}:${document.version}`))
}

type SubmittedConfirmation = { slug: PlatformLegalDocumentSlug; version: number }

// Checks what the account says it confirmed against what is actually pending. The client
// sends back the slug+version it was shown rather than a bare "yes" — same reasoning as
// resolveAcceptedRevisions in src/lib/legal/acceptance.ts: if Formwise bumps a document's
// version while this pop-up is open in a stale tab, submitting must not silently register
// agreement to wording never seen. That case is STALE, not a quiet success.
export function resolvePlatformConfirmations(
  pending:    readonly PlatformLegalDocumentDef[],
  submitted:  SubmittedConfirmation[] | undefined,
): PlatformLegalDocumentDef[] {
  if (pending.length === 0) return []

  const submittedKeys = new Set((submitted ?? []).map(item => `${item.slug}:${item.version}`))
  const missing = pending.filter(document => !submittedKeys.has(`${document.slug}:${document.version}`))

  if (missing.length === pending.length && submittedKeys.size === 0) {
    throw new PlatformLegalValidationError("MISSING", "Vous devez cocher les six cases pour continuer.")
  }
  if (missing.length > 0) {
    throw new PlatformLegalValidationError("STALE", "Les documents ont été mis à jour, merci de les relire avant de confirmer.")
  }

  return [...pending]
}

// Writes one row per confirmed document. skipDuplicates guards a double-click/retry from
// throwing on the @@unique([userId, documentSlug, version]) constraint rather than from any
// expectation that this gets called twice in ordinary use.
export async function recordPlatformValidation(input: {
  userId:        string
  associationId: string
  confirmed:     PlatformLegalDocumentDef[]
  ip?:           string | null
}): Promise<void> {
  if (input.confirmed.length === 0) return

  await prisma.platformLegalValidation.createMany({
    data: input.confirmed.map(document => ({
      userId:           input.userId,
      associationId:    input.associationId,
      documentSlug:     document.slug,
      version:          document.version,
      confirmationType: document.confirmationType,
      ip:               input.ip ?? null,
    })),
    skipDuplicates: true,
  })
}
