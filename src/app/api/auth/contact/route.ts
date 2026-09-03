import { NextResponse } from "next/server"
import { sendEmail } from "@/lib/mail"
import { contactSupportEmail } from "@/lib/email"
import { rateLimit, requestIp } from "@/lib/rate-limit"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MESSAGE_MAX_LENGTH = 5000

// Unauthenticated — reachable from the "Contactar o suporte" dialog on every auth page
// (login/register/forgot-password/reset-password), so rate-limited by IP rather than by
// account like the authenticated support-ticket flow (src/lib/support-tickets.ts).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const name    = typeof body?.name === "string" ? body.name.trim() : ""
  const email   = typeof body?.email === "string" ? body.email.toLowerCase().trim() : ""
  const message = typeof body?.message === "string" ? body.message.trim() : ""

  if (!name || !email || !message) {
    return NextResponse.json({ error: "Champs requis manquants" }, { status: 422 })
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Adresse email invalide" }, { status: 422 })
  }
  if (message.length > MESSAGE_MAX_LENGTH) {
    return NextResponse.json({ error: "Message trop long" }, { status: 422 })
  }

  const ip = requestIp(req)
  const allowed = await rateLimit(`auth-contact:${ip}`, 5, 10 * 60 * 1000)
  if (!allowed) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard" }, { status: 429 })
  }

  const supportEmail = process.env.SUPPORT_TEAM_EMAIL
  if (!supportEmail) {
    console.error("[auth/contact] SUPPORT_TEAM_EMAIL is not configured — message not sent")
    return NextResponse.json({ error: "Envoi indisponible" }, { status: 503 })
  }

  await sendEmail(contactSupportEmail({ to: supportEmail, name, email, message }))

  return NextResponse.json({ ok: true })
}
