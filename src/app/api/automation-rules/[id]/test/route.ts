import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { substituteVars, buildVars } from "@/lib/automation"
import type { SessionUser } from "@/lib/user-context"
import { withAdminAuth } from "@/lib/api-wrapper"

const ALLOWED_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const rule = await prisma.automationRule.findFirst({
    where:   { id, associationId },
    include: {
      template:    true,
      association: { select: { name: true, slug: true } },
    },
  })
  if (!rule) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const session = await auth()
  const u = session?.user as SessionUser | undefined

  const adminEmail = u?.email
  if (!adminEmail) return NextResponse.json({ error: "Email admin introuvable" }, { status: 400 })

  const vars = buildVars({
    prenom:             u?.name?.split(" ")[0] ?? "Prénom",
    nom:                u?.name?.split(" ").slice(1).join(" ") ?? "Nom",
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
}, { roles: ALLOWED_ROLES, module: "messages" })
