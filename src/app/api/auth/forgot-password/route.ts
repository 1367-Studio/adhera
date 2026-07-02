import { NextResponse } from "next/server"
import crypto from "crypto"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { passwordResetEmail } from "@/lib/email"
import { APP_URL } from "@/lib/env"

const TOKEN_TTL_MS = 60 * 60 * 1000  // 1 hour
const COOLDOWN_MS  = 2 * 60 * 1000   // 2 minutes

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const email = typeof body?.email === "string" ? body.email.toLowerCase().trim() : ""
  if (!email) return NextResponse.json({ error: "Email requis" }, { status: 422 })

  // Run both queries in parallel to prevent timing attacks
  const [users, existing] = await Promise.all([
    prisma.user.findMany({
      where:   { email, deletedAt: null, active: true },
      include: { association: { select: { name: true } } },
    }),
    prisma.passwordResetToken.findFirst({
      where:   { email },
      orderBy: { createdAt: "desc" },
    }),
  ])

  const tooSoon = existing && Date.now() - existing.createdAt.getTime() < COOLDOWN_MS

  // Always return 200 — never reveal if email exists or if there's a cooldown
  if (users.length === 0 || tooSoon) return NextResponse.json({ ok: true })

  await prisma.passwordResetToken.deleteMany({ where: { email } })

  // `email` is only unique *per association* (@@unique([email, associationId])), so the
  // same address can legitimately belong to unrelated accounts in different associations.
  // Issue one token per account (each resolves to exactly that account, never an arbitrary
  // pick) and name the association in each email so the recipient resets the right one.
  for (const user of users) {
    const token = crypto.randomBytes(32).toString("hex")
    await prisma.passwordResetToken.create({
      data: {
        email,
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    })

    const resetUrl     = `${APP_URL}/reset-password?token=${token}`
    const accountLabel = user.association?.name ?? "votre compte administrateur"
    Promise.resolve().then(async () => {
      await sendEmail(passwordResetEmail({ email, resetUrl, accountLabel }))
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
