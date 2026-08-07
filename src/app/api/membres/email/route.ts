import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { inngest } from "@/lib/inngest"
import { resolveDocumentBranding } from "@/lib/plan-limits"

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

  const recipientMode = recipientIds !== undefined ? "manual" : typeId ? "type" : "all"
  const jobId = randomUUID()

  await inngest.send({
    name: "bulk/membres-email.requested",
    data: {
      jobId,
      associationId: ctx.associationId,
      actorId:       ctx.userId,
      subject,
      bodyHtml,
      branding,
      associationName: assoc.name,
      slug:             assoc.slug,
      members:          recipients.map(m => ({ id: m.id, firstName: m.firstName, lastName: m.lastName, email: m.email! })),
      externalEmails:   uniqueExternalEmails,
      activityMeta: {
        recipientMode,
        ...(typeId                      ? { typeId }                                                                       : {}),
        ...(recipientIds                ? { recipientCount: recipientIds.length }                                          : {}),
        ...(uniqueExternalEmails.length ? { externalEmailCount: uniqueExternalEmails.length, externalEmails: uniqueExternalEmails } : {}),
      },
    },
  })

  return NextResponse.json({
    jobId,
    totalRecipients: recipients.length + uniqueExternalEmails.length,
    skippedDuplicateExternalCount,
  })
}, { module: "messages" })
