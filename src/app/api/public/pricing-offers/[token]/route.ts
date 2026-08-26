import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import type { OfferPhase } from "@/lib/pricing-offers"

// Public, unauthenticated lookup used by /register?offer=<token> to render the custom
// phases before the person fills in their info — deliberately returns only `phases`.
// `label` is the staff-only internal note (e.g. a client's real name/negotiation context,
// see PricingOffer.label in schema.prisma) and must never leave this route, since anyone
// holding the link can read this response — same reasoning as never returning
// stripeProductId/createdByUserId here.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  const offer = await prisma.pricingOffer.findUnique({
    where:  { token },
    select: { phases: true, status: true, expiresAt: true },
  })
  if (!offer) return NextResponse.json({ error: "Lien introuvable" }, { status: 404 })

  const expired = offer.status !== "PENDING" || (offer.expiresAt !== null && offer.expiresAt < new Date())
  if (expired) return NextResponse.json({ error: "Ce lien n'est plus valide" }, { status: 410 })

  return NextResponse.json({
    phases: offer.phases as OfferPhase[],
  })
}
