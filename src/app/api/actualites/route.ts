import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { actualiteSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

const include = {
  evenement:  { select: { id: true, title: true, date: true, location: true } },
  recipients: { select: { membreId: true } },
}

export async function GET(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search")?.trim()

  const where: Record<string, unknown> = { associationId }
  if (search) {
    where.OR = [
      { title:   { contains: search, mode: "insensitive" } },
      { content: { contains: search, mode: "insensitive" } },
    ]
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.actualite.findMany({
      where,
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      skip, take: limit,
      include,
    }),
    prisma.actualite.count({ where }),
  ])

  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
}

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  const guard = await guardModule(associationId, "actualites")
  if (guard) return guard

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const parsed = actualiteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { evenementId, imageUrl, recipientMode, recipientIds, ...rest } = parsed.data

  const actualite = await prisma.actualite.create({
    data: {
      ...rest,
      associationId,
      evenementId:   evenementId || null,
      imageUrl:      imageUrl    || null,
      recipientMode,
      ...(recipientMode === "SELECTED" && recipientIds?.length
        ? { recipients: { create: recipientIds.map(membreId => ({ membreId })) } }
        : {}),
    },
    include,
  })

  await writeActivityLog({ associationId, actorId: userId, action: "ACTUALITE_CREATED", entity: "Actualite", entityId: actualite.id, label: actualite.title })
  return NextResponse.json(actualite, { status: 201 })
}
