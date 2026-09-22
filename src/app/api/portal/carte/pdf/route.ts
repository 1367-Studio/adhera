import { NextResponse } from "next/server"
import { withPortalAuth } from "@/lib/api-wrapper"
import { memberCardPdfResponse } from "@/lib/member-card/pdf-response"
import { loadPortalHousehold } from "@/lib/member-card/portal-household"

// The printable sheet behind "Télécharger PDF" / "Imprimer" in the member's portal.
//
// `membreId` is optional and only ever a *selection* inside the household the session already
// grants: the list is rebuilt from the session's own Membre through loadPortalHousehold — the
// very function GET /api/portal/carte answers with — and the parameter is matched against it
// rather than trusted. A member naming anyone else (or a member of another association, whom
// the query never returns) gets the same 404 as a card that doesn't exist. Omitting it means
// "my own card": the household is ordered account-holder-first, so [0] is always the caller.
export const GET = withPortalAuth(async (req, ctx) => {
  // Non-null: withPortalAuth's default requireMembre already 404s a session with no Membre.
  const accountHolderId = ctx.membreId!
  const household       = await loadPortalHousehold(ctx.associationId, accountHolderId)

  const requestedMembreId = new URL(req.url).searchParams.get("membreId")
  const target = requestedMembreId
    ? household.find(member => member.id === requestedMembreId)
    : household[0]
  if (!target) return NextResponse.json({ error: "Carte de membre introuvable" }, { status: 404 })

  return memberCardPdfResponse(req, ctx.associationId, target.id)
}, { module: "cotisations" })
