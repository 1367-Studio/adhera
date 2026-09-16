import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { z } from "zod"
import { writeActivityLog } from "@/lib/activity-log"
import { revalidatePublicSiteFor } from "@/lib/association/revalidate-site"
import { SITE_FONT_KEYS } from "@/lib/site-fonts"
import {
  bindDonationFormToSiteSection,
  releaseDeletedDonsSiteSections,
  unbindDonationFormsFromSiteSection,
} from "@/lib/dons/site-section-binding"

const ADMINS = ["ADMIN", "PRESIDENT"]

const sectionSchema = z.object({
  id:          z.string(),
  type:        z.enum(["hero", "about", "events", "actualites", "membership", "dons", "boutique", "contact"]),
  title:       z.string().optional().default(""),
  subtitle:    z.string().optional(),
  bgColor:     z.string().optional(),
  image:       z.string().optional(),
  heroHeight:  z.enum(["full", "half"]).optional(),
  content:     z.string().optional(),
  limit:       z.number().int().min(1).max(20).optional(),
  body:        z.string().optional(),
  buttonLabel: z.string().max(40).optional(),
})

const schema = z.object({
  published:          z.boolean().optional(),
  primaryColor:       z.string().optional(),
  secondaryColor:     z.string().optional(),
  fontFamily:         z.enum(SITE_FONT_KEYS as [string, ...string[]]).optional(),
  logoUrl:            z.string().optional(),
  headerBgColor:       z.string().optional(),
  headerShowMembres:   z.boolean().optional(),
  headerShowRegister:  z.boolean().optional(),
  footerText:         z.string().optional(),
  footerBgColor:      z.string().optional(),
  footerLinks:        z.array(z.object({ label: z.string().max(60), url: z.string().max(200) })).max(6).optional(),
  sections:           z.array(sectionSchema).optional(),
  // "dons" section id → DonationForm id to show there, or null to leave the block empty. Only
  // the sections whose choice changed in the builder. Applied to the forms (their
  // siteSectionId is the source of truth) and never stored in siteConfig.
  donsFormAssignments: z.record(z.string(), z.string().nullable()).optional(),
})

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { sitePublished: true, siteConfig: true, slug: true },
  })
  if (!assoc) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({
    published: assoc.sitePublished,
    slug:      assoc.slug,
    config:    assoc.siteConfig ?? null,
  })
})

export const PATCH = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { published, donsFormAssignments, ...configFields } = parsed.data
  const data: Record<string, unknown> = {}

  if (published !== undefined) data.sitePublished = published

  const existing = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { siteConfig: true },
  })
  const existingConfig   = (existing?.siteConfig ?? {}) as Record<string, unknown>
  const existingSections = (existingConfig.sections as { id: string; type: string }[] | undefined) ?? []
  data.siteConfig = { ...existingConfig, ...configFields }

  // A deleted section can be one a MembershipForm's or DonationForm's Publication step points
  // at (siteSectionId) — without this, the form stays PUBLISHED+SITE forever bound to a
  // section id that no longer exists anywhere in siteConfig, so it silently vanishes from
  // the page while still counting as "published on the site" (e.g. still driving the header
  // CTA). Clearing it back to null falls through to the normal "not bound to a section yet"
  // state, which the Publication step already knows how to show and unblock.
  const nextSectionIds    = new Set((configFields.sections ?? []).map(section => section.id))
  const removedSectionIds = configFields.sections
    ? existingSections.map(section => section.id).filter(sectionId => !nextSectionIds.has(sectionId))
    : []

  const assignmentEntries = Object.entries(donsFormAssignments ?? {})
  if (assignmentEntries.length > 0) {
    const savedSections  = configFields.sections ?? existingSections
    const donsSectionIds = new Set(savedSections.filter(section => section.type === "dons").map(section => section.id))
    if (assignmentEntries.some(([sectionId]) => !donsSectionIds.has(sectionId)))
      return NextResponse.json({ error: "Section de dons introuvable." }, { status: 422 })

    const assignedFormIds = assignmentEntries.map(([, formId]) => formId).filter((formId): formId is string => formId !== null)
    // A form can only be on one section — two sections claiming the same form would make the
    // outcome depend on the order the assignments happen to be applied in.
    if (new Set(assignedFormIds).size !== assignedFormIds.length)
      return NextResponse.json({ error: "Un même formulaire de don ne peut pas être affiché dans deux sections." }, { status: 422 })
    if (assignedFormIds.length > 0) {
      const publishedCount = await prisma.donationForm.count({
        where: { associationId, id: { in: assignedFormIds }, status: "PUBLISHED" },
      })
      if (publishedCount !== assignedFormIds.length)
        return NextResponse.json({ error: "Formulaire de don introuvable ou non publié." }, { status: 422 })
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.association.update({ where: { id: associationId }, data })

    if (removedSectionIds.length > 0) {
      await tx.membershipForm.updateMany({
        where: { associationId, siteSectionId: { in: removedSectionIds } },
        data:  { siteSectionId: null },
      })
      await releaseDeletedDonsSiteSections(tx, { associationId, siteSectionIds: removedSectionIds })
    }

    // Unbinds first, then binds: a consistent set of assignments gives the same result in
    // either order, this just keeps it deterministic.
    for (const [siteSectionId, formId] of assignmentEntries) {
      if (formId === null) await unbindDonationFormsFromSiteSection(tx, { associationId, siteSectionId })
    }
    for (const [siteSectionId, formId] of assignmentEntries) {
      if (formId !== null) await bindDonationFormToSiteSection(tx, { associationId, siteSectionId, formId })
    }
  })

  await revalidatePublicSiteFor(associationId)

  const action = published === true ? "SITE_PUBLISHED" : published === false ? "SITE_UNPUBLISHED" : "SITE_UPDATED"
  await writeActivityLog({
    associationId,
    actorId:  userId,
    action,
    entity:   "Association",
    entityId: associationId,
  })

  return NextResponse.json({ ok: true })
}, { roles: ADMINS })
