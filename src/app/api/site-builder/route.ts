import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { revalidatePublicSiteFor } from "@/lib/association/revalidate-site"

// FORM-7: which builder's version visitors see — LEGACY renders siteConfig, PUCK renders
// sitePuckPublished. The legacy editor is discontinued and switching back to it is refused
// below (even though the stores themselves are untouched by switching, so it would be
// technically harmless) — there is no UI for it anymore and it should stay that way. Normal
// publishing (POST /api/site-draft/publish) already switches to PUCK on its own; this route
// only still exists for that one-off case (e.g. activating PUCK without a fresh publish).

const siteBuilderSchema = z.object({
  siteBuilder: z.literal("PUCK"),
})

export const PATCH = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  let requestBody: unknown
  try {
    requestBody = await req.json()
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 })
  }
  const parsedBody = siteBuilderSchema.safeParse(requestBody)
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Éditeur de site invalide" }, { status: 422 })
  }
  const { siteBuilder } = parsedBody.data

  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { sitePuckPublished: true },
  })
  if (!association) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (association.sitePuckPublished === null) {
    return NextResponse.json({ error: "Publiez d'abord une version depuis le nouvel éditeur." }, { status: 409 })
  }

  await prisma.association.update({
    where: { id: associationId },
    data:  { siteBuilder },
  })

  await revalidatePublicSiteFor(associationId)
  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "SITE_UPDATED",
    entity:   "Association",
    entityId: associationId,
    metadata: { siteBuilder },
  })

  return NextResponse.json({ siteBuilder })
}, { area: "site", module: "site" })
