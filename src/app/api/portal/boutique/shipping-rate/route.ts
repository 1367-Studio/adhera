import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"
import { getShippingRates } from "@/lib/boutique/shipping-rate"

const schema = z.object({
  items: z.array(z.object({
    varianteId: z.string(),
    quantity:   z.number().int().min(1).max(99),
  })).min(1).max(50),
  destPostalCode: z.string().trim().min(1).max(12),
  destCountry:    z.string().trim().length(2),
})

export const POST = withPortalAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { shippingCountry: true, shippingPostalCode: true },
  })
  if (!assoc?.shippingCountry || !assoc.shippingPostalCode)
    return NextResponse.json({ options: [] })

  const { items, destPostalCode, destCountry } = parsed.data

  const variantes = await prisma.boutiqueVariante.findMany({
    where:  { id: { in: items.map(i => i.varianteId) }, produit: { associationId: ctx.associationId } },
    select: { id: true, shippable: true, weightGrams: true },
  })
  const varianteMap = new Map(variantes.map(v => [v.id, v]))

  let weightGrams = 0
  for (const item of items) {
    const v = varianteMap.get(item.varianteId)
    if (!v || !v.shippable || !v.weightGrams) return NextResponse.json({ options: [] })
    weightGrams += v.weightGrams * item.quantity
  }

  const options = await getShippingRates({
    originCountry:    assoc.shippingCountry,
    originPostalCode: assoc.shippingPostalCode,
    destCountry,
    destPostalCode,
    weightGrams,
  })

  return NextResponse.json({ options })
}, { module: "boutique" })
