import { withAdminAuth } from "@/lib/api-wrapper"
import { memberCardPdfResponse } from "@/lib/member-card/pdf-response"

// Spelled out rather than left to withAdminAuth's default, and identical to the allowlist on
// GET /api/membres/[id]/carte: without one the wrapper only resolves the session's
// association, so a MEMBRE portal account (which has an associationId like everyone else)
// could download any member of the association's card.
const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

// The printable sheet behind "Télécharger PDF" / "Imprimer" in the manager's card modal —
// the same document the member gets from their own portal, so a card handed out at the desk
// and one printed at home are the same card. Scoped by associationId inside the response
// helper's loader.
export const GET = withAdminAuth<{ id: string }>(
  (req, ctx, { id }) => memberCardPdfResponse(req, ctx.associationId, id),
  { roles: MANAGERS, module: "cotisations" },
)
