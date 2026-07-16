import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { customEmail } from "@/lib/email"
import { substituteVars, buildVars } from "@/lib/automation"
import type { SessionUser } from "@/lib/user-context"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveDocumentBranding } from "@/lib/plan-limits"

const ALLOWED_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const template = await prisma.messageTemplate.findFirst({
    where:   { id, associationId },
    include: { association: { select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true } } },
  })
  if (!template) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const session = await auth()
  const u = session?.user as SessionUser | undefined

  const adminEmail = u?.email
  if (!adminEmail) return NextResponse.json({ error: "Email admin introuvable" }, { status: 400 })

  const vars = buildVars({
    prenom:            u?.name?.split(" ")[0] ?? "Prénom",
    nom:               u?.name?.split(" ").slice(1).join(" ") ?? "Nom",
    email:             adminEmail,
    association:       template.association.name,
    slug:              template.association.slug,
    anneeCotisation:   new Date().getFullYear(),
    montantCotisation: "50",
    titreEvenement:    "Événement de test",
    dateEvenement:     new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
    lieuEvenement:     "Salle des fêtes",
  })

  const subject  = `[TEST] ${substituteVars(template.subject, vars)}`
  const bodyHtml = substituteVars(template.body, vars)

  await sendEmail(customEmail({
    associationName: template.association.name,
    subject,
    bodyHtml,
    recipientEmail:  adminEmail,
    branding:        resolveDocumentBranding(template.association),
  }), { associationId, source: "TEST", sourceId: id })

  return NextResponse.json({ ok: true, sentTo: adminEmail })
}, { roles: ALLOWED_ROLES, module: "messages" })
