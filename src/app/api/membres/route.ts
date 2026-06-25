import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { welcomeEmail } from "@/lib/email"
import { membreSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export async function GET(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search")?.trim()
  const status = searchParams.get("status") ?? undefined
  const typeId = searchParams.get("typeId") ?? undefined

  const where: Record<string, unknown> = { associationId, deletedAt: null }
  if (status) where.status = status
  if (typeId) where.typeId = typeId
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName:  { contains: search, mode: "insensitive" } },
      { email:     { contains: search, mode: "insensitive" } },
    ]
  }

  const orderBy = [{ lastName: "asc" as const }, { firstName: "asc" as const }]

  const include = { type: { select: { id: true, name: true, color: true } } }

  if (!searchParams.has("page")) {
    const data = await prisma.membre.findMany({ where, orderBy, include })
    return NextResponse.json(data)
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.membre.findMany({ where, orderBy, skip, take: limit, include }),
    prisma.membre.count({ where }),
  ])
  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
}

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const parsed = membreSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { birthDate, email, phone, address, typeId, ...rest } = parsed.data
  const [membre, assoc] = await Promise.all([
    prisma.membre.create({
      data: {
        ...rest,
        associationId,
        email:     email     || null,
        phone:     phone     || null,
        address:   address   || null,
        typeId:    typeId    || null,
        birthDate: birthDate ? new Date(birthDate + "T12:00:00") : null,
      },
    }),
    prisma.association.findUnique({ where: { id: associationId }, select: { name: true } }),
  ])

  if (membre.email && assoc) {
    const portalUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/portal`
    sendEmail(welcomeEmail({
      firstName:       membre.firstName,
      email:           membre.email,
      associationName: assoc.name,
      hasPortalAccess: !!membre.userId,
      portalUrl,
    })).catch(() => {})
  }

  await writeActivityLog({ associationId, actorId: userId, action: "MEMBRE_CREATED", entity: "Membre", entityId: membre.id, label: `${membre.firstName} ${membre.lastName}` })

  return NextResponse.json(membre, { status: 201 })
}
