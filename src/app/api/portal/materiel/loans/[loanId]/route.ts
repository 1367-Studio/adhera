import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withPortalAuth } from "@/lib/api-wrapper"

type Params = { loanId: string }

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

export const PATCH = withPortalAuth<Params>(async (req, ctx, { loanId }) => {
  const membre = await prisma.membre.findUnique({
    where:  { id: ctx.membreId! },
    select: { id: true, firstName: true, lastName: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

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
    associationId: ctx.associationId,
    actorId:  ctx.userId,
    action:   "LOAN_UPDATED",
    entity:   "MaterialLoan",
    entityId: loanId,
    label:    `${loan.material.name} — ${membre.firstName} ${membre.lastName}`,
  })

  return NextResponse.json(updated)
})

export const DELETE = withPortalAuth<Params>(async (_req, ctx, { loanId }) => {
  const membre = await prisma.membre.findUnique({
    where:  { id: ctx.membreId! },
    select: { id: true, firstName: true, lastName: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const loan = await prisma.materialLoan.findFirst({
    where:   { id: loanId, membreId: membre.id },
    include: { material: { select: { name: true } } },
  })
  if (!loan) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 })
  if (loan.status !== "DEMANDE") return NextResponse.json({ error: "Seules les demandes en attente peuvent être annulées" }, { status: 409 })

  await prisma.materialLoan.delete({ where: { id: loanId } })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:  ctx.userId,
    action:   "LOAN_CANCELLED",
    entity:   "MaterialLoan",
    entityId: loanId,
    label:    `${loan.material.name} — ${membre.firstName} ${membre.lastName}`,
  })

  return NextResponse.json({ ok: true })
})
