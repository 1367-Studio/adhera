import { randomBytes } from "crypto"
import { prisma } from "@/lib/prisma/client"

// 16 random bytes in base64url = exactly 22 URL-safe characters, no padding. 128 bits is
// far past guessable, and — unlike the 40-char hex of Cotisation.paymentToken — keeps the
// URL encoded in the card's QR short, so the code stays low-density and scans reliably
// off a phone screen. Used to reject malformed tokens before any DB lookup.
export const MEMBER_CARD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/

function generateMemberCardToken(): string {
  return randomBytes(16).toString("base64url")
}

// Returns the member's card token, minting it on first use (see Membre.cardToken for why it
// is lazy). null when no such member exists in this association — every query is scoped by
// associationId, so a membreId from another tenant never gets (or reveals) a token.
//
// Race-safe without a transaction: two first views arriving together both see null, but the
// write only applies `where cardToken is null` — Postgres re-checks that condition once the
// first writer's row lock is released, so the second update matches nothing — and both then
// re-read and return the single token that won, never two different QR codes.
//
// Only issues an identifier: whether the card is valid is decided live by
// getMemberCardEligibility, and callers are expected to check the association has the card
// enabled before showing (and so minting) one.
export async function ensureMemberCardToken(associationId: string, membreId: string): Promise<string | null> {
  const membre = await prisma.membre.findFirst({
    where:  { id: membreId, associationId },
    select: { cardToken: true },
  })
  if (!membre) return null
  if (membre.cardToken) return membre.cardToken

  await prisma.membre.updateMany({
    where: { id: membreId, associationId, cardToken: null },
    data:  { cardToken: generateMemberCardToken() },
  })
  const claimed = await prisma.membre.findFirst({
    where:  { id: membreId, associationId },
    select: { cardToken: true },
  })
  return claimed?.cardToken ?? null
}

// Revokes the member's current card by replacing its token outright — there is no "revoked"
// flag to check, the old token just stops matching any Membre, so every copy of the old QR
// (printed, screenshotted, forwarded) dies at once while the member immediately gets a new
// working one. cardTokenRotatedAt records when, for the manager UI and support. Returns the
// new token, or null when no such member exists in this association.
export async function rotateMemberCardToken(associationId: string, membreId: string): Promise<string | null> {
  const newToken = generateMemberCardToken()
  const { count } = await prisma.membre.updateMany({
    where: { id: membreId, associationId },
    data:  { cardToken: newToken, cardTokenRotatedAt: new Date() },
  })
  return count > 0 ? newToken : null
}
