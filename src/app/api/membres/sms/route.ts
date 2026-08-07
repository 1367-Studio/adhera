import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { inngest } from "@/lib/inngest"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const schema = z.object({
  body:         z.string().min(1).max(1600),
  recipientIds: z.array(z.string()).min(1).optional(),
  typeId:       z.string().optional(),
})

export const POST = withAdminAuth(async (req, ctx) => {
  if (!MANAGERS.includes(ctx.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const raw    = await req.json().catch(() => null)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 })

  const { body, recipientIds, typeId } = parsed.data

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { name: true, slug: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const membres = await prisma.membre.findMany({
    where: {
      associationId: ctx.associationId,
      deletedAt:     null,
      status:        "ACTIF",
      phone:         { not: null },
      ...(recipientIds?.length ? { id: { in: recipientIds } } : {}),
      ...(typeId ? { typeId } : {}),
    },
    select: { id: true, firstName: true, lastName: true, phone: true },
    take:   500,
  })

  const recipients = membres.filter(m => m.phone)
  if (recipients.length === 0) return NextResponse.json({ jobId: null, totalRecipients: 0 })

  const recipientMode = recipientIds?.length ? "manual" : typeId ? "type" : "all"
  const jobId = randomUUID()

  await inngest.send({
    name: "bulk/membres-sms.requested",
    data: {
      jobId,
      associationId: ctx.associationId,
      actorId:       ctx.userId,
      body,
      associationName: assoc.name,
      slug:             assoc.slug,
      members:          recipients.map(m => ({ id: m.id, firstName: m.firstName, lastName: m.lastName, phone: m.phone! })),
      activityMeta: {
        recipientMode,
        ...(typeId               ? { typeId }                              : {}),
        ...(recipientIds?.length ? { recipientCount: recipientIds.length } : {}),
      },
    },
  })

  return NextResponse.json({ jobId, totalRecipients: recipients.length })
}, { module: "sms" })
