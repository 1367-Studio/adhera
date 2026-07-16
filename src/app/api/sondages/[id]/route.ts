import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const questionSchema = z.object({
  clientKey: z.string().optional(),
  id:        z.string().optional(),
  type:      z.enum(["TEXT_SHORT", "TEXT_LONG", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "RATING", "YES_NO"]),
  label:     z.string().trim().min(1).max(500),
  required:  z.boolean().default(false),
  order:     z.number().int().min(0),
  options:   z.array(z.string().trim().min(1)).nullable().optional(),
  condition: z.object({
    questionId: z.string(),
    operator:   z.enum(["eq", "neq", "includes"]),
    value:      z.string(),
  }).nullable().optional(),
})

const updateSchema = z.object({
  title:         z.string().trim().min(1).max(200).optional(),
  description:   z.string().trim().max(2000).optional().nullable(),
  recipientMode: z.enum(["ALL", "SELECTED"]).optional(),
  anonymous:     z.boolean().optional(),
  deadline:      z.string().datetime().optional().nullable(),
  questions:     z.array(questionSchema).min(1).max(50).optional(),
  recipientIds:  z.array(z.string()).optional(),
})

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const sondage = await prisma.sondage.findFirst({
    where:   { id, associationId: ctx.associationId },
    include: {
      questions:  { orderBy: { order: "asc" } },
      recipients: { select: { membreId: true } },
      _count:     { select: { reponses: true, questions: true } },
    },
  })
  if (!sondage) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  return NextResponse.json(sondage)
})

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const sondage = await prisma.sondage.findFirst({
    where: { id, associationId: ctx.associationId },
    select: { id: true, status: true, title: true, _count: { select: { reponses: true } } },
  })
  if (!sondage) return NextResponse.json({ error: "Introuvable" }, { status: 404 })
  if (sondage.status === "FERME")
    return NextResponse.json({ error: "Un sondage fermé ne peut plus être modifié" }, { status: 400 })

  const body   = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { title, description, recipientMode, anonymous, deadline, questions, recipientIds } = parsed.data

  // Rebuilding `questions` cascade-deletes every submitted SondageReponseItem
  // (onDelete: Cascade) and the unique [sondageId, membreId] constraint means those
  // members could never re-submit — block it once real answers exist.
  if (questions && sondage._count.reponses > 0)
    return NextResponse.json({ error: "Ce sondage a déjà des réponses — les questions ne peuvent plus être modifiées." }, { status: 400 })

  await prisma.$transaction(async tx => {
    await tx.sondage.update({
      where: { id },
      data: {
        ...(title         !== undefined ? { title }                              : {}),
        ...(description   !== undefined ? { description: description ?? null }   : {}),
        ...(recipientMode !== undefined ? { recipientMode }                      : {}),
        ...(anonymous     !== undefined ? { anonymous }                          : {}),
        ...(deadline      !== undefined ? { deadline: deadline ? new Date(deadline) : null } : {}),
      },
    })

    if (questions) {
      await tx.sondageQuestion.deleteMany({ where: { sondageId: id } })

      // First pass: create without conditions, build clientKey → DB ID map
      const keyToId: Record<string, string> = {}
      for (const q of questions) {
        const dbQ = await tx.sondageQuestion.create({
          data: {
            sondageId: id,
            type:      q.type,
            label:     q.label,
            required:  q.required,
            order:     q.order,
            options:   q.options ?? Prisma.JsonNull,
            condition: Prisma.JsonNull,
          },
        })
        if (q.clientKey) keyToId[q.clientKey] = dbQ.id
      }

      // Second pass: resolve and store conditions using stable DB IDs
      for (const q of questions) {
        if (!q.condition || !q.clientKey) continue
        const dbId       = keyToId[q.clientKey]
        const resolvedId = keyToId[q.condition.questionId]
        if (!dbId || !resolvedId) continue
        await tx.sondageQuestion.update({
          where: { id: dbId },
          data:  { condition: { ...q.condition, questionId: resolvedId } },
        })
      }
    }

    if (recipientMode === "SELECTED" && recipientIds !== undefined) {
      await tx.sondageRecipient.deleteMany({ where: { sondageId: id } })
      if (recipientIds.length) {
        await tx.sondageRecipient.createMany({
          data: recipientIds.map(membreId => ({ sondageId: id, membreId })),
        })
      }
    } else if (recipientMode === "ALL") {
      // Clear stale selections so switching back to "SELECTED" later doesn't
      // silently resurrect members picked before this switch to "ALL".
      await tx.sondageRecipient.deleteMany({ where: { sondageId: id } })
    }
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "SONDAGE_UPDATED",
    entity:        "Sondage",
    entityId:      id,
    label:         title ?? sondage.title,
  })

  const updated = await prisma.sondage.findUnique({
    where:   { id },
    include: { questions: { orderBy: { order: "asc" } }, recipients: { select: { membreId: true } }, _count: { select: { reponses: true, questions: true } } },
  })
  return NextResponse.json(updated)
})

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!["ADMIN", "PRESIDENT"].includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const sondage = await prisma.sondage.findFirst({
    where: { id, associationId: ctx.associationId },
    select: { id: true, title: true },
  })
  if (!sondage) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  await prisma.sondage.delete({ where: { id } })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "SONDAGE_DELETED",
    entity:        "Sondage",
    entityId:      id,
    label:         sondage.title,
  })

  return NextResponse.json({ ok: true })
})
