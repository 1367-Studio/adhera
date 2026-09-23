import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { inngest } from "@/lib/inngest"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { EMAIL_ATTACHMENT_ERRORS, MAX_EMAIL_ATTACHMENTS_COUNT, verifyEmailAttachments } from "@/lib/email-attachments"
import { SUPPORTED_LOCALES } from "@/i18n/locales"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const schema = z.object({
  subject:        z.string().min(1).max(200),
  bodyHtml:       z.string().min(1),
  recipientIds:   z.array(z.string()).optional(),
  typeId:         z.string().optional(),
  externalEmails: z.array(z.string().email()).max(100).optional(),
  // Keys handed out by ./attachments/route.ts after the browser uploaded each file to R2.
  attachments:    z.array(z.object({
    key:      z.string(),
    filename: z.string().min(1).max(255),
  })).max(MAX_EMAIL_ATTACHMENTS_COUNT, EMAIL_ATTACHMENT_ERRORS.tooMany).optional(),
  // When true, subject/bodyHtml are treated as the source (French) version and each member
  // gets it auto-translated into their own Membre.preferredLocale — see bulkSendMembresEmail's
  // "translate" step. External emails have no Membre record, so they always get the source.
  autoLocalize:   z.boolean().optional(),
  // Locales the admin already reviewed/edited in SendEmailModal's auto-preview dialog — sent
  // as-is instead of being re-translated server-side. Only meaningful alongside autoLocalize.
  translationOverrides: z.record(z.enum(SUPPORTED_LOCALES), z.object({
    subject:  z.string().min(1).max(200),
    bodyHtml: z.string().min(1),
  })).optional(),
})

export const POST = withAdminAuth(async (req, ctx) => {
  if (!MANAGERS.includes(ctx.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const body   = await req.json().catch(() => null)
  // Only the attachment count carries its own message; every other failure keeps the
  // generic one (rather than zod's English defaults).
  const parsed = schema.safeParse(body, { error: () => "Données invalides" })
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 400 })

  const { subject, bodyHtml, recipientIds, typeId, externalEmails = [], attachments = [], autoLocalize = false, translationOverrides } = parsed.data

  // Checked before anything is queued: a missing, oversized or disguised file must fail the
  // request the admin is looking at, not surface later as a background job failure.
  const attachmentCheck = await verifyEmailAttachments(ctx.associationId, attachments)
  if (!attachmentCheck.ok) return NextResponse.json({ error: attachmentCheck.error }, { status: attachmentCheck.status })
  const verifiedAttachments = attachmentCheck.attachments

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true },
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
    select: { id: true, firstName: true, lastName: true, email: true, preferredLocale: true },
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

  // Queuing depends on Inngest: INNGEST_EVENT_KEY in production, INNGEST_DEV=1 plus the Inngest
  // dev server locally (see .env.example). When it's unavailable the admin should get a real
  // message, not Next's HTML 500 (which the modal can't parse).
  try {
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
        members: recipients.map(m => ({
          id:              m.id,
          firstName:       m.firstName,
          lastName:        m.lastName,
          email:           m.email!,
          preferredLocale: m.preferredLocale,
        })),
        externalEmails:   uniqueExternalEmails,
        autoLocalize,
        ...(translationOverrides && Object.keys(translationOverrides).length ? { translationOverrides } : {}),
        ...(verifiedAttachments.length ? { attachments: verifiedAttachments } : {}),
        activityMeta: {
          recipientMode,
          ...(typeId                      ? { typeId }                                                                       : {}),
          ...(recipientIds                ? { recipientCount: recipientIds.length }                                          : {}),
          ...(uniqueExternalEmails.length ? { externalEmailCount: uniqueExternalEmails.length, externalEmails: uniqueExternalEmails } : {}),
          ...(verifiedAttachments.length  ? { attachmentCount: verifiedAttachments.length, attachmentNames: verifiedAttachments.map(attachment => attachment.filename) } : {}),
          ...(autoLocalize                ? { autoLocalize: true }                                                           : {}),
        },
      },
    })
  } catch (error: unknown) {
    console.error("[membres/email] failed to queue bulk send:", error)
    return NextResponse.json({ error: "Impossible de lancer l'envoi pour le moment. Veuillez réessayer." }, { status: 503 })
  }

  return NextResponse.json({
    jobId,
    totalRecipients: recipients.length + uniqueExternalEmails.length,
    skippedDuplicateExternalCount,
  })
}, { module: "messages" })
