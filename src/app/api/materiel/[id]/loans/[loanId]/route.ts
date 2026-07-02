import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import type { SessionUser } from "@/lib/user-context"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"

const ALLOWED = ["ADMIN", "PRESIDENT", "SECRETAIRE", "TRESORIER"]

const patchSchema = z.object({
  action: z.enum(["return", "confirm", "refuse"]).optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; loanId: string }> }) {
  const session = await auth()
  const u = session?.user as SessionUser | undefined
  if (!u?.associationId || !ALLOWED.includes(u.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const guard = await guardModule(u.associationId, "materiel")
  if (guard) return guard

  const { id, loanId } = await params

  const loan = await prisma.materialLoan.findFirst({
    where:   { id: loanId, material: { associationId: u.associationId }, materialId: id },
    include: {
      material: { select: { name: true } },
      membre:   { select: { firstName: true, lastName: true } },
    },
  })
  if (!loan) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => ({}))
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Action invalide" }, { status: 400 })
  }

  const action   = parsed.data.action ?? "return"
  const borrower = loan.membre
    ? `${loan.membre.firstName} ${loan.membre.lastName}`
    : (loan.borrowerName ?? "Externe")
  const label = `${loan.material.name} — ${borrower}`

  if (action === "return") {
    if (loan.returnedAt) return NextResponse.json({ error: "Déjà rendu" }, { status: 409 })
    if (loan.status !== "CONFIRME") {
      return NextResponse.json({ error: "Ce prêt n'a pas encore été confirmé" }, { status: 409 })
    }
    const updated = await prisma.materialLoan.update({
      where:   { id: loanId },
      data:    { returnedAt: new Date() },
      include: { membre: { select: { firstName: true, lastName: true } } },
    })
    await writeActivityLog({ associationId: u.associationId, actorId: u.id, action: "LOAN_RETURNED", entity: "MaterialLoan", entityId: loanId, label })
    return NextResponse.json(updated)
  }

  if (action === "confirm") {
    if (loan.status !== "DEMANDE") {
      return NextResponse.json({ error: "Ce prêt n'est pas en attente" }, { status: 409 })
    }
    let updated
    try {
      updated = await prisma.$transaction(async tx => {
        const current = await tx.materialLoan.findUniqueOrThrow({ where: { id: loanId }, select: { status: true, quantity: true } })
        if (current.status !== "DEMANDE") throw new Error("Ce prêt n'est pas en attente")

        const activeLoans = await tx.materialLoan.aggregate({
          where: { materialId: id, returnedAt: null, status: "CONFIRME" },
          _sum:  { quantity: true },
        })
        const loaned    = activeLoans._sum.quantity ?? 0
        const material  = await tx.material.findUnique({ where: { id }, select: { quantity: true } })
        const available = (material?.quantity ?? 0) - loaned
        if (current.quantity > available) {
          throw new Error(`Seulement ${available} unité(s) disponible(s)`)
        }

        return tx.materialLoan.update({
          where:   { id: loanId },
          data:    { status: "CONFIRME" },
          include: { membre: { select: { firstName: true, lastName: true } } },
        })
      }, { isolationLevel: "Serializable" })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur" }, { status: 409 })
    }
    await writeActivityLog({ associationId: u.associationId, actorId: u.id, action: "LOAN_CONFIRMED", entity: "MaterialLoan", entityId: loanId, label })
    return NextResponse.json(updated)
  }

  if (action === "refuse") {
    if (loan.status !== "DEMANDE") {
      return NextResponse.json({ error: "Ce prêt n'est pas en attente" }, { status: 409 })
    }
    const updated = await prisma.materialLoan.update({
      where:   { id: loanId },
      data:    { status: "REFUSE" },
      include: { membre: { select: { firstName: true, lastName: true } } },
    })
    await writeActivityLog({ associationId: u.associationId, actorId: u.id, action: "LOAN_REFUSED", entity: "MaterialLoan", entityId: loanId, label })
    return NextResponse.json(updated)
  }

  return NextResponse.json({ error: "Action invalide" }, { status: 400 })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; loanId: string }> }) {
  const session = await auth()
  const u = session?.user as SessionUser | undefined
  if (!u?.associationId || !ALLOWED.includes(u.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const guard = await guardModule(u.associationId, "materiel")
  if (guard) return guard

  const { id, loanId } = await params

  const loan = await prisma.materialLoan.findFirst({
    where:   { id: loanId, material: { associationId: u.associationId }, materialId: id },
    include: {
      material: { select: { name: true } },
      membre:   { select: { firstName: true, lastName: true } },
    },
  })
  if (!loan) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  await prisma.materialLoan.delete({ where: { id: loanId } })

  const borrower = loan.membre
    ? `${loan.membre.firstName} ${loan.membre.lastName}`
    : (loan.borrowerName ?? "Externe")
  await writeActivityLog({ associationId: u.associationId, actorId: u.id, action: "LOAN_DELETED", entity: "MaterialLoan", entityId: loanId, label: `${loan.material.name} — ${borrower}` })

  return new NextResponse(null, { status: 204 })
}
