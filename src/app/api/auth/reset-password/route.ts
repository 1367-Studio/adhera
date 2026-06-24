import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma/client"

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { token, password } = body ?? {}

  if (!token || !password) {
    return NextResponse.json({ error: "Données manquantes" }, { status: 422 })
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ field: "password", error: "Min. 8 caractères." }, { status: 422 })
  }

  const record = await prisma.passwordResetToken.findUnique({ where: { token } })
  if (!record) {
    return NextResponse.json({ error: "Lien invalide ou expiré." }, { status: 400 })
  }
  if (record.expiresAt < new Date()) {
    await prisma.passwordResetToken.delete({ where: { token } })
    return NextResponse.json({ error: "Ce lien a expiré. Demandez-en un nouveau." }, { status: 400 })
  }

  const user = await prisma.user.findFirst({ where: { email: record.email, deletedAt: null } })
  if (!user) {
    return NextResponse.json({ error: "Compte introuvable." }, { status: 400 })
  }

  const passwordHash = await bcrypt.hash(password, 12)
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.passwordResetToken.delete({ where: { token } }),
  ])

  return NextResponse.json({ ok: true })
}
