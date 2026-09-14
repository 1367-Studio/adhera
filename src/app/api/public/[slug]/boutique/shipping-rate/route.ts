import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { rateLimit, requestIp } from "@/lib/rate-limit"
import { getShippingRates, applyShippingMarkup } from "@/lib/boutique/shipping-rate"

const schema = z.object({
  items: z.array(z.object({
    varianteId: z.string(),
    quantity:   z.number().int().min(1).max(99),
  })).min(1).max(50),
  destPostalCode: z.string().trim().min(1).max(12),
  destCountry:    z.string().trim().length(2),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  if (!(await rateLimit(`boutique-shipping-rate:${requestIp(req)}`, 20, 10 * 60_000)))
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, modules: true, shippingCountry: true, shippingPostalCode: true, shippingMarkupPercent: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const modules = parseModules(assoc.modules)
  if (!modules.boutique) return NextResponse.json({ error: "Module boutique désactivé" }, { status: 403 })

  if (!assoc.shippingCountry || !assoc.shippingPostalCode)
    return NextResponse.json({ options: [] })

  const { items, destPostalCode, destCountry } = parsed.data

  const variantes = await prisma.boutiqueVariante.findMany({
    where:   { id: { in: items.map(i => i.varianteId) }, produit: { associationId: assoc.id } },
    select:  { id: true, shippable: true, weightGrams: true },
  })
  const varianteMap = new Map(variantes.map(v => [v.id, v]))

  let weightGrams = 0
  for (const item of items) {
    const v = varianteMap.get(item.varianteId)
    if (!v || !v.shippable || !v.weightGrams) return NextResponse.json({ options: [] })
    weightGrams += v.weightGrams * item.quantity
  }

  const options = await getShippingRates({
    originCountry:     assoc.shippingCountry,
    originPostalCode:  assoc.shippingPostalCode,
    destCountry,
    destPostalCode,
    weightGrams,
  })

  return NextResponse.json({ options: applyShippingMarkup(options, assoc.shippingMarkupPercent) })
}
