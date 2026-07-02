import { NextResponse } from "next/server"
import { z } from "zod"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { sendSmsBatch } from "@/lib/sms"
import { guardModule } from "@/lib/auth/require-module"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const schema = z.object({
  body:         z.string().min(1).max(1600),
  recipientIds: z.array(z.string()).min(1).optional(),
  typeId:       z.string().optional(),
})

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx

  const guard = await guardModule(ctx.associationId, "sms")
  if (guard) return guard

  if (!MANAGERS.includes(ctx.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const raw    = await req.json().catch(() => null)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 })

  const { body, recipientIds, typeId } = parsed.data

  const membres = await prisma.membre.findMany({
    where: {
      associationId: ctx.associationId,
      deletedAt:     null,
      status:        "ACTIF",
      phone:         { not: null },
      ...(recipientIds?.length ? { id: { in: recipientIds } } : {}),
      ...(typeId ? { typeId } : {}),
    },
    select: { phone: true },
    take:   500,
  })

  const jobs = membres.filter(m => m.phone).map(m => ({ to: m.phone!, body }))
  if (jobs.length === 0) return NextResponse.json({ sent: 0, failed: 0 })

  const results = await sendSmsBatch(jobs, ctx.associationId)
  const sent    = results.filter(Boolean).length
  const failed  = results.length - sent

  const recipientMode = recipientIds?.length ? "manual" : typeId ? "type" : "all"
  if (sent > 0) {
    await writeActivityLog({
      associationId: ctx.associationId,
      actorId:       ctx.userId,
      action:        "SMS_SENT_BULK",
      entity:        "Membre",
      label:         body.slice(0, 80),
      metadata:      {
        sent,
        failed,
        recipientMode,
        ...(typeId               ? { typeId }                              : {}),
        ...(recipientIds?.length ? { recipientCount: recipientIds.length } : {}),
      },
    })
  }

  return NextResponse.json({ sent, failed })
}
