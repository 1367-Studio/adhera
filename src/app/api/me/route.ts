import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { writeActivityLog, computeDiff } from "@/lib/activity-log"

type SessionUser = { id?: string; associationId?: string | null }

const profileSchema = z.object({
  name:  z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email("Email invalide").optional(),
})

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(8, "Min. 8 caractères"),
})

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  const user = await prisma.user.findUnique({
    where:  { id: u.id! },
    select: { id: true, name: true, email: true, role: true },
  })
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(user)
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u    = session.user as SessionUser
  const body = await req.json()

  // Profile update
  if ("name" in body || "email" in body) {
    const parsed = profileSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 422 })
    }
    const { name, email } = parsed.data

    if (email) {
      const conflict = await prisma.user.findFirst({ where: { email, associationId: u.associationId ?? null, id: { not: u.id! } } })
      if (conflict) {
        return NextResponse.json({ field: "email", error: "Cet email est déjà utilisé." }, { status: 409 })
      }
    }

    const before = await prisma.user.findUnique({ where: { id: u.id! }, select: { name: true, email: true } })

    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: u.id! },
        data:  { ...(name ? { name } : {}), ...(email ? { email } : {}) },
      })

      if (email) {
        await tx.membre.updateMany({
          where: { userId: u.id!, deletedAt: null },
          data:  { email },
        })
      }

      return updated
    })

    // Self-service edit — the only path where User.name/email can drift from the linked
    // Membre's own firstName/lastName/email without an admin-side MEMBRE_UPDATED log, so
    // this is the one place that trail would otherwise be invisible.
    if (u.associationId && before) {
      const changes = computeDiff(before, user, ["name", "email"])
      if (Object.keys(changes).length > 0) {
        await writeActivityLog({
          associationId: u.associationId, actorId: u.id!, action: "PROFILE_UPDATED",
          entity: "User", entityId: u.id!, label: user.name ?? user.email, metadata: { changes },
        })
      }
    }

    return NextResponse.json(user)
  }

  // Password change
  if ("currentPassword" in body && "newPassword" in body) {
    const parsed = passwordSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return NextResponse.json({ field: issue?.path[0], error: issue?.message }, { status: 400 })
    }
    const { currentPassword, newPassword } = parsed.data

    const user = await prisma.user.findUnique({ where: { id: u.id! } })
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const valid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ field: "currentPassword", error: "Mot de passe actuel incorrect." }, { status: 400 })
    }

    const hash = await bcrypt.hash(newPassword, 12)
    await prisma.user.update({ where: { id: u.id! }, data: { passwordHash: hash } })

    if (u.associationId) {
      await writeActivityLog({
        associationId: u.associationId, actorId: u.id!, action: "PASSWORD_CHANGED",
        entity: "User", entityId: u.id!, label: user.name ?? user.email,
      })
    }

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "Invalid request" }, { status: 400 })
}
