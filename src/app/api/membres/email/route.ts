import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { sendEmailBulk } from "@/lib/mail"
import { customEmail } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { buildVars, substituteVars } from "@/lib/automation"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const schema = z.object({
  subject:        z.string().min(1).max(200),
  bodyHtml:       z.string().min(1),
  recipientIds:   z.array(z.string()).optional(),
  typeId:         z.string().optional(),
  externalEmails: z.array(z.string().email()).max(100).optional(),
})

export const POST = withAdminAuth(async (req, ctx) => {
  if (!MANAGERS.includes(ctx.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 })

  const { subject, bodyHtml, recipientIds, typeId, externalEmails = [] } = parsed.data

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const membres = await prisma.membre.findMany({
    where: {
      associationId: ctx.associationId,
      deletedAt:     null,
      status:        "ACTIF",
      email:         { not: null },
      // recipientIds is only sent (possibly empty) for "manual" mode — an empty array there
      // must mean "no members", not "no filter" (which would silently fall back to everyone).
      ...(recipientIds !== undefined ? { id: { in: recipientIds } } : {}),
      ...(typeId ? { typeId } : {}),
    },
    select: { id: true, firstName: true, lastName: true, email: true },
    take:   500,
  })

  const recipients = membres.filter(m => m.email)
  const branding = resolveDocumentBranding(assoc)

  // An external address that happens to match a member already covered by this send would
  // otherwise get the message twice — once personalized, once with blank name variables.
  // Dedupe against the actual member recipient list, which is the source of truth regardless
  // of recipient mode (unlike trying to replicate this client-side for "all"/"type" modes,
  // where the client never has the full member list to compare against).
  const memberEmailSet = new Set(recipients.map(m => m.email!.toLowerCase()))
  const uniqueExternalEmails = [...new Set(externalEmails.map(e => e.toLowerCase()))]
    .filter(e => !memberEmailSet.has(e))
  const skippedDuplicateExternalCount = externalEmails.length - uniqueExternalEmails.length

  const memberPayloads = recipients.map(m => {
    const vars = buildVars({ prenom: m.firstName, nom: m.lastName, email: m.email!, association: assoc.name, slug: assoc.slug })
    return {
      ...customEmail({
        associationName: assoc.name,
        subject:         substituteVars(subject, vars),
        bodyHtml:        substituteVars(bodyHtml, vars),
        recipientEmail:  m.email!,
        branding,
      }),
      context: { associationId: ctx.associationId, membreId: m.id, source: "BULK_MESSAGE" },
    }
  })

  // External recipients have no Membre record — name variables ({{prenom}}, {{nom}}, {{nom_complet}})
  // resolve to empty strings for them. The compose UI warns about this before sending.
  const externalPayloads = uniqueExternalEmails.map(email => {
    const vars = buildVars({ prenom: "", nom: "", email, association: assoc.name, slug: assoc.slug })
    return {
      ...customEmail({
        associationName: assoc.name,
        subject:         substituteVars(subject, vars),
        bodyHtml:        substituteVars(bodyHtml, vars),
        recipientEmail:  email,
        branding,
      }),
      context: { associationId: ctx.associationId, source: "BULK_MESSAGE" },
    }
  })

  const { sent, failed, failedRecipients } = await sendEmailBulk([...memberPayloads, ...externalPayloads])
  const failedEmails = new Set(failedRecipients)
  const failedMembers = recipients
    .filter(m => failedEmails.has(m.email!))
    .map(m => ({ id: m.id, name: `${m.firstName} ${m.lastName}` }))
  const failedExternal = uniqueExternalEmails
    .filter(email => failedEmails.has(email))
    .map(email => ({ id: email, name: email }))

  const recipientMode = recipientIds !== undefined ? "manual" : typeId ? "type" : "all"
  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "EMAIL_SENT_BULK",
    entity:        "Membre",
    label:         subject,
    metadata:      {
      sent,
      failed,
      recipientMode,
      ...(typeId                    ? { typeId }                                     : {}),
      ...(recipientIds              ? { recipientCount: recipientIds.length }         : {}),
      ...(uniqueExternalEmails.length ? { externalEmailCount: uniqueExternalEmails.length, externalEmails: uniqueExternalEmails } : {}),
    },
  })

  return NextResponse.json({
    sent,
    failed,
    failedMembers: [...failedMembers, ...failedExternal],
    skippedDuplicateExternalCount,
  })
}, { module: "messages" })
