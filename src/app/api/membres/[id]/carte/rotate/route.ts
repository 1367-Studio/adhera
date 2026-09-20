import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { loadMemberCardEligibility } from "@/lib/member-card/loader"
import { rotateMemberCardToken } from "@/lib/member-card/token"

// Narrower than the read route's manager set, and matched on the roles that administer the
// members themselves (create-access, role changes): revoking a card is an identity action,
// not a finance one, and a Trésorier has no reason to invalidate a printed member card.
// Spelled out rather than omitted for the same reason as in ../route.ts — without a roles
// allowlist a MEMBRE portal session would reach this handler.
const MEMBER_ADMINS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

// Replaces the member's card token, which kills every existing copy of their QR code at once
// (see rotateMemberCardToken) — the way out when a card has been lost, screenshotted or
// forwarded. Answers `ok` only: the client refetches GET ../carte, so the new QR is rendered
// from the same single source of truth as the original one.
export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  // Read first, for the log's label and so a member of another association gets the same 404
  // as a membreId that matches nobody (the loader is scoped by associationId).
  const loaded = await loadMemberCardEligibility(associationId, id)
  if (!loaded) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  // Same two states the PDF routes print (see pdf-response.ts), for the same reason: rotating
  // mints a token unconditionally, so a member who never had a card — never paid, suspended,
  // cancelled, or an association that turned the card off — would end up with a permanent
  // public URL pointing at them for a card nobody was ever shown. 409, not 404: the request is
  // well-formed and the member exists, it is the card that doesn't.
  const { eligibility, membre } = loaded
  if (eligibility.state !== "valid" && eligibility.state !== "expired") {
    return NextResponse.json({ error: "Aucune carte de membre à régénérer" }, { status: 409 })
  }

  const rotatedToken = await rotateMemberCardToken(associationId, id)
  if (!rotatedToken) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  // The token itself is deliberately kept out of the metadata: an activity log is readable by
  // every manager, and it would be a permanent record of a credential that is supposed to
  // live only in the member's own QR code.
  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "MEMBRE_CARD_TOKEN_ROTATED",
    entity:   "Membre",
    entityId: id,
    label:    `${membre.firstName} ${membre.lastName}`,
  })

  return NextResponse.json({ ok: true })
}, { roles: MEMBER_ADMINS, module: "cotisations" })
