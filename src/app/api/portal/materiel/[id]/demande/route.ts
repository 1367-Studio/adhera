import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withPortalAuth } from "@/lib/api-wrapper"

type Params = { id: string }

// Fix 4: validate expectedReturnAt is a valid date string (not NaN) and not in the past
const schema = z.object({
  quantity:         z.number().int().min(1).default(1),
  expectedReturnAt: z.string().optional().nullable().refine(
    v => !v || !isNaN(Date.parse(v)),
    "Date de retour invalide",
  ).refine(
    v => !v || new Date(v) >= new Date(new Date().toISOString().split("T")[0]),
    "La date de retour ne peut pas être dans le passé",
  ),
  notes: z.string().max(500).trim().optional().nullable(),
})

export const POST = withPortalAuth<Params>(async (req, ctx, { id }) => {
  const material = await prisma.material.findFirst({
    where: { id, associationId: ctx.associationId },
  })
  if (!material) return NextResponse.json({ error: "Article introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 422 })
  }

  const existing = await prisma.materialLoan.findFirst({
    where: { materialId: id, membreId: ctx.membreId!, returnedAt: null, status: { in: ["DEMANDE", "CONFIRME"] } },
  })
  if (existing) {
    return NextResponse.json({ error: "Vous avez déjà une demande en cours pour cet article" }, { status: 409 })
  }

  let loan
  try {
    loan = await prisma.$transaction(async tx => {
      const activeLoans = await tx.materialLoan.aggregate({
        where: { materialId: id, returnedAt: null, status: "CONFIRME" },
        _sum:  { quantity: true },
      })
      const available = material.quantity - (activeLoans._sum.quantity ?? 0)
      if (parsed.data.quantity > available) {
        throw new Error(`Seulement ${available} unité(s) disponible(s)`)
      }

      return tx.materialLoan.create({
        data: {
          materialId:       id,
          membreId:         ctx.membreId!,
          quantity:         parsed.data.quantity,
          status:           "DEMANDE",
          expectedReturnAt: parsed.data.expectedReturnAt ? new Date(parsed.data.expectedReturnAt) : null,
          notes:            parsed.data.notes ?? null,
        },
        include: { material: { select: { name: true } } },
      })
    }, { isolationLevel: "Serializable" })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur" }, { status: 409 })
  }

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:  ctx.userId,
    action:   "LOAN_REQUESTED",
    entity:   "MaterialLoan",
    entityId: loan.id,
    label:    loan.material.name,
    metadata: { quantity: loan.quantity },
  })

  return NextResponse.json(loan, { status: 201 })
}, { module: "materiel" })
