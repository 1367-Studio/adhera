import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const ALLOWED = ["ADMIN", "PRESIDENT", "SECRETAIRE", "TRESORIER"]

const schema = z.object({
  membreId:         z.string().optional().nullable(),
  borrowerName:     z.string().max(150).optional().nullable(),
  quantity:         z.number().int().min(1).default(1),
  borrowedAt:       z.string().optional(),
  expectedReturnAt: z.string().optional().nullable(),
  feeAmount:        z.number().nonnegative().optional().nullable(),
  notes:            z.string().max(500).optional().nullable(),
}).refine(d => d.membreId || d.borrowerName, { message: "Emprunteur requis" })

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const material = await prisma.material.findFirst({ where: { id, associationId } })
  if (!material) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 422 })

  const borrowedAt = parsed.data.borrowedAt ? new Date(parsed.data.borrowedAt) : new Date()

  let loan
  try {
    loan = await prisma.$transaction(async tx => {
      // Only loans that will have already started by this new loan's borrowedAt compete for
      // its capacity — a same-day request shouldn't be blocked by someone else's reservation
      // for next month, but a reservation still has to stack correctly against loans (current
      // or already-reserved) that start on or before it.
      const activeLoans = await tx.materialLoan.aggregate({
        where: { materialId: id, returnedAt: null, status: "CONFIRME", borrowedAt: { lte: borrowedAt } },
        _sum:  { quantity: true },
      })
      const loaned    = activeLoans._sum.quantity ?? 0
      const available = material.quantity - loaned
      if (parsed.data.quantity > available) {
        throw new Error(`Seulement ${available} unité(s) disponible(s)`)
      }

      return tx.materialLoan.create({
        data: {
          materialId:       id,
          membreId:         parsed.data.membreId ?? null,
          borrowerName:     parsed.data.borrowerName ?? null,
          quantity:         parsed.data.quantity,
          borrowedAt,
          expectedReturnAt: parsed.data.expectedReturnAt ? new Date(parsed.data.expectedReturnAt) : null,
          feeAmount:        parsed.data.feeAmount ?? null,
          notes:            parsed.data.notes ?? null,
        },
        include: { membre: { select: { firstName: true, lastName: true } } },
      })
    }, { isolationLevel: "Serializable" })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur" }, { status: 409 })
  }

  const borrower = loan.membre
    ? `${loan.membre.firstName} ${loan.membre.lastName}`
    : (parsed.data.borrowerName ?? "Externe")
  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "LOAN_CREATED",
    entity:   "MaterialLoan",
    entityId: loan.id,
    label:    `${material.name} — ${borrower}`,
    metadata: { quantity: loan.quantity },
  })

  return NextResponse.json(loan, { status: 201 })
}, { roles: ALLOWED, module: "materiel" })
