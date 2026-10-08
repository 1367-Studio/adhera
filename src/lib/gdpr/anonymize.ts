import { randomBytes } from "crypto"
import { prisma } from "@/lib/prisma/client"
import { deleteFromR2 } from "@/lib/r2"
import { writeActivityLog } from "@/lib/activity-log"

// RGPD Art. 17 — real erasure of a Membre's personal data (security audit H6). Before this,
// the only "delete" (DELETE /api/membres/[id]) just set deletedAt — every personal column
// (name, email, phone, address, health fields, photo…) stayed in the row forever.
//
// This is deliberately a separate action from that existing delete — associations use plain
// delete day-to-day to remove a member without losing history (e.g. someone who may rejoin);
// this one is for an actual Art. 17 request and is irreversible.
//
// Decides per field whether to scrub or keep, rather than leaving any personal column as a
// known gap (see the sibling repo asr-temp's eraseUser for the same discipline). Kept as-is:
// termsAcceptedAt/termsVersion/termsAcceptedIp and imageRightsConsent/imageRightsConsentAt —
// proof of consent, same reasoning already applied to LegalAcceptance in the schema ("the
// proof must not be destroyed by the person who gave it"). Also kept: preferredLocale,
// spokenLanguage, possedeTshirt/tailleTshirt — low-sensitivity attributes that don't identify
// anyone on their own.
//
// Known gap, not yet handled here: Participation and Don snapshot their own copy of the
// member's name/email/phone/address directly on the row (not a join). Scrubbing those needs
// a prior check — some of those rows may already carry an issued fiscal receipt, which French
// tax law can require keeping identified for years, the same reasoning that already protects
// Cotisation/Income. Not guessing that in a destructive operation; follow-up once confirmed.
const ANONYMIZED = "[Anonymisé]"

export async function anonymizeMembre(
  associationId: string,
  membreId:       string,
  actorId:        string | null,
): Promise<{ membreId: string } | null> {
  const membre = await prisma.membre.findFirst({
    where:  { id: membreId, associationId },
    select: { userId: true, photoUrl: true },
  })
  if (!membre) return null

  // Best-effort, outside the transaction below — deleteFromR2 already swallows every error
  // but a real 404 and reports the rest, never throws (src/lib/r2.ts).
  if (membre.photoUrl) await deleteFromR2(membre.photoUrl)

  await prisma.$transaction(async (tx) => {
    await tx.membre.update({
      where: { id: membreId },
      data: {
        firstName: ANONYMIZED,
        lastName:  ANONYMIZED,
        email: null, phone: null, birthDate: null,
        address: null, addressStreet: null, addressComplement: null, postalCode: null, city: null, country: null,
        civilite: null, sexe: null, groupeSanguin: null, allergies: null,
        photoUrl: null, externalId: null, notes: null,
        guardianName: null, guardianPhone: null, secondGuardianName: null, secondGuardianPhone: null,
        cardToken: null, adhesionCompletionToken: null,
        answers:   {},
        // Unconditional set, not "only if still null" — an erasure request is itself a reason
        // the member is gone, and this only ever moves the timestamp forward, never resurrects
        // a deletedAt that was already set by the ordinary delete flow.
        deletedAt: new Date(),
      },
    })

    if (membre.userId) {
      await tx.user.update({
        where: { id: membre.userId },
        data: {
          // Different prefix from the plain-delete flow's `deleted+...` (src/app/api/membres/
          // [id]/route.ts) on purpose — lets anyone reading the table tell an ordinary removal
          // apart from a real RGPD erasure.
          email:           `erased+${membre.userId}@erased.invalid`,
          name:            ANONYMIZED,
          // Random, not null — an unusable value rather than a null that some auth codepath
          // might special-case, same defensive choice asr-temp's eraseUser makes.
          passwordHash:    randomBytes(32).toString("hex"),
          twoFactorSecret: null,
          twoFactorEnabled: false,
          active:          false,
          deletedAt:       new Date(),
        },
      })
    }
  })

  await writeActivityLog({
    associationId,
    actorId,
    action:   "MEMBRE_ANONYMIZED",
    entity:   "Membre",
    entityId: membreId,
  })

  return { membreId }
}
