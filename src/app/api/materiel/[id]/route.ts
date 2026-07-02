import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const ALLOWED = ["ADMIN", "PRESIDENT", "SECRETAIRE", "TRESORIER"]

const schema = z.object({
  name:          z.string().min(1).max(150).optional(),
  category:      z.string().max(80).optional().nullable(),
  description:   z.string().max(1000).optional().nullable(),
  serialNumber:  z.string().max(100).optional().nullable(),
  quantity:      z.number().int().min(1).optional(),
  status:        z.enum(["DISPONIBLE", "EN_USE", "EN_MAINTENANCE", "HORS_SERVICE", "PERDU"]).optional(),
  location:      z.string().max(150).optional().nullable(),
  purchaseDate:  z.string().optional().nullable(),
  purchasePrice: z.number().positive().optional().nullable(),
  notes:         z.string().max(1000).optional().nullable(),
})

async function resolve(id: string, associationId: string) {
  return prisma.material.findFirst({ where: { id, associationId } })
}

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const material = await prisma.material.findFirst({
    where:   { id, associationId },
    include: {
      loans: {
        orderBy: { borrowedAt: "desc" },
        include: { membre: { select: { firstName: true, lastName: true } } },
      },
    },
  })
  if (!material) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const loanedQty = material.loans
    .filter(l => !l.returnedAt && l.status === "CONFIRME")
    .reduce((s, l) => s + l.quantity, 0)

  return NextResponse.json({ ...material, loanedQty, availableQty: material.quantity - loanedQty })
}, { roles: ALLOWED })

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await resolve(id, associationId)
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const { purchaseDate, purchasePrice, ...rest } = parsed.data

  if (rest.quantity !== undefined) {
    const activeLoans = await prisma.materialLoan.aggregate({
      where: { materialId: id, returnedAt: null, status: "CONFIRME" },
      _sum:  { quantity: true },
    })
    const loaned = activeLoans._sum.quantity ?? 0
    if (rest.quantity < loaned) {
      return NextResponse.json(
        { error: `Impossible : ${loaned} unité(s) actuellement en prêt` },
        { status: 409 },
      )
    }
  }

  const updated = await prisma.material.update({
    where: { id },
    data:  {
      ...rest,
      ...(purchaseDate !== undefined ? { purchaseDate: purchaseDate ? new Date(purchaseDate) : null } : {}),
      ...(purchasePrice !== undefined ? { purchasePrice: purchasePrice ?? null } : {}),
    },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "MATERIEL_UPDATED", entity: "Material", entityId: id, label: updated.name })
  return NextResponse.json(updated)
}, { roles: ALLOWED, module: "materiel" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await resolve(id, associationId)
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const activeLoans = await prisma.materialLoan.count({
    where: { materialId: id, returnedAt: null, status: "CONFIRME" },
  })
  if (activeLoans > 0) {
    return NextResponse.json(
      { error: `Impossible : ${activeLoans} prêt(s) en cours pour cet article` },
      { status: 409 },
    )
  }

  await prisma.material.delete({ where: { id } })
  await writeActivityLog({ associationId, actorId: userId, action: "MATERIEL_DELETED", entity: "Material", entityId: id, label: existing.name })
  return new NextResponse(null, { status: 204 })
}, { roles: ALLOWED, module: "materiel" })
