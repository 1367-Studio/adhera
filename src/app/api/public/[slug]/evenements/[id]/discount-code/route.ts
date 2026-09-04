import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { rateLimit, requestIp } from "@/lib/rate-limit"

// Ne mute rien — valide juste le code et renvoie sa définition pour que le client recalcule
// le prix affiché. inscription/route.ts revalide tout depuis zéro (jamais confiance dans ce
// que le client renvoie) avant de facturer quoi que ce soit.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params

  // Une réponse valid:true/false en clair, sans limite, serait un oracle pour deviner des
  // codes par force brute — même limite que upload/route.ts, assez large pour une faute de
  // frappe légitime.
  if (!(await rateLimit(`evenement-discount-code:${requestIp(req)}`, 10, 10 * 60_000))) {
    return NextResponse.json({ valid: false, reason: "NOT_FOUND" }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : ""
  if (!code) return NextResponse.json({ valid: false, reason: "NOT_FOUND" }, { status: 200 })

  const assoc = await prisma.association.findUnique({ where: { slug }, select: { id: true, sitePublished: true } })
  if (!assoc || !assoc.sitePublished) return NextResponse.json({ valid: false, reason: "NOT_FOUND" }, { status: 200 })

  const evenement = await prisma.evenement.findFirst({ where: { id, associationId: assoc.id }, select: { id: true } })
  if (!evenement) return NextResponse.json({ valid: false, reason: "NOT_FOUND" }, { status: 200 })

  const discountCode = await prisma.evenementDiscountCode.findUnique({
    where: { evenementId_code: { evenementId: id, code } },
  })

  const now = new Date()
  if (!discountCode || !discountCode.active) {
    return NextResponse.json({ valid: false, reason: "NOT_FOUND" })
  }
  if (discountCode.startsAt && now < discountCode.startsAt) {
    return NextResponse.json({ valid: false, reason: "NOT_STARTED" })
  }
  if (discountCode.endsAt && now > discountCode.endsAt) {
    return NextResponse.json({ valid: false, reason: "EXPIRED" })
  }
  if (discountCode.maxUses != null && discountCode.usesCount >= discountCode.maxUses) {
    return NextResponse.json({ valid: false, reason: "MAX_USES" })
  }

  return NextResponse.json({
    valid: true, code: discountCode.code, kind: discountCode.kind, value: Number(discountCode.value),
    ticketTypeIds: discountCode.ticketTypeIds,
  })
}
