import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { parsePagination } from "@/lib/pagination"
import { guardModule } from "@/lib/auth/require-module"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const questionSchema = z.object({
  clientKey: z.string().optional(),
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

const createSchema = z.object({
  title:         z.string().trim().min(1).max(200),
  description:   z.string().trim().max(2000).optional(),
  recipientMode: z.enum(["ALL", "SELECTED"]).default("ALL"),
  anonymous:     z.boolean().default(false),
  deadline:      z.string().datetime().optional().nullable(),
  questions:     z.array(questionSchema).min(1).max(50),
  recipientIds:  z.array(z.string()).optional(),
})

export const GET = withAdminAuth(async (req, ctx) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search")?.trim()

  const where: Prisma.SondageWhereInput = { associationId: ctx.associationId }
  if (search) where.title = { contains: search, mode: "insensitive" }

  const orderBy = { createdAt: "desc" as const }
  const include = { _count: { select: { reponses: true, questions: true } } }

  if (!searchParams.has("page")) {
    return NextResponse.json(await prisma.sondage.findMany({ where, orderBy, include }))
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.sondage.findMany({ where, orderBy, skip, take: limit, include }),
    prisma.sondage.count({ where }),
  ])
  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
})

export const POST = withAdminAuth(async (req, ctx) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const guard = await guardModule(ctx.associationId, "sondages")
  if (guard) return guard

  const body   = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { title, description, recipientMode, anonymous, deadline, questions, recipientIds } = parsed.data

  const sondage = await prisma.$transaction(async tx => {
    const created = await tx.sondage.create({
      data: {
        associationId: ctx.associationId,
        title,
        description:   description || null,
        recipientMode,
        anonymous,
        deadline:      deadline ? new Date(deadline) : null,
        ...(recipientMode === "SELECTED" && recipientIds?.length ? {
          recipients: { create: recipientIds.map(membreId => ({ membreId })) },
        } : {}),
      },
    })

    // First pass: create questions without conditions, build clientKey → DB ID map
    const keyToId: Record<string, string> = {}
    for (const q of questions) {
      const dbQ = await tx.sondageQuestion.create({
        data: {
          sondageId: created.id,
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
      const dbId      = keyToId[q.clientKey]
      const resolvedId = keyToId[q.condition.questionId]
      if (!dbId || !resolvedId) continue
      await tx.sondageQuestion.update({
        where: { id: dbId },
        data:  { condition: { ...q.condition, questionId: resolvedId } },
      })
    }

    return tx.sondage.findUniqueOrThrow({
      where:   { id: created.id },
      include: { questions: { orderBy: { order: "asc" } }, _count: { select: { reponses: true, questions: true } } },
    })
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "SONDAGE_CREATED",
    entity:        "Sondage",
    entityId:      sondage.id,
    label:         sondage.title,
  })

  return NextResponse.json(sondage, { status: 201 })
})
