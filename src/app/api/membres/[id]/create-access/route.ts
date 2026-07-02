import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import bcrypt from "bcryptjs"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { invitationEmail } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { APP_URL } from "@/lib/env"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

// Members created via public self-registration (or imported without an account) have
// `userId: null` and can never log in — this gives an admin a way to grant portal access
// after the fact instead of the only option being delete-and-recreate the member.
export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const membre = await prisma.membre.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })
  if (membre.userId) return NextResponse.json({ error: "Ce membre a déjà un accès" }, { status: 409 })
  if (!membre.email) return NextResponse.json({ error: "Cet membre n'a pas d'email renseigné" }, { status: 422 })

  const conflict = await prisma.user.findFirst({
    where: { email: membre.email, associationId, deletedAt: null },
  })
  if (conflict) return NextResponse.json({ error: "Un compte existe déjà avec cet email" }, { status: 409 })

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, slug: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const plainPassword = randomBytes(6).toString("hex")
  const passwordHash  = await bcrypt.hash(plainPassword, 12)
  const email          = membre.email

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name:          `${membre.firstName} ${membre.lastName}`,
        passwordHash,
        role:          "MEMBRE",
        associationId,
      },
    })
    await tx.membre.update({ where: { id }, data: { userId: user.id, status: "ACTIF" } })
  })

  sendEmail(invitationEmail({
    firstName:       membre.firstName,
    email,
    password:        plainPassword,
    associationName: assoc.name,
    role:            "MEMBRE",
    loginUrl:        `${APP_URL}/portal/${assoc.slug}/login`,
  })).catch(() => {})

  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "MEMBRE_ACCESS_CREATED",
    entity:   "Membre",
    entityId: id,
    label:    `${membre.firstName} ${membre.lastName}`,
  })

  return NextResponse.json({ ok: true })
}, { roles: MANAGERS })
