import { randomBytes } from "crypto"
import type { Prisma } from "@prisma/client"
import { parseModules } from "@/lib/modules"
import { currentCotisationYear } from "@/lib/membre-adherent"

type TxClient = Prisma.TransactionClient

// paymentToken feeds the public "réglez de votre côté" link (/cotisation/[token]) that the
// caller's email can carry — nullable because rows created before the feature (or by other
// paths) don't have one; findPendingCotisation below can return such a row.
export type CreatedDefaultCotisation = { amount: Prisma.Decimal; year: number; paymentToken: string | null }

// Creates a pending (EN_ATTENTE) cotisation for the current year on a freshly created
// Membre, when the association has configured a default amount — lets a new member pay
// it themselves from the portal right away instead of waiting for an admin to create one.
// No-op if the module is off, no default is configured, or a cotisation for this year
// already exists (e.g. portal registration re-linking to a pre-existing Membre record).
// Returns what was created (or null on no-op) so callers can tell the member about it —
// the record itself is silent otherwise; see the notification/email sent by each caller.
export async function maybeCreateDefaultCotisation(
  tx: TxClient,
  membreId: string,
  associationId: string,
  association: { modules: unknown; cotisationDefaultAmount: Prisma.Decimal | number | string | null },
): Promise<CreatedDefaultCotisation | null> {
  if (association.cotisationDefaultAmount == null) return null
  if (!parseModules(association.modules).cotisations) return null

  const year = currentCotisationYear()
  const existing = await tx.cotisation.findUnique({ where: { membreId_year: { membreId, year } } })
  if (existing) return null

  return tx.cotisation.create({
    data: {
      membreId,
      associationId,
      year,
      amount: association.cotisationDefaultAmount,
      status: "EN_ATTENTE",
      // Same 160-bit recipe as Participation.cancelToken — minted eagerly so the caller's
      // invitation email can carry the public payment link without a second write.
      paymentToken: randomBytes(20).toString("hex"),
    },
    select: { amount: true, year: true, paymentToken: true },
  })
}

// Whatever unpaid cotisation a Membre has for the current year right now, whether it was
// just auto-created above or was already sitting there (e.g. an admin manually created one
// before this member ever registered/logged in). Callers use this — not just
// maybeCreateDefaultCotisation's return value — to decide whether to notify the member, so
// a pre-existing pending cotisation isn't silently missed just because this run didn't
// create it itself.
export async function findPendingCotisation(
  tx: TxClient,
  membreId: string,
): Promise<CreatedDefaultCotisation | null> {
  const year = currentCotisationYear()
  return tx.cotisation.findFirst({
    where:  { membreId, year, status: "EN_ATTENTE" },
    select: { amount: true, year: true, paymentToken: true },
  })
}
