import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { rateLimit, requestIp } from "@/lib/rate-limit"

// Tells the public membership form, while the visitor is still typing, that this address
// already has an adhésion — so they get "log in instead" rather than filling the whole form
// and hitting the 409 the checkout route already raises at submit
// (see checkout/route.ts's "Cette adresse email est déjà utilisée").
//
// Scope is deliberately email-only. Name and phone are matched too, but server-side and
// after the fact, reported to the staff alone (see lib/membre-duplicates.ts): answering
// "is <name> a member?" on an endpoint anyone holding the form link can call would turn it
// into a queryable directory of the association's membership. Email discloses nothing the
// submit-time 409 doesn't already, and a visitor can learn the same thing from any password
// reset form.
//
// Returns a bare boolean — never the member's name, id or anything else about them.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; formSlug: string }> },
) {
  const { slug, formSlug } = await params

  // Slower than the checkout limiter (5 / 10 min) because this one is meant to be called
  // repeatedly while typing, but still bounded: it is the one endpoint here that answers a
  // yes/no question about a given address, so it must not be cheap to iterate over a list.
  if (!(await rateLimit(`adhesion-check-email:${requestIp(req)}`, 30, 10 * 60_000)))
    return NextResponse.json({ error: "Trop de tentatives" }, { status: 429 })

  const email = new URL(req.url).searchParams.get("email")?.trim().toLowerCase()
  if (!email || email.length > 200) return NextResponse.json({ exists: false })

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, modules: true },
  })
  if (!assoc || !parseModules(assoc.modules).cotisations) return NextResponse.json({ exists: false })

  // The form must be a real, published one for this association — otherwise the endpoint
  // would answer for any association by slug alone, without even a valid form link.
  const form = await prisma.membershipForm.findFirst({
    where:  { slug: formSlug, associationId: assoc.id, status: "PUBLISHED", visibility: { not: "PRIVATE" } },
    select: { id: true },
  })
  if (!form) return NextResponse.json({ exists: false })

  // Mirrors the checkout route's own guard so the warning and the eventual 409 can never
  // disagree: same association, same soft-delete scope, same case-insensitive comparison.
  const existing = await prisma.membre.findFirst({
    where:  { associationId: assoc.id, deletedAt: null, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  })
  return NextResponse.json({ exists: !!existing })
}
