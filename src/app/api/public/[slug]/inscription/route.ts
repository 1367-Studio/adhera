import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { z } from "zod"
import { parseModules } from "@/lib/modules"
import { rateLimit, requestIp } from "@/lib/rate-limit"
import { assertMemberLimit, MemberLimitReachedError, MEMBER_LIMIT_VISITOR_MESSAGE } from "@/lib/plan-limits"
import { CURRENT_TERMS_VERSION, consentIp } from "@/lib/consent"
import { writeActivityLog } from "@/lib/activity-log"

const schema = z.object({
  firstName:     z.string().min(1).max(80),
  lastName:      z.string().min(1).max(80),
  email:         z.string().email().optional().or(z.literal("")),
  phone:         z.string().max(30).optional().or(z.literal("")),
  typeId:        z.string().optional(),
  acceptedTerms: z.literal(true),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  if (!(await rateLimit(`inscription:${requestIp(req)}`, 5, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, sitePublished: true, modules: true },
  })
  if (!assoc || !assoc.sitePublished || !parseModules(assoc.modules).site) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const body   = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { firstName, lastName, email, phone, typeId } = parsed.data
  const acceptedIp = consentIp(req)

  // Prevent duplicate by email
  if (email) {
    const existing = await prisma.membre.findFirst({
      where: { associationId: assoc.id, email, deletedAt: null },
    })
    if (existing) {
      return NextResponse.json({ error: "Cette adresse email est déjà utilisée." }, { status: 409 })
    }
  }

  // Prevent duplicate PENDING by name (no-email path)
  if (!email) {
    const existing = await prisma.membre.findFirst({
      where: { associationId: assoc.id, firstName, lastName, status: "PENDING", deletedAt: null },
    })
    if (existing) {
      return NextResponse.json({ error: "Une demande est déjà en cours pour ce nom." }, { status: 409 })
    }
  }

  if (typeId) {
    const validType = await prisma.membreType.findFirst({
      where: { id: typeId, associationId: assoc.id },
    })
    if (!validType) {
      return NextResponse.json({ error: "Type de membre invalide." }, { status: 422 })
    }
  }

  try {
    await assertMemberLimit(assoc.id)
  } catch (err) {
    if (err instanceof MemberLimitReachedError) return NextResponse.json({ error: MEMBER_LIMIT_VISITOR_MESSAGE }, { status: 422 })
    throw err
  }

  const membre = await prisma.membre.create({
    data: {
      firstName,
      lastName,
      email:           email || null,
      phone:           phone || null,
      status:          "PENDING",
      associationId:   assoc.id,
      typeId:          typeId ?? null,
      termsAcceptedAt: new Date(),
      termsVersion:    CURRENT_TERMS_VERSION,
      termsAcceptedIp: acceptedIp,
    },
  })

  await writeActivityLog({
    associationId: assoc.id, action: "MEMBRE_INSCRIPTION_REQUESTED",
    entity: "Membre", entityId: membre.id, label: `${firstName} ${lastName}`,
  })

  return NextResponse.json({ ok: true }, { status: 201 })
}
