import { withAdminAuth } from "@/lib/api-wrapper"
import { memberCardPdfResponse } from "@/lib/member-card/pdf-response"

// Same area as GET /api/membres/[id]/carte.

// The printable sheet behind "Télécharger PDF" / "Imprimer" in the manager's card modal —
// the same document the member gets from their own portal, so a card handed out at the desk
// and one printed at home are the same card. Scoped by associationId inside the response
// helper's loader.
export const GET = withAdminAuth<{ id: string }>(
  (req, ctx, { id }) => memberCardPdfResponse(req, ctx.associationId, id),
  { area: "membres", module: "cotisations" },
)
