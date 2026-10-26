import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { parseCreateSitePageRequest } from "@/lib/site-puck/site-page-schema"

// FORM-7 custom pages: one more page on the new builder's site beyond the single home page
// (Association.siteDraft/sitePuckPublished) — see the SitePage model's comment in schema.prisma.

export const GET = withAdminAuth(async (_req, ctx) => {
  const sitePages = await prisma.sitePage.findMany({
    where:   { associationId: ctx.associationId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, title: true, slug: true, status: true,
      showInNav: true, navLabel: true, navPosition: true, navMenuId: true,
      publishedAt: true, updatedAt: true,
    },
  })
  return NextResponse.json({
    sitePages: sitePages.map(sitePage => ({
      ...sitePage,
      publishedAt: sitePage.publishedAt?.toISOString() ?? null,
      updatedAt:   sitePage.updatedAt.toISOString(),
    })),
  })
}, { area: "site", module: "site" })

export const POST = withAdminAuth(async (req, ctx) => {
  const parsedBody = await parseCreateSitePageRequest(req)
  if (!parsedBody.success) return parsedBody.errorResponse

  try {
    const sitePage = await prisma.sitePage.create({
      data: {
        associationId: ctx.associationId,
        title:         parsedBody.data.title,
        slug:          parsedBody.data.slug,
        draftContent:  { content: [], zones: {} },
      },
    })
    return NextResponse.json({ sitePage: { ...sitePage, publishedAt: null } }, { status: 201 })
  } catch (createError) {
    if (createError instanceof Prisma.PrismaClientKnownRequestError && createError.code === "P2002") {
      return NextResponse.json({ error: "Cette adresse est déjà utilisée par une autre page." }, { status: 409 })
    }
    throw createError
  }
}, { area: "site", module: "site" })
