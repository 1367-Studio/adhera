import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import type { SessionUser } from "@/lib/user-context"

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

  const { id, loanId } = await params

  const loan = await prisma.materialLoan.findFirst({
    where: { id: loanId, material: { associationId: u.associationId }, materialId: id },
  })
  if (!loan) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => ({}))
  const parsed = patchSchema.safeParse(body)

  // Fix 9: return 400 on malformed body instead of silently defaulting to "return"
  if (!parsed.success) {
    return NextResponse.json({ error: "Action invalide" }, { status: 400 })
  }

  const action = parsed.data.action ?? "return"

  if (action === "return") {
    if (loan.returnedAt) return NextResponse.json({ error: "Déjà rendu" }, { status: 409 })
    // Fix 2: cannot return a loan that was never confirmed
    if (loan.status !== "CONFIRME") {
      return NextResponse.json({ error: "Ce prêt n'a pas encore été confirmé" }, { status: 409 })
    }
    const updated = await prisma.materialLoan.update({
      where: { id: loanId },
      data:  { returnedAt: new Date() },
      include: { membre: { select: { firstName: true, lastName: true } } },
    })
    return NextResponse.json(updated)
  }

  if (action === "confirm") {
    if (loan.status !== "DEMANDE") {
      return NextResponse.json({ error: "Ce prêt n'est pas en attente" }, { status: 409 })
    }
    const activeLoans = await prisma.materialLoan.aggregate({
      where: { materialId: id, returnedAt: null, status: "CONFIRME" },
      _sum:  { quantity: true },
    })
    const loaned    = activeLoans._sum.quantity ?? 0
    const material  = await prisma.material.findUnique({ where: { id }, select: { quantity: true } })
    const available = (material?.quantity ?? 0) - loaned
    if (loan.quantity > available) {
      return NextResponse.json({ error: `Seulement ${available} unité(s) disponible(s)` }, { status: 409 })
    }
    const updated = await prisma.materialLoan.update({
      where: { id: loanId },
      data:  { status: "CONFIRME" },
      include: { membre: { select: { firstName: true, lastName: true } } },
    })
    return NextResponse.json(updated)
  }

  if (action === "refuse") {
    if (loan.status !== "DEMANDE") {
      return NextResponse.json({ error: "Ce prêt n'est pas en attente" }, { status: 409 })
    }
    const updated = await prisma.materialLoan.update({
      where: { id: loanId },
      data:  { status: "REFUSE" },
      include: { membre: { select: { firstName: true, lastName: true } } },
    })
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

  const { id, loanId } = await params

  const loan = await prisma.materialLoan.findFirst({
    where: { id: loanId, material: { associationId: u.associationId }, materialId: id },
  })
  if (!loan) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  await prisma.materialLoan.delete({ where: { id: loanId } })
  return new NextResponse(null, { status: 204 })
}
