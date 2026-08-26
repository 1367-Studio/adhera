import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"

// Revokes an unused offer link — the only lifecycle action available here. Redeemed
// offers (status USED) are permanent records of what an association is actually billed
// on and can't be revoked after the fact.
export const PATCH = withSuperAdminAuth<{ id: string }>(async (_req, _ctx, { id }) => {
  const { count } = await prisma.pricingOffer.updateMany({
    where: { id, status: "PENDING" },
    data:  { status: "REVOKED" },
  })
  if (count === 0) return NextResponse.json({ error: "Offre introuvable ou déjà utilisée" }, { status: 409 })

  return NextResponse.json({ ok: true })
})
