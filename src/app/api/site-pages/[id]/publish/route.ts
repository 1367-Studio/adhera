import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { revalidatePublicSiteFor } from "@/lib/association/revalidate-site"
import { releaseDeletedDonsSiteSections } from "@/lib/dons/site-section-binding"
import { parsePublishSitePageRequest } from "@/lib/site-puck/site-page-schema"
import { collectPuckBlockIds } from "@/lib/site-puck/site-puck-tree"

type RouteParams = { id: string }

// Publishes one custom page — same idea as POST /api/site-draft/publish for the home page, but
// scoped to this page's own content only (each custom page has its own independent draft/
// published pair). Block ids are unique per Puck item, so comparing this page's own previous vs
// next content is enough to know which bound forms to release — unlike the home page's publish,
// there is no need to also check the other stores (legacy siteConfig, other pages).

export const POST = withAdminAuth<RouteParams>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const parsedBody = await parsePublishSitePageRequest(req)
  if (!parsedBody.success) return parsedBody.errorResponse

  const publishedAt = new Date()

  const sitePage = await prisma.$transaction(async transaction => {
    const previous = await transaction.sitePage.findFirst({
      where:  { id, associationId },
      select: { slug: true, draftContent: true, publishedContent: true },
    })
    if (!previous) return null

    const updated = await transaction.sitePage.update({
      where: { id },
      data:  {
        draftContent:     parsedBody.data,
        publishedContent: parsedBody.data,
        publishedAt,
        status:           "PUBLISHED",
      },
    })

    const previousBlockIds = new Set([
      ...collectPuckBlockIds(previous.draftContent),
      ...collectPuckBlockIds(previous.publishedContent),
    ])
    const nextBlockIds = collectPuckBlockIds(parsedBody.data)
    const removedBlockIds = [...previousBlockIds].filter(blockId => !nextBlockIds.has(blockId))
    if (removedBlockIds.length > 0) {
      await transaction.membershipForm.updateMany({
        where: { associationId, siteSectionId: { in: removedBlockIds } },
        data:  { siteSectionId: null },
      })
      await releaseDeletedDonsSiteSections(transaction, { associationId, siteSectionIds: removedBlockIds })
    }

    return updated
  })

  if (!sitePage) return NextResponse.json({ error: "Page introuvable" }, { status: 404 })

  await revalidatePublicSiteFor(associationId)
  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "SITE_UPDATED",
    entity:   "SitePage",
    entityId: id,
    metadata: { siteBuilderEvent: "PAGE_PUBLISHED", slug: sitePage.slug },
  })

  return NextResponse.json({ ok: true, publishedAt: publishedAt.toISOString(), status: "PUBLISHED" as const })
}, { area: "site", module: "site" })
