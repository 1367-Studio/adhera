import { NextResponse } from "next/server"
import { withPortalAuth } from "@/lib/api-wrapper"
import { loadMemberCardEligibility } from "@/lib/member-card/loader"
import { loadPortalHousehold } from "@/lib/member-card/portal-household"
import { ensureMemberCardToken } from "@/lib/member-card/token"
import { memberCardVerificationUrl } from "@/lib/member-card/url"
import { buildMemberCardViewModel } from "@/lib/member-card/view-model"

// The member's own card plus one per person they are responsible for (a parent seeing their
// children's cards is the whole reason this returns a list). Who that household is comes from
// loadPortalHousehold, shared with the PDF route so the two can't drift on who a member may
// see; no membreId is ever accepted from the client here.
//
// Each entry carries either a printable card or the reason there is none, so the portal page
// renders the right explanation without re-deriving eligibility client-side. Shape mirrored
// by PortalMemberCardEntry in src/hooks/use-portal-member-cards.ts.
// Module-gated like its own PDF sibling and the page's layout: a card only ever exists on top
// of a cotisation, so an association that turned cotisations off has no card to answer with.
export const GET = withPortalAuth(async (_req, ctx) => {
  // Non-null: withPortalAuth's default requireMembre already 404s a session with no Membre.
  const accountHolderId  = ctx.membreId!
  const orderedHousehold = await loadPortalHousehold(ctx.associationId, accountHolderId)

  // One loader call per person: a household is a handful of people, and the loader has no
  // batch form (it reads the member, their cotisations and the association in a single
  // query). Run concurrently rather than in a loop so the page waits for one round-trip's
  // worth of latency instead of one per dependant.
  const entries = await Promise.all(orderedHousehold.map(async member => {
    const loaded = await loadMemberCardEligibility(ctx.associationId, member.id)
    // Only if the member disappeared between the two queries — dropping them is truer than
    // inventing an eligibility state for someone who no longer exists.
    if (!loaded) return null

    const { eligibility } = loaded

    // A token is minted only for a state that can actually be printed. Minting on sight would
    // hand every unpaid member a permanent public URL pointing at them, for a card they were
    // never shown.
    let card = null
    if (eligibility.state === "valid" || eligibility.state === "expired") {
      const cardToken = await ensureMemberCardToken(ctx.associationId, member.id)
      card = cardToken ? buildMemberCardViewModel(loaded, memberCardVerificationUrl(cardToken)) : null
    }

    return {
      membreId:    member.id,
      firstName:   member.firstName,
      // The switcher labels people by first name and only disambiguates two identical ones
      // with a last-name initial, which it cannot do from a pre-assembled full name.
      lastName:    member.lastName,
      displayName: `${member.firstName} ${member.lastName}`,
      card,
      // Spread rather than re-listed field by field: the state, its reason, its cotisationId
      // and its dates are exactly MemberCardEligibility's own union, so the wire shape cannot
      // drift from it (Dates become ISO strings through JSON, the client parses them back).
      ...eligibility,
    }
  }))

  return NextResponse.json(entries.filter(entry => entry !== null))
}, { module: "cotisations" })
