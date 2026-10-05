import { NextResponse } from "next/server"
import { getTranslations } from "next-intl/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { revalidatePublicSiteFor } from "@/lib/association/revalidate-site"
import { writeActivityLog } from "@/lib/activity-log"
import { listPuckBlocksOfType, puckBlockId } from "@/lib/site-puck/site-puck-tree"

// FORM-7: the "membership" / "dons" sections a MembershipForm or DonationForm can be shown in
// (their siteSectionId), read from and created in whichever builder visitors currently see —
// siteConfig.sections for LEGACY, the Puck blocks for PUCK. Lets the form pages' Publication
// step work the same whichever builder is active.

const sectionTypeSchema = z.enum(["membership", "dons"])
type FormSectionType = z.infer<typeof sectionTypeSchema>

// Shown in the picker for a block whose title was left empty.
const FALLBACK_SECTION_TITLES: Record<FormSectionType, string> = {
  membership: "Adhésion",
  dons:       "Dons",
}

type SiteSectionSummary = { id: string; title: string }

function readTitle(rawTitle: unknown, sectionType: FormSectionType): string {
  return typeof rawTitle === "string" && rawTitle.trim() !== "" ? rawTitle : FALLBACK_SECTION_TITLES[sectionType]
}

function legacySections(siteConfig: unknown): { id?: unknown; type?: unknown; title?: unknown }[] {
  if (typeof siteConfig !== "object" || siteConfig === null) return []
  const sections = (siteConfig as { sections?: unknown }).sections
  return Array.isArray(sections)
    ? sections.filter((section): section is Record<string, unknown> => typeof section === "object" && section !== null)
    : []
}

function puckSectionsOfType(puckData: unknown, sectionType: FormSectionType): SiteSectionSummary[] {
  const summaries: SiteSectionSummary[] = []
  for (const block of listPuckBlocksOfType(puckData, sectionType)) {
    const blockId = puckBlockId(block)
    if (blockId) summaries.push({ id: blockId, title: readTitle(block.props.title, sectionType) })
  }
  return summaries
}

// No role or module restriction beyond withAdminAuth: the form pages read GET /api/site-config
// for this list today, which has none either.
export const GET = withAdminAuth(async (req, ctx) => {
  const parsedType = sectionTypeSchema.safeParse(new URL(req.url).searchParams.get("type"))
  if (!parsedType.success) {
    return NextResponse.json({ error: "Type de section invalide" }, { status: 422 })
  }
  const sectionType = parsedType.data

  const association = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { siteBuilder: true, siteConfig: true, siteDraft: true, sitePuckPublished: true },
  })
  if (!association) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let sections: SiteSectionSummary[]
  if (association.siteBuilder === "PUCK") {
    // Draft first: its titles are the latest edits, and blocks only in the draft can already
    // receive a form (it shows once the page is published).
    const sectionsById = new Map<string, SiteSectionSummary>()
    for (const section of [
      ...puckSectionsOfType(association.siteDraft, sectionType),
      ...puckSectionsOfType(association.sitePuckPublished, sectionType),
    ]) {
      if (!sectionsById.has(section.id)) sectionsById.set(section.id, section)
    }
    sections = [...sectionsById.values()]
  } else {
    sections = legacySections(association.siteConfig)
      .filter(section => section.type === sectionType && typeof section.id === "string" && section.id !== "")
      .map(section => ({ id: section.id as string, title: readTitle(section.title, sectionType) }))
  }

  return NextResponse.json({ siteBuilder: association.siteBuilder, sections })
})

const createSectionSchema = z.object({ type: sectionTypeSchema })

function appendTopLevelBlock(puckData: Prisma.JsonValue, newBlock: Record<string, unknown>): Prisma.InputJsonValue {
  const page = (typeof puckData === "object" && puckData !== null && !Array.isArray(puckData)) ? puckData : {}
  const existingContent = Array.isArray(page.content) ? page.content : []
  return {
    ...page,
    root:    page.root ?? { props: {} },
    content: [...existingContent, newBlock],
  } as Prisma.InputJsonValue
}

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  let requestBody: unknown
  try {
    requestBody = await req.json()
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 })
  }
  const parsedBody = createSectionSchema.safeParse(requestBody)
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Type de section invalide" }, { status: 422 })
  }
  const sectionType = parsedBody.data.type

  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { siteBuilder: true, siteConfig: true, siteDraft: true, sitePuckPublished: true },
  })
  if (!association) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Same id and default title as the form pages used when creating it client-side.
  const translateDefaultTitle = await getTranslations("site.defaultTitles")
  const sectionId    = crypto.randomUUID()
  const sectionTitle = translateDefaultTitle(sectionType)
  const extraFields  = sectionType === "dons" ? { buttonLabel: "" } : {}

  if (association.siteBuilder === "PUCK") {
    const newBlock = {
      type:  sectionType,
      props: { id: sectionId, title: sectionTitle, body: "", ...extraFields, layout: "centered" },
    }
    // Added to the published page too, so a form attached to it shows without a separate
    // publish. A missing draft starts from the published page rather than from nothing.
    const draftBase = association.siteDraft ?? association.sitePuckPublished
    await prisma.association.update({
      where: { id: associationId },
      data:  {
        siteDraft: appendTopLevelBlock(draftBase, newBlock),
        ...(association.sitePuckPublished !== null
          ? { sitePuckPublished: appendTopLevelBlock(association.sitePuckPublished, newBlock) }
          : {}),
      },
    })
  } else {
    const existingConfig = (typeof association.siteConfig === "object" && association.siteConfig !== null && !Array.isArray(association.siteConfig))
      ? association.siteConfig
      : {}
    const newSection = { id: sectionId, type: sectionType, title: sectionTitle, body: "", ...extraFields }
    await prisma.association.update({
      where: { id: associationId },
      data:  {
        siteConfig: {
          ...existingConfig,
          sections: [...legacySections(association.siteConfig), newSection],
        } as Prisma.InputJsonValue,
      },
    })
  }

  await revalidatePublicSiteFor(associationId)
  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "SITE_UPDATED",
    entity:   "Association",
    entityId: associationId,
    metadata: { createdSiteSection: { id: sectionId, type: sectionType, siteBuilder: association.siteBuilder } },
  })
  return NextResponse.json({ id: sectionId, title: sectionTitle }, { status: 201 })
}, { area: "site" }) // same gate as PATCH /api/site-config, which the form pages used to create sections
