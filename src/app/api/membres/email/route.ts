import { NextResponse } from "next/server"
import { z } from "zod"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { customEmail } from "@/lib/email"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const schema = z.object({
  subject:      z.string().min(1).max(200),
  bodyHtml:     z.string().min(1),
  recipientIds: z.array(z.string()).optional(),
})

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx

  if (!MANAGERS.includes(ctx.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 })

  const { subject, bodyHtml, recipientIds } = parsed.data

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { name: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const membres = await prisma.membre.findMany({
    where: {
      associationId: ctx.associationId,
      deletedAt:     null,
      status:        "ACTIF",
      email:         { not: null },
      ...(recipientIds?.length ? { id: { in: recipientIds } } : {}),
    },
    select: { email: true },
  })

  const results = await Promise.allSettled(
    membres
      .filter(m => m.email)
      .map(m => sendEmail(customEmail({
        associationName: assoc.name,
        subject,
        bodyHtml,
        recipientEmail:  m.email!,
      })))
  )

  const sent   = results.filter(r => r.status === "fulfilled").length
  const failed = results.filter(r => r.status === "rejected").length

  return NextResponse.json({ sent, failed })
}
