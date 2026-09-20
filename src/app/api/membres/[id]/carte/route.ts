import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { loadMemberCardEligibility } from "@/lib/member-card/loader"
import { ensureMemberCardToken } from "@/lib/member-card/token"
import { memberCardVerificationUrl } from "@/lib/member-card/url"
import { buildMemberCardViewModel } from "@/lib/member-card/view-model"

// Spelled out rather than left to withAdminAuth's default: without a roles allowlist the
// wrapper only resolves the session's association, so a MEMBRE portal account (which has an
// associationId like everyone else) would reach this route and could read any member of the
// association's card. The manager set is the same one create-access and resend-payment-link
// use.
const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

// The card a manager sees in the members list / member sheet. Returns the eligibility state
// alongside the card so the modal can explain *why* there is nothing to show (an unpaid
// cotisation reads very differently from a suspended member) instead of falling back to a
// single generic message.
export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  // Scoped by associationId inside the loader — a membreId from another tenant comes back
  // null and is answered exactly like a membreId that doesn't exist at all.
  const loaded = await loadMemberCardEligibility(associationId, id)
  if (!loaded) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const { eligibility } = loaded
  const hasPrintableCard = eligibility.state === "valid" || eligibility.state === "expired"

  // Minting is deliberately tied to the states that actually print a card: a manager opening
  // the sheet of a member who never paid must not silently create a QR identity for them.
  const cardToken = hasPrintableCard ? await ensureMemberCardToken(associationId, id) : null
  const card      = cardToken ? buildMemberCardViewModel(loaded, memberCardVerificationUrl(cardToken)) : null

  // For "unavailable" the manager's next action is recording the payment that unlocks the
  // card, so the balance the payment modal needs travels with the answer rather than costing
  // the client a second round trip to the full member record.
  let pendingCotisation: { id: string; remaining: number } | null = null
  if (eligibility.state === "unavailable") {
    const cotisation = await prisma.cotisation.findFirst({
      where:  { id: eligibility.cotisationId, associationId },
      select: { id: true, amount: true, amountPaid: true },
    })
    if (cotisation) {
      pendingCotisation = { id: cotisation.id, remaining: Number(cotisation.amount) - Number(cotisation.amountPaid) }
    }
  }

  // The eligibility is spread as-is — same discriminated union the portal's own card route
  // answers with, so both surfaces narrow on `state` the same way instead of each inventing
  // a flattened shape.
  return NextResponse.json({
    ...eligibility,
    card,
    pendingCotisation,
  })
}, { roles: MANAGERS, module: "cotisations" })
