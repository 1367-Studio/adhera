import { NextResponse } from "next/server"
import { z } from "zod"
import { getTranslations } from "next-intl/server"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { toSlug } from "@/lib/slug"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

const actionSchema = z.object({
  action: z.enum(["publish", "unpublish", "archive", "duplicate"]),
})

async function generateFormSlug(associationId: string, title: string): Promise<string> {
  const base = toSlug(title) || "adhesion"
  let slug    = base
  let attempt = 0
  while (await prisma.membershipForm.findFirst({ where: { associationId, slug }, select: { id: true } })) {
    slug = `${base}-${++attempt}`
  }
  return slug
}

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const form = await prisma.membershipForm.findFirst({
    where:   { id, associationId: ctx.associationId },
    include: { tiers: true, customFields: true },
  })
  if (!form) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = actionSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { action } = parsed.data

  // A published form with no tiers renders a public page with nothing to choose and a
  // permanently-disabled submit button — no error, no explanation, just a dead end for the
  // visitor. Catch it here instead of at the worst possible time (someone already on the page).
  if (action === "publish" && form.tiers.length === 0)
    return NextResponse.json({ error: "Ajoutez au moins un tarif avant de publier ce formulaire." }, { status: 422 })

  // A form can be saved with visibility SITE while still DRAFT (the PATCH route's own
  // same-section conflict check only fires once a form is already PUBLISHED) — so re-check
  // here at the moment it actually goes live, otherwise two forms could end up published on
  // the same site section simply by publishing in the "wrong" order.
  if (action === "publish" && form.visibility === "SITE" && form.siteSectionId) {
    const conflict = await prisma.membershipForm.findFirst({
      where:  { associationId: ctx.associationId, id: { not: id }, status: "PUBLISHED", visibility: "SITE", siteSectionId: form.siteSectionId },
      select: { title: true },
    })
    if (conflict)
      return NextResponse.json({ error: `Cette section est déjà utilisée par le formulaire publié « ${conflict.title} ». Choisissez une autre section ou dépubliez l'autre formulaire.` }, { status: 409 })
  }

  if (action === "duplicate") {
    const t     = await getTranslations("membershipForms")
    const title = `${form.title} ${t("duplicateSuffix")}`
    const slug  = await generateFormSlug(ctx.associationId, title)

    const copy = await prisma.membershipForm.create({
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
        validationMode:        form.validationMode,
        fieldAddress:          form.fieldAddress,
        fieldBirthDate:        form.fieldBirthDate,
        fieldPhone:            form.fieldPhone,
        fieldMobile:           form.fieldMobile,
        fieldGender:           form.fieldGender,
        allowCash:             form.allowCash,
        allowCheque:           form.allowCheque,
        allowTransfer:         form.allowTransfer,
        offlineInstructions:   form.offlineInstructions,
        confirmationMessage:   form.confirmationMessage,
        visibility:            "LINK",
        tiers: {
          create: form.tiers.map(t => ({
            order: t.order, kind: t.kind, free: t.free, freeAmount: t.freeAmount, amount: t.amount,
            label: t.label, membreTypeId: t.membreTypeId,
          })),
        },
        customFields: {
          create: form.customFields.map(f => ({
            type: f.type, label: f.label, required: f.required, order: f.order,
          })),
        },
      },
    })

    await writeActivityLog({
      associationId: ctx.associationId,
      actorId:       ctx.userId,
      action:        "MEMBERSHIP_FORM_DUPLICATED",
      entity:        "MembershipForm",
      entityId:      copy.id,
      label:         copy.title,
    })

    return NextResponse.json(copy, { status: 201 })
  }

  const status = action === "publish" ? "PUBLISHED" : action === "unpublish" ? "DRAFT" : "ARCHIVED"

  const updated = await prisma.membershipForm.update({
    where: { id },
    data:  { status },
    include: { _count: { select: { cotisations: true } } },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        `MEMBERSHIP_FORM_${status}`,
    entity:        "MembershipForm",
    entityId:      id,
    label:         form.title,
  })

  return NextResponse.json(updated)
}, { module: "cotisations" })
