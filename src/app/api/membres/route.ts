import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import bcrypt from "bcryptjs"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { invitationEmail } from "@/lib/email"
import { fireEventRule } from "@/lib/fire-event-rule"
import { membreCreateSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { APP_URL } from "@/lib/env"
import { assertMemberLimit, MemberLimitReachedError, resolveDocumentBranding } from "@/lib/plan-limits"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const GET = withAdminAuth(async (req, ctx) => {
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
}, { roles: MANAGERS })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, role: actorRole, userId } = ctx

  const body = await req.json()
  const parsed = membreCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { birthDate, email, phone, address, typeId, civilite, groupeSanguin, allergies, role = "MEMBRE", ...rest } = parsed.data

  if (role === "ADMIN" && actorRole !== "ADMIN") {
    return NextResponse.json({ error: "Seul un administrateur peut attribuer le rôle admin" }, { status: 403 })
  }

  try {
    await assertMemberLimit(associationId)
  } catch (err) {
    if (err instanceof MemberLimitReachedError) return NextResponse.json({ error: err.message, code: err.code }, { status: 422 })
    throw err
  }

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, slug: true, modules: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
  })

  const membreData = {
    ...rest,
    associationId,
    email:         email         || null,
    phone:         phone         || null,
    address:       address       || null,
    typeId:        typeId        || null,
    civilite:      civilite      || null,
    groupeSanguin: groupeSanguin || null,
    allergies:     allergies     || null,
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
      branding:        resolveDocumentBranding(assoc),
    }), { associationId, membreId: membre.id, source: "MEMBER_INVITE" }).catch(() => {})

    if (role === "MEMBRE") {
      fireEventRule({
        triggerType:   "MEMBER_CREATED",
        associationId,
        association:   { name: assoc.name, slug: assoc.slug, modules: assoc.modules, plan: assoc.plan, customBrandingEnabled: assoc.customBrandingEnabled, logoUrl: assoc.logoUrl, primaryColor: assoc.primaryColor },
        membre:        { id: membre.id, firstName: membre.firstName, lastName: membre.lastName, email: membre.email, phone: membre.phone },
      }).catch(() => {})
    }
  }

  await writeActivityLog({ associationId, actorId: userId, action: "MEMBRE_CREATED", entity: "Membre", entityId: membre.id, label: `${membre.firstName} ${membre.lastName}` })

  return NextResponse.json(membre, { status: 201 })
}, { roles: MANAGERS })
