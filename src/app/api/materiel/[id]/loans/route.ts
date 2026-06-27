import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import type { SessionUser } from "@/lib/user-context"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"

const ALLOWED = ["ADMIN", "PRESIDENT", "SECRETAIRE", "TRESORIER"]

const schema = z.object({
  membreId:         z.string().optional().nullable(),
  borrowerName:     z.string().max(150).optional().nullable(),
  quantity:         z.number().int().min(1).default(1),
  borrowedAt:       z.string().optional(),
  expectedReturnAt: z.string().optional().nullable(),
  notes:            z.string().max(500).optional().nullable(),
}).refine(d => d.membreId || d.borrowerName, { message: "Emprunteur requis" })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const u = session?.user as SessionUser | undefined
  if (!u?.associationId || !ALLOWED.includes(u.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const guard = await guardModule(u.associationId, "materiel")
  if (guard) return guard

  const { id } = await params
  const material = await prisma.material.findFirst({ where: { id, associationId: u.associationId } })
  if (!material) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 422 })

  const activeLoans = await prisma.materialLoan.aggregate({
    where: { materialId: id, returnedAt: null, status: "CONFIRME" },
    _sum:  { quantity: true },
  })
  const loaned    = activeLoans._sum.quantity ?? 0
  const available = material.quantity - loaned
  if (parsed.data.quantity > available) {
    return NextResponse.json({ error: `Seulement ${available} unité(s) disponible(s)` }, { status: 409 })
  }

  const loan = await prisma.materialLoan.create({
    data: {
      materialId:       id,
      membreId:         parsed.data.membreId ?? null,
      borrowerName:     parsed.data.borrowerName ?? null,
      quantity:         parsed.data.quantity,
      borrowedAt:       parsed.data.borrowedAt ? new Date(parsed.data.borrowedAt) : new Date(),
      expectedReturnAt: parsed.data.expectedReturnAt ? new Date(parsed.data.expectedReturnAt) : null,
      notes:            parsed.data.notes ?? null,
    },
    include: { membre: { select: { firstName: true, lastName: true } } },
  })

  const borrower = loan.membre
    ? `${loan.membre.firstName} ${loan.membre.lastName}`
    : (parsed.data.borrowerName ?? "Externe")
  await writeActivityLog({
    associationId: u.associationId,
    actorId:  u.id,
    action:   "LOAN_CREATED",
    entity:   "MaterialLoan",
    entityId: loan.id,
    label:    `${material.name} — ${borrower}`,
    metadata: { quantity: loan.quantity },
  })

  return NextResponse.json(loan, { status: 201 })
}
