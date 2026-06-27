import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { substituteVars, buildVars } from "@/lib/automation"
import type { SessionUser } from "@/lib/user-context"
import { guardModule } from "@/lib/auth/require-module"

const ALLOWED_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const u = session?.user as SessionUser | undefined
  if (!u?.associationId || !ALLOWED_ROLES.includes(u.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const guard = await guardModule(u.associationId, "messages")
  if (guard) return guard

  const { id } = await params
  const rule = await prisma.automationRule.findFirst({
    where:   { id, associationId: u.associationId },
    include: {
      template:    true,
      association: { select: { name: true, slug: true } },
    },
  })
  if (!rule) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const adminEmail = u.email
  if (!adminEmail) return NextResponse.json({ error: "Email admin introuvable" }, { status: 400 })

  const vars = buildVars({
    prenom:             u.name?.split(" ")[0] ?? "Prénom",
    nom:                u.name?.split(" ").slice(1).join(" ") ?? "Nom",
    email:              adminEmail,
    association:        rule.association.name,
    slug:               rule.association.slug,
    anneeCotisation:    new Date().getFullYear(),
    montantCotisation:  "50",
    titreEvenement:     "Événement de test",
    dateEvenement:      new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
    lieuEvenement:      "Salle des fêtes",
  })

  const subject = `[TEST] ${substituteVars(rule.template.subject, vars)}`
  const html    = substituteVars(rule.template.body, vars)

  await sendEmail({ to: adminEmail, subject, html })

  return NextResponse.json({ ok: true, sentTo: adminEmail })
}
