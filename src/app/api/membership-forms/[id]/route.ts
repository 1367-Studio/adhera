import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

// Étapes 1/3/5 du wizard — les tarifs (étape 2) arrivent avec MembershipTier et
// allowCash/... (étape 4) sont ici même (pas de sous-ressource dédiée, contrairement aux tiers).
const updateSchema = z.object({
  title:                z.string().trim().min(1).max(200).optional(),
  imageUrl:             z.string().url().optional().nullable(),
  description:          z.string().max(20000).optional().nullable(),
  conditions:           z.string().max(20000).optional().nullable(),
  attachments:          z.array(z.object({ url: z.string(), filename: z.string(), size: z.number() })).optional().nullable(),
  requireCguvSignature: z.boolean().optional(),
  contactEmail:         z.string().email().optional().nullable(),
  contactPhone:         z.string().max(30).optional().nullable(),
  validationMode:       z.enum(["IMMEDIATE", "REQUEST"]).optional(),

  fieldAddress:   z.enum(["HIDDEN", "OPTIONAL", "REQUIRED"]).optional(),
  fieldBirthDate: z.enum(["HIDDEN", "OPTIONAL", "REQUIRED"]).optional(),
  fieldPhone:     z.enum(["HIDDEN", "OPTIONAL", "REQUIRED"]).optional(),
  fieldMobile:    z.enum(["HIDDEN", "OPTIONAL", "REQUIRED"]).optional(),
  fieldGender:    z.enum(["HIDDEN", "OPTIONAL", "REQUIRED"]).optional(),
  fieldPhoto:     z.enum(["HIDDEN", "OPTIONAL", "REQUIRED"]).optional(),

  allowCash:           z.boolean().optional(),
  allowCheque:         z.boolean().optional(),
  allowTransfer:       z.boolean().optional(),
  offlineInstructions: z.string().max(5000).optional().nullable(),
  confirmationMessage: z.string().max(2000).optional().nullable(),
  adminNotificationEmail: z.string().email().max(200).optional().nullable(),

  visibility: z.enum(["LINK", "SITE", "PRIVATE"]).optional(),
  opensAt:    z.string().datetime().optional().nullable(),
  closesAt:   z.string().datetime().optional().nullable(),
})

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const form = await prisma.membershipForm.findFirst({
    where:   { id, associationId: ctx.associationId },
    include: {
      tiers:        { orderBy: { order: "asc" }, include: { membreType: { select: { id: true, name: true, color: true } } } },
      customFields: { orderBy: { order: "asc" } },
      _count:       { select: { cotisations: true } },
    },
  })
  if (!form) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  return NextResponse.json(form)
}, { module: "cotisations" })

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const form = await prisma.membershipForm.findFirst({
    where:  { id, associationId: ctx.associationId },
    select: { id: true, title: true, opensAt: true, closesAt: true },
  })
  if (!form) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const data = parsed.data

  // Compare against the final merged state, not just whichever of the two fields this
  // particular request happens to touch — the wizard always sends both together, but a
  // caller that only patches one must still be checked against the other's stored value.
  const finalOpensAt  = data.opensAt  !== undefined ? (data.opensAt  ? new Date(data.opensAt)  : null) : form.opensAt
  const finalClosesAt = data.closesAt !== undefined ? (data.closesAt ? new Date(data.closesAt) : null) : form.closesAt
  if (finalOpensAt && finalClosesAt && finalOpensAt >= finalClosesAt)
    return NextResponse.json({ error: "La date de clôture doit être postérieure à la date d'ouverture." }, { status: 422 })

  const updated = await prisma.membershipForm.update({
    where: { id },
    data: {
      ...(data.title                !== undefined ? { title: data.title }                                 : {}),
      ...(data.imageUrl             !== undefined ? { imageUrl: data.imageUrl }                            : {}),
      ...(data.description          !== undefined ? { description: data.description }                     : {}),
      ...(data.conditions           !== undefined ? { conditions: data.conditions }                        : {}),
      ...(data.attachments          !== undefined ? { attachments: data.attachments ?? undefined }         : {}),
      ...(data.requireCguvSignature !== undefined ? { requireCguvSignature: data.requireCguvSignature }    : {}),
      ...(data.contactEmail         !== undefined ? { contactEmail: data.contactEmail }                    : {}),
      ...(data.contactPhone         !== undefined ? { contactPhone: data.contactPhone }                    : {}),
      ...(data.validationMode       !== undefined ? { validationMode: data.validationMode }                : {}),
      ...(data.fieldAddress         !== undefined ? { fieldAddress: data.fieldAddress }                    : {}),
      ...(data.fieldBirthDate       !== undefined ? { fieldBirthDate: data.fieldBirthDate }                : {}),
      ...(data.fieldPhone           !== undefined ? { fieldPhone: data.fieldPhone }                        : {}),
      ...(data.fieldMobile          !== undefined ? { fieldMobile: data.fieldMobile }                      : {}),
      ...(data.fieldGender          !== undefined ? { fieldGender: data.fieldGender }                      : {}),
      ...(data.fieldPhoto           !== undefined ? { fieldPhoto: data.fieldPhoto }                        : {}),
      ...(data.allowCash            !== undefined ? { allowCash: data.allowCash }                          : {}),
      ...(data.allowCheque          !== undefined ? { allowCheque: data.allowCheque }                      : {}),
      ...(data.allowTransfer        !== undefined ? { allowTransfer: data.allowTransfer }                  : {}),
      ...(data.offlineInstructions  !== undefined ? { offlineInstructions: data.offlineInstructions }      : {}),
      ...(data.confirmationMessage  !== undefined ? { confirmationMessage: data.confirmationMessage }      : {}),
      ...(data.adminNotificationEmail !== undefined ? { adminNotificationEmail: data.adminNotificationEmail } : {}),
      ...(data.visibility           !== undefined ? { visibility: data.visibility }                        : {}),
      ...(data.opensAt              !== undefined ? { opensAt: data.opensAt ? new Date(data.opensAt) : null }   : {}),
      ...(data.closesAt             !== undefined ? { closesAt: data.closesAt ? new Date(data.closesAt) : null } : {}),
    },
    include: { _count: { select: { cotisations: true } } },
  })

  return NextResponse.json(updated)
}, { module: "cotisations" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const form = await prisma.membershipForm.findFirst({
    where:  { id, associationId: ctx.associationId },
    select: { id: true, title: true, _count: { select: { cotisations: true } } },
  })
  if (!form) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  if (form._count.cotisations > 0) {
    return NextResponse.json(
      { error: "Impossible de supprimer : ce formulaire a déjà des adhésions liées. Archivez-le plutôt." },
      { status: 409 },
    )
  }

  await prisma.membershipForm.delete({ where: { id } })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "MEMBERSHIP_FORM_DELETED",
    entity:        "MembershipForm",
    entityId:      id,
    label:         form.title,
  })

  return NextResponse.json({ ok: true })
}, { module: "cotisations" })
