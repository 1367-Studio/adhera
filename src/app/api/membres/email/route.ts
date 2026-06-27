import { NextResponse } from "next/server"
import { z } from "zod"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { customEmail } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const schema = z.object({
  subject:      z.string().min(1).max(200),
  bodyHtml:     z.string().min(1),
  recipientIds: z.array(z.string()).optional(),
  typeId:       z.string().optional(),
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

  const { subject, bodyHtml, recipientIds, typeId } = parsed.data

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
      ...(typeId ? { typeId } : {}),
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

  const recipientMode = recipientIds?.length ? "manual" : typeId ? "type" : "all"
  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "EMAIL_SENT_BULK",
    entity:        "Membre",
    label:         subject,
    metadata:      {
      sent,
      failed,
      recipientMode,
      ...(typeId           ? { typeId }                              : {}),
      ...(recipientIds?.length ? { recipientCount: recipientIds.length } : {}),
    },
  })

  return NextResponse.json({ sent, failed })
}
