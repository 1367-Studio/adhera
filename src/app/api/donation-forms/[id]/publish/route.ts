import { NextResponse } from "next/server"
import { z } from "zod"
import { getTranslations } from "next-intl/server"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { isTermsConfigurationValid } from "@/lib/form-terms"
import { storedTermsAttachments, termsContentRequiredResponse } from "@/lib/form-terms-response"
import { toSlug } from "@/lib/slug"
import { revalidatePublicSiteFor } from "@/lib/association/revalidate-site"
import { displaceDonationFormsFromSiteSection } from "@/lib/dons/site-section-binding"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

const actionSchema = z.object({
  action: z.enum(["publish", "unpublish", "archive", "duplicate"]),
})

async function generateFormSlug(associationId: string, title: string): Promise<string> {
  const base = toSlug(title) || "don"
  let slug    = base
  let attempt = 0
  while (await prisma.donationForm.findFirst({ where: { associationId, slug }, select: { id: true } })) {
    slug = `${base}-${++attempt}`
  }
  return slug
}

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const form = await prisma.donationForm.findFirst({
    where:   { id, associationId: ctx.associationId },
    include: { tiers: true, customFields: true },
  })
  if (!form) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = actionSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { action } = parsed.data

  // Never put online a form that demands acceptance of nothing (saved before the rule, or
  // through a direct API call).
  if (action === "publish" && !isTermsConfigurationValid({
    conditions:           form.conditions,
    attachments:          storedTermsAttachments(form.attachments),
    requireCguvSignature: form.requireCguvSignature,
  }))
    return termsContentRequiredResponse()

  // A published form with no tiers renders a public page with an empty amount grid and a
  // permanently-disabled submit button — no error, no explanation, just a dead end for the
  // donor. Catch it here instead of at the worst possible time (a donor already on the page).
  if (action === "publish" && form.tiers.length === 0)
    return NextResponse.json({ error: "Ajoutez au moins un palier avant de publier ce formulaire." }, { status: 422 })

  if (action === "duplicate") {
    const t     = await getTranslations("donationForms")
    const title = `${form.title} ${t("duplicateSuffix")}`
    const slug  = await generateFormSlug(ctx.associationId, title)

    const copy = await prisma.donationForm.create({
      data: {
        associationId:        ctx.associationId,
        title,
        slug,
        status:                "DRAFT",
        imageUrl:              form.imageUrl,
        description:           form.description,
        conditions:            form.conditions,
        attachments:           form.attachments ?? undefined,
        requireCguvSignature:  form.requireCguvSignature,
        contactEmail:          form.contactEmail,
        contactPhone:          form.contactPhone,
        fieldAddress:          form.fieldAddress,
        fieldBirthDate:        form.fieldBirthDate,
        fieldPhone:            form.fieldPhone,
        fieldMobile:           form.fieldMobile,
        fieldGender:           form.fieldGender,
        allowOnline:           form.allowOnline,
        allowCash:             form.allowCash,
        allowCheque:           form.allowCheque,
        allowTransfer:         form.allowTransfer,
        offlineInstructions:   form.offlineInstructions,
        confirmationMessage:   form.confirmationMessage,
        visibility:            "LINK",
        tiers: {
          create: form.tiers.map(t => ({
            order: t.order, kind: t.kind, freeAmount: t.freeAmount, amount: t.amount,
            interval: t.interval, label: t.label, receiptMode: t.receiptMode, ineligibleAmount: t.ineligibleAmount,
          })),
        },
        customFields: {
          create: form.customFields.map(f => ({
            type: f.type, label: f.label, required: f.required, order: f.order, options: f.options ?? undefined,
          })),
        },
      },
    })

    await writeActivityLog({
      associationId: ctx.associationId,
      actorId:       ctx.userId,
      action:        "DONATION_FORM_DUPLICATED",
      entity:        "DonationForm",
      entityId:      copy.id,
      label:         copy.title,
    })

    return NextResponse.json(copy, { status: 201 })
  }

  const status = action === "publish" ? "PUBLISHED" : action === "unpublish" ? "DRAFT" : "ARCHIVED"

  // Archiving also takes the form off its site section, so republishing it later never
  // silently reclaims a section another form now occupies. A PRIVATE form keeps PRIVATE —
  // only a SITE form falls back to LINK.
  const archiveData = action === "archive"
    ? (form.visibility === "SITE" ? { visibility: "LINK" as const, siteSectionId: null } : { siteSectionId: null })
    : {}

  const updated = await prisma.$transaction(async (tx) => {
    // Publishing a form bound to a section replaces whichever form was there (back to LINK,
    // still published) — one published form per section, enforced by replacing, never
    // blocking.
    if (action === "publish" && form.visibility === "SITE" && form.siteSectionId)
      await displaceDonationFormsFromSiteSection(tx, { associationId: ctx.associationId, siteSectionId: form.siteSectionId, keepFormId: id })
    return tx.donationForm.update({
      where:   { id },
      data:    { status, ...archiveData },
      include: { _count: { select: { dons: true, subscriptions: true } } },
    })
  })

  // The public site page is statically cached — publishing, unpublishing or archiving can all
  // change what its "dons" blocks show.
  await revalidatePublicSiteFor(ctx.associationId)

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        `DONATION_FORM_${status}`,
    entity:        "DonationForm",
    entityId:      id,
    label:         form.title,
  })

  return NextResponse.json(updated)
}, { module: "dons" })
