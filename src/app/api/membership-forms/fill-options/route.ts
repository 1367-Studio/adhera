import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

// Same role set as POST /api/membres — this feeds the "Ajouter → via un formulaire
// d'adhésion" dropdown on the Membres page (see membres-view.tsx), so whoever can create a
// member must see the choices (notably SECRETAIRE, excluded from the FINANCE-gated
// /api/membership-forms GET).
const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

// Published forms a manager can fill on a member's behalf (mode admin — see
// membership-form-public-form.tsx's isAdminFill): only forms with at least one tier the
// emailed payment link can charge (one-off, paid, adhésion) qualify — on a form without
// any, the admin-mode tier picker would be empty.
export const GET = withAdminAuth(async (_req, ctx) => {
  const forms = await prisma.membershipForm.findMany({
    where: {
      associationId: ctx.associationId,
      status:        "PUBLISHED",
      tiers:         { some: { itemType: "MEMBERSHIP", kind: "ONE_OFF", free: false } },
    },
    orderBy: { createdAt: "desc" },
    select:  { id: true, title: true, slug: true },
  })
  return NextResponse.json({ forms })
}, { roles: MANAGERS, module: "cotisations" })
