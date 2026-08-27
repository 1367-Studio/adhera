import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"
import { createOfferProduct, validateOfferPhases } from "@/lib/pricing-offers"

const phaseSchema = z.object({
  amountCents: z.number().int().positive(),
  months:      z.number().int().positive().nullable(),
})

const postSchema = z.object({
  label:     z.string().min(1).max(120),
  planTier:  z.enum(["ESSENTIAL", "PRO"]),
  phases:    z.array(phaseSchema).min(1),
  expiresAt: z.string().datetime().optional(),
})

export const POST = withSuperAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const { label, planTier, phases, expiresAt } = parsed.data
  if (!validateOfferPhases(phases)) {
    return NextResponse.json({ error: "Seule la dernière phase peut être « récurrente sans fin »." }, { status: 422 })
  }

  const stripeProductId = await createOfferProduct(label)
  const token           = randomBytes(24).toString("base64url")

  const offer = await prisma.pricingOffer.create({
    data: {
      token,
      label,
      planTier,
      phases,
      stripeProductId,
      expiresAt:       expiresAt ? new Date(expiresAt) : null,
      createdByUserId: ctx.userId,
    },
  })

  return NextResponse.json({ id: offer.id, token: offer.token })
})

export const GET = withSuperAdminAuth(async () => {
  const offers = await prisma.pricingOffer.findMany({
    orderBy: { createdAt: "desc" },
    include: { association: { select: { name: true, slug: true } } },
  })
  return NextResponse.json({ offers })
})
