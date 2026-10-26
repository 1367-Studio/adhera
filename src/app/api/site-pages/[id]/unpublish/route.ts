import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { revalidatePublicSiteFor } from "@/lib/association/revalidate-site"

type RouteParams = { id: string }

// Takes a page off the public site without touching its content: draftContent/publishedContent
// are left as they are, only `status`/`publishedAt` change, so publishing again later needs no
// re-authoring. The public route only ever serves a page whose status is PUBLISHED.

export const POST = withAdminAuth<RouteParams>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existingSitePage = await prisma.sitePage.findFirst({
    where:  { id, associationId },
    select: { slug: true },
  })
  if (!existingSitePage) return NextResponse.json({ error: "Page introuvable" }, { status: 404 })

  await prisma.sitePage.update({
    where: { id },
    data:  { status: "DRAFT", publishedAt: null },
  })

  await revalidatePublicSiteFor(associationId)
  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "SITE_UPDATED",
    entity:   "SitePage",
    entityId: id,
    metadata: { siteBuilderEvent: "PAGE_UNPUBLISHED", slug: existingSitePage.slug },
  })

  return NextResponse.json({ ok: true, status: "DRAFT" as const })
}, { area: "site", module: "site" })
