import { NextResponse }       from "next/server"
import { randomUUID }         from "crypto"
import { z }                  from "zod"
import { withSuperAdminAuth } from "@/lib/api-wrapper"
import { prisma }             from "@/lib/prisma/client"
import { sendEmailBulk }      from "@/lib/mail"
import { supportEmail }       from "@/lib/email"
import { writeActivityLog }   from "@/lib/activity-log"

const SOURCE = "SUPPORT_MESSAGE"

const postSchema = z.object({
  subject:    z.string().min(1).max(200),
  bodyHtml:   z.string().min(1),
  managerIds: z.array(z.string()).optional(),
  membreIds:  z.array(z.string()).optional(),
})

export const POST = withSuperAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const body   = await req.json()
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides" }, { status: 422 })
  }

  const { subject, bodyHtml, managerIds = [], membreIds = [] } = parsed.data
  if (managerIds.length === 0 && membreIds.length === 0) {
    return NextResponse.json({ error: "Aucun destinataire sélectionné" }, { status: 422 })
  }

  const association = await prisma.association.findUnique({
    where:  { id, deletedAt: null },
    select: { id: true },
  })
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const [managers, membres] = await Promise.all([
    managerIds.length
      ? prisma.user.findMany({
          where:  { id: { in: managerIds }, associationId: id, active: true, deletedAt: null },
          select: { id: true, email: true },
        })
      : Promise.resolve([]),
    membreIds.length
      ? prisma.membre.findMany({
          where:  { id: { in: membreIds }, associationId: id, deletedAt: null },
          select: { id: true, email: true },
        })
      : Promise.resolve([]),
  ])

  const batchId = randomUUID()

  const payloads = [
    ...managers.filter(u => u.email).map(u => ({
      ...supportEmail({ subject, bodyHtml, recipientEmail: u.email }),
      context: { associationId: id, userId: u.id, source: SOURCE, sourceId: batchId },
    })),
    ...membres.filter(m => m.email).map(m => ({
      ...supportEmail({ subject, bodyHtml, recipientEmail: m.email! }),
      context: { associationId: id, membreId: m.id, source: SOURCE, sourceId: batchId },
    })),
  ]

  if (payloads.length === 0) {
    return NextResponse.json({ error: "Aucun destinataire avec une adresse email valide" }, { status: 422 })
  }

  const { sent, failed, failedRecipients } = await sendEmailBulk(payloads)

  await writeActivityLog({
    associationId: id,
    actorId:       ctx.userId,
    action:        "SUPPORT_EMAIL_SENT",
    entity:        "EmailMessage",
    entityId:      batchId,
    label:         subject,
    metadata:      { sent, failed, recipientCount: payloads.length, managerCount: managers.length, membreCount: membres.length },
  })

  return NextResponse.json({ sent, failed, failedRecipients })
})

export const GET = withSuperAdminAuth<{ id: string }>(async (req, _ctx, { id }) => {
  const url      = new URL(req.url)
  const page     = Math.max(1, Number(url.searchParams.get("page")) || 1)
  const pageSize = Math.min(100, Number(url.searchParams.get("pageSize")) || 20)

  const [emails, total] = await Promise.all([
    prisma.emailMessage.findMany({
      where:   { associationId: id, source: SOURCE },
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
      select: {
        id:        true,
        subject:   true,
        to:        true,
        status:    true,
        errorMessage: true,
        sentAt:    true,
        deliveredAt:  true,
        openedAt:     true,
        clickedAt:    true,
        bouncedAt:    true,
        complainedAt: true,
        createdAt: true,
        userId:    true,
        membreId:  true,
        user:      { select: { name: true, email: true, role: true } },
        membre:    { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.emailMessage.count({ where: { associationId: id, source: SOURCE } }),
  ])

  return NextResponse.json({ emails, total, page, pageSize })
})
