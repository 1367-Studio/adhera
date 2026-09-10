import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const ADMINS = ["ADMIN", "PRESIDENT"]

const schema = z.object({
  shippingAddress:    z.string().trim().max(300).optional().or(z.literal("")),
  shippingCity:       z.string().trim().max(100).optional().or(z.literal("")),
  shippingPostalCode: z.string().trim().max(12).optional().or(z.literal("")),
  // ISO 3166-1 alpha-2 — validated at the shape level, the Sendcloud call itself is the
  // real authority on whether the code is actually usable.
  shippingCountry:    z.string().trim().length(2).optional().or(z.literal("")),
})

export const GET = withAdminAuth(async (req, ctx) => {
  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { shippingAddress: true, shippingCity: true, shippingPostalCode: true, shippingCountry: true },
  })
  if (!assoc) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json(assoc)
})

export const PATCH = withAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { shippingAddress, shippingCity, shippingPostalCode, shippingCountry } = parsed.data

  await prisma.association.update({
    where: { id: ctx.associationId },
    data: {
      ...(shippingAddress    !== undefined ? { shippingAddress:    shippingAddress || null }              : {}),
      ...(shippingCity       !== undefined ? { shippingCity:       shippingCity || null }                 : {}),
      ...(shippingPostalCode !== undefined ? { shippingPostalCode: shippingPostalCode || null }            : {}),
      ...(shippingCountry    !== undefined ? { shippingCountry:    shippingCountry.toUpperCase() || null } : {}),
    },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "ASSOCIATION_UPDATED",
    entity:        "Association",
    label:         "Adresse de livraison",
  })

  return NextResponse.json({ ok: true })
}, { roles: ADMINS })
