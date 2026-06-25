import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"

type SessionUser = { id?: string; associationId?: string | null }

const patchSchema = z.object({
  quantity:         z.number().int().min(1).optional(),
  expectedReturnAt: z.string().optional().nullable().refine(
    v => !v || !isNaN(Date.parse(v)),
    "Date de retour invalide",
  ).refine(
    v => !v || new Date(v) >= new Date(new Date().toISOString().split("T")[0]),
    "La date de retour ne peut pas être dans le passé",
  ),
  notes: z.string().max(500).trim().optional().nullable(),
})

async function getMembre(userId: string, associationId: string) {
  return prisma.membre.findFirst({
    where:  { userId, associationId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ loanId: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const membre = await getMembre(u.id!, u.associationId)
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const { loanId } = await params

  const loan = await prisma.materialLoan.findFirst({
    where:   { id: loanId, membreId: membre.id },
    include: { material: { select: { name: true } } },
  })
  if (!loan) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 })
  if (loan.status !== "DEMANDE") return NextResponse.json({ error: "Seules les demandes en attente peuvent être modifiées" }, { status: 409 })

  const body   = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 422 })
  }

  const updated = await prisma.materialLoan.update({
    where: { id: loanId },
    data: {
      ...(parsed.data.quantity         !== undefined ? { quantity:         parsed.data.quantity }                                                                : {}),
      ...(parsed.data.expectedReturnAt !== undefined ? { expectedReturnAt: parsed.data.expectedReturnAt ? new Date(parsed.data.expectedReturnAt) : null }        : {}),
      ...(parsed.data.notes            !== undefined ? { notes:            parsed.data.notes ?? null }                                                           : {}),
    },
  })

  await writeActivityLog({
    associationId: u.associationId,
    actorId:  u.id,
    action:   "LOAN_UPDATED",
    entity:   "MaterialLoan",
    entityId: loanId,
    label:    `${loan.material.name} — ${membre.firstName} ${membre.lastName}`,
  })

  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ loanId: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const membre = await getMembre(u.id!, u.associationId)
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const { loanId } = await params

  const loan = await prisma.materialLoan.findFirst({
    where:   { id: loanId, membreId: membre.id },
    include: { material: { select: { name: true } } },
  })
  if (!loan) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 })
  if (loan.status !== "DEMANDE") return NextResponse.json({ error: "Seules les demandes en attente peuvent être annulées" }, { status: 409 })

  await prisma.materialLoan.delete({ where: { id: loanId } })

  await writeActivityLog({
    associationId: u.associationId,
    actorId:  u.id,
    action:   "LOAN_CANCELLED",
    entity:   "MaterialLoan",
    entityId: loanId,
    label:    `${loan.material.name} — ${membre.firstName} ${membre.lastName}`,
  })

  return NextResponse.json({ ok: true })
}
