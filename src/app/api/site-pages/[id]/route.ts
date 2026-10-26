import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { revalidatePublicSiteFor } from "@/lib/association/revalidate-site"
import { releaseDeletedDonsSiteSections } from "@/lib/dons/site-section-binding"
import { parseUpdateSitePageRequest } from "@/lib/site-puck/site-page-schema"
import { collectPuckBlockIds } from "@/lib/site-puck/site-puck-tree"

type RouteParams = { id: string }

export const GET = withAdminAuth<RouteParams>(async (_req, ctx, { id }) => {
  const sitePage = await prisma.sitePage.findFirst({
    where: { id, associationId: ctx.associationId },
  })
  if (!sitePage) return NextResponse.json({ error: "Page introuvable" }, { status: 404 })

  return NextResponse.json({
    sitePage: {
      ...sitePage,
      publishedAt: sitePage.publishedAt?.toISOString() ?? null,
      createdAt:   sitePage.createdAt.toISOString(),
      updatedAt:   sitePage.updatedAt.toISOString(),
    },
  })
}, { area: "site", module: "site" })

export const PUT = withAdminAuth<RouteParams>(async (req, ctx, { id }) => {
  const parsedBody = await parseUpdateSitePageRequest(req)
  if (!parsedBody.success) return parsedBody.errorResponse

  const existingSitePage = await prisma.sitePage.findFirst({
    where:  { id, associationId: ctx.associationId },
    select: { draftContent: true },
  })
  if (!existingSitePage) return NextResponse.json({ error: "Page introuvable" }, { status: 404 })

  const { title, seoTitle, seoDescription, showInNav, navLabel, navPosition, navMenuId, content, zones } = parsedBody.data

  // A page can only be grouped into a menu this association actually owns — otherwise it could
  // be pointed at (or silently detached by) another association's SiteNavMenu id.
  if (navMenuId) {
    const targetSiteNavMenu = await prisma.siteNavMenu.findFirst({
      where:  { id: navMenuId, associationId: ctx.associationId },
      select: { id: true },
    })
    if (!targetSiteNavMenu) return NextResponse.json({ error: "Menu introuvable" }, { status: 404 })
  }

  const sitePage = await prisma.sitePage.update({
    where: { id },
    data: {
      ...(title !== undefined          ? { title }          : {}),
      ...(seoTitle !== undefined        ? { seoTitle }        : {}),
      ...(seoDescription !== undefined  ? { seoDescription }  : {}),
      ...(showInNav !== undefined       ? { showInNav }       : {}),
      ...(navLabel !== undefined        ? { navLabel }        : {}),
      ...(navPosition !== undefined     ? { navPosition }     : {}),
      ...(navMenuId !== undefined       ? { navMenuId }       : {}),
      // content/zones always travel together: the editor always posts the whole page it has
      // loaded, so a partial save can never drop the other half of the previous draft.
      ...(content !== undefined
        ? { draftContent: { content, zones: zones ?? {} } as Prisma.InputJsonValue }
        : {}),
    },
  })

  // Nav placement (showInNav/navLabel/navPosition/navMenuId) takes effect on the live site
  // immediately for an already-published page — it isn't gated behind "Publier" like block
  // content is (see src/lib/site-puck/site-page-nav.ts) — so the public page must be
  // revalidated here too, not only on publish/unpublish/delete.
  if (showInNav !== undefined || navLabel !== undefined || navPosition !== undefined || navMenuId !== undefined) {
    await revalidatePublicSiteFor(ctx.associationId)
  }

  return NextResponse.json({
    sitePage: {
      ...sitePage,
      publishedAt: sitePage.publishedAt?.toISOString() ?? null,
      createdAt:   sitePage.createdAt.toISOString(),
      updatedAt:   sitePage.updatedAt.toISOString(),
    },
  })
}, { area: "site", module: "site" })

export const DELETE = withAdminAuth<RouteParams>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const sitePage = await prisma.sitePage.findFirst({
    where: { id, associationId },
  })
  if (!sitePage) return NextResponse.json({ error: "Page introuvable" }, { status: 404 })

  // Every block id this page ever carried (draft and published can differ while work is in
  // progress) — any form still bound to one of them must be released, the same way publishing
  // away a block does (see .../publish/route.ts).
  const blockIds = [
    ...collectPuckBlockIds(sitePage.draftContent),
    ...collectPuckBlockIds(sitePage.publishedContent),
  ]

  await prisma.$transaction(async transaction => {
    if (blockIds.length > 0) {
      await transaction.membershipForm.updateMany({
        where: { associationId, siteSectionId: { in: blockIds } },
        data:  { siteSectionId: null },
      })
      await releaseDeletedDonsSiteSections(transaction, { associationId, siteSectionIds: blockIds })
    }
    await transaction.sitePage.delete({ where: { id } })
  })

  await revalidatePublicSiteFor(associationId)
  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "SITE_UPDATED",
    entity:   "SitePage",
    entityId: id,
    metadata: { siteBuilderEvent: "PAGE_DELETED", slug: sitePage.slug },
  })

  return NextResponse.json({ ok: true })
}, { area: "site", module: "site" })
