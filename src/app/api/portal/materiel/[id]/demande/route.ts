import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"

type SessionUser = { id?: string; associationId?: string | null }

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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const membre = await prisma.membre.findFirst({
    where:  { userId: u.id!, associationId: u.associationId, deletedAt: null },
    select: { id: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const { id } = await params

  const material = await prisma.material.findFirst({
    where: { id, associationId: u.associationId },
  })
  if (!material) return NextResponse.json({ error: "Article introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 422 })
  }

  const existing = await prisma.materialLoan.findFirst({
    where: { materialId: id, membreId: membre.id, returnedAt: null, status: { in: ["DEMANDE", "CONFIRME"] } },
  })
  if (existing) {
    return NextResponse.json({ error: "Vous avez déjà une demande en cours pour cet article" }, { status: 409 })
  }

  const loan = await prisma.materialLoan.create({
    data: {
      materialId:       id,
      membreId:         membre.id,
      quantity:         parsed.data.quantity,
      status:           "DEMANDE",
      expectedReturnAt: parsed.data.expectedReturnAt ? new Date(parsed.data.expectedReturnAt) : null,
      notes:            parsed.data.notes ?? null,
    },
    include: { material: { select: { name: true } } },
  })

  return NextResponse.json(loan, { status: 201 })
}
