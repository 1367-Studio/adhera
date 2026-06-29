import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import bcrypt from "bcryptjs"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { invitationEmail } from "@/lib/email"
import { sendSms, welcomeSms } from "@/lib/sms"
import { parseSmsSettings } from "@/lib/sms-settings"
import { membreCreateSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { APP_URL } from "@/lib/env"

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

  const include = {
    type: { select: { id: true, name: true, color: true } },
    user: { select: { role: true } },
  }

  if (!searchParams.has("page")) {
    const data = await prisma.membre.findMany({ where, orderBy, include, take: 500 })
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
  const { associationId, role: actorRole, userId } = ctx

  if (!MANAGERS.includes(actorRole)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const parsed = membreCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { birthDate, email, phone, address, typeId, role = "MEMBRE", ...rest } = parsed.data

  if (role === "ADMIN" && actorRole !== "ADMIN") {
    return NextResponse.json({ error: "Seul un administrateur peut attribuer le rôle admin" }, { status: 403 })
  }

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, slug: true, smsSettings: true },
  })

  const membreData = {
    ...rest,
    associationId,
    email:     email     || null,
    phone:     phone     || null,
    address:   address   || null,
    typeId:    typeId    || null,
    birthDate: birthDate ? new Date(birthDate + "T12:00:00") : null,
  }

  const existing = await prisma.user.findFirst({ where: { email: email.toLowerCase(), associationId } })
  if (existing) {
    return NextResponse.json({ error: "Un compte existe déjà avec cet email dans cette association" }, { status: 409 })
  }

  const plainPassword = randomBytes(6).toString("hex")
  const passwordHash  = await bcrypt.hash(plainPassword, 12)

  const membre = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email:         email.toLowerCase(),
        name:          `${rest.firstName} ${rest.lastName}`,
        passwordHash,
        role:          role as "ADMIN" | "PRESIDENT" | "TRESORIER" | "SECRETAIRE" | "MEMBRE",
        associationId,
      },
    })
    return tx.membre.create({ data: { ...membreData, userId: user.id } })
  })

  if (assoc) {
    const isStaff  = role !== "MEMBRE"
    const loginUrl = isStaff
      ? `${APP_URL}/login`
      : `${APP_URL}/portal/${assoc.slug}/login`

    sendEmail(invitationEmail({
      firstName:       membre.firstName,
      email:           email.toLowerCase(),
      password:        plainPassword,
      associationName: assoc.name,
      role,
      loginUrl,
    })).catch(() => {})

    const smsConfig = parseSmsSettings(assoc.smsSettings)
    if (smsConfig.memberWelcome && role === "MEMBRE" && membre.phone) {
      sendSms(membre.phone, welcomeSms({
        firstName:       membre.firstName,
        associationName: assoc.name,
      })).catch(() => {})
    }
  }

  await writeActivityLog({ associationId, actorId: userId, action: "MEMBRE_CREATED", entity: "Membre", entityId: membre.id, label: `${membre.firstName} ${membre.lastName}` })

  return NextResponse.json(membre, { status: 201 })
}
