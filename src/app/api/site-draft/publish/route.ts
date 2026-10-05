import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { revalidatePublicSiteFor } from "@/lib/association/revalidate-site"
import { releaseDeletedDonsSiteSections } from "@/lib/dons/site-section-binding"
import { parseSiteDraftRequest } from "@/lib/site-puck/site-draft-schema"
import { collectPuckBlockIds } from "@/lib/site-puck/site-puck-tree"
import { liveSiteSectionIds } from "@/lib/site-puck/site-section-ids"

// FORM-7: publishes the Puck page — it becomes both the saved draft and the version visitors
// see when siteBuilder is PUCK. Blocks removed since the previous draft/publish release the
// forms bound to them, unless the legacy siteConfig still has a section with that id.

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const parsedDraft = await parseSiteDraftRequest(req)
  if (!parsedDraft.success) return parsedDraft.errorResponse

  const publishedAt = new Date()

  await prisma.$transaction(async (transaction) => {
    const previous = await transaction.association.findUnique({
      where:  { id: associationId },
      select: { siteConfig: true, siteDraft: true, sitePuckPublished: true },
    })

    await transaction.association.update({
      where: { id: associationId },
      data:  {
        siteDraft:           parsedDraft.siteDraft,
        sitePuckPublished:   parsedDraft.siteDraft,
        sitePuckPublishedAt: publishedAt,
      },
    })

    if (!previous) return
    const previousBlockIds = new Set([
      ...collectPuckBlockIds(previous.siteDraft),
      ...collectPuckBlockIds(previous.sitePuckPublished),
    ])
    const nextLiveIds = liveSiteSectionIds({
      siteConfig:        previous.siteConfig,
      siteDraft:         parsedDraft.siteDraft,
      sitePuckPublished: parsedDraft.siteDraft,
    })
    const removedSectionIds = [...previousBlockIds].filter(blockId => !nextLiveIds.has(blockId))
    if (removedSectionIds.length === 0) return

    await transaction.membershipForm.updateMany({
      where: { associationId, siteSectionId: { in: removedSectionIds } },
      data:  { siteSectionId: null },
    })
    await releaseDeletedDonsSiteSections(transaction, { associationId, siteSectionIds: removedSectionIds })
  })

  await revalidatePublicSiteFor(associationId)
  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "SITE_UPDATED",
    entity:   "Association",
    entityId: associationId,
    metadata: { siteBuilderEvent: "PUCK_PUBLISHED" },
  })

  return NextResponse.json({ ok: true, publishedAt: publishedAt.toISOString() })
}, { area: "site", module: "site" })
