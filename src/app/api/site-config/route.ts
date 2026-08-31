import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { z } from "zod"
import { writeActivityLog } from "@/lib/activity-log"
import { revalidatePublicSiteFor } from "@/lib/association/revalidate-site"

const ADMINS = ["ADMIN", "PRESIDENT"]

const sectionSchema = z.object({
  id:          z.string(),
  type:        z.enum(["hero", "about", "events", "actualites", "membership", "contact"]),
  title:       z.string().optional().default(""),
  subtitle:    z.string().optional(),
  bgColor:     z.string().optional(),
  image:       z.string().optional(),
  heroHeight:  z.enum(["full", "half"]).optional(),
  content:     z.string().optional(),
  limit:       z.number().int().min(1).max(20).optional(),
  body:        z.string().optional(),
})

const schema = z.object({
  published:          z.boolean().optional(),
  primaryColor:       z.string().optional(),
  logoUrl:            z.string().optional(),
  headerBgColor:       z.string().optional(),
  headerShowMembres:   z.boolean().optional(),
  headerShowRegister:  z.boolean().optional(),
  footerText:         z.string().optional(),
  footerBgColor:      z.string().optional(),
  footerLinks:        z.array(z.object({ label: z.string().max(60), url: z.string().max(200) })).max(6).optional(),
  sections:           z.array(sectionSchema).optional(),
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

  const { published, ...configFields } = parsed.data
  const data: Record<string, unknown> = {}

  if (published !== undefined) data.sitePublished = published

  const existing = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { siteConfig: true },
  })
  const existingConfig = (existing?.siteConfig ?? {}) as Record<string, unknown>
  data.siteConfig = { ...existingConfig, ...configFields }

  await prisma.association.update({ where: { id: associationId }, data })

  // A deleted section can be one a MembershipForm's Publication step points at
  // (siteSectionId) — without this, the form stays PUBLISHED+SITE forever bound to a
  // section id that no longer exists anywhere in siteConfig, so it silently vanishes from
  // the page while still counting as "published on the site" (e.g. still driving the header
  // CTA). Clearing it back to null falls through to the normal "not bound to a section yet"
  // state, which the Publication step already knows how to show and unblock.
  if (configFields.sections) {
    const oldIds     = new Set(((existingConfig.sections as { id: string }[] | undefined) ?? []).map(s => s.id))
    const newIds     = new Set(configFields.sections.map(s => s.id))
    const removedIds = [...oldIds].filter(id => !newIds.has(id))
    if (removedIds.length > 0) {
      await prisma.membershipForm.updateMany({
        where: { associationId, siteSectionId: { in: removedIds } },
        data:  { siteSectionId: null },
      })
    }
  }

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
