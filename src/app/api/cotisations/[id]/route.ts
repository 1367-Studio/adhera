import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { cotisationUpdateSchema } from "@/lib/schemas"
import { sendEmail } from "@/lib/mail"
import { paymentConfirmationEmail } from "@/lib/email"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.cotisation.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Cotisation introuvable" }, { status: 404 })

  const body = await req.json()
  const parsed = cotisationUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { paidAt, note, amount, ...rest } = parsed.data
  const cotisation = await prisma.cotisation.update({
    where: { id },
    data: {
      ...rest,
      ...(amount    !== undefined ? { amount: amount }                              : {}),
      ...(paidAt    !== undefined ? { paidAt: paidAt ? new Date(paidAt) : null }    : {}),
      ...(note      !== undefined ? { note:   note   || null }                      : {}),
    },
    include: { membre: { select: { id: true, firstName: true, lastName: true, email: true } } },
  })

  const becomingPaid = parsed.data.status === "PAYE" && existing.status !== "PAYE"
  if (becomingPaid && cotisation.membre.email) {
    const assoc = await prisma.association.findUnique({ where: { id: associationId }, select: { name: true } })
    if (assoc) {
      sendEmail(paymentConfirmationEmail({
        firstName:       cotisation.membre.firstName,
        email:           cotisation.membre.email,
        associationName: assoc.name,
        amount:          cotisation.amount ? Number(cotisation.amount) : null,
        period:          String(cotisation.year),
        paidAt:          cotisation.paidAt ?? new Date(),
      })).catch(() => {})
    }
  }

  return NextResponse.json(cotisation)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.cotisation.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Cotisation introuvable" }, { status: 404 })

  await prisma.cotisation.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}
