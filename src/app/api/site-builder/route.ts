import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { revalidatePublicSiteFor } from "@/lib/association/revalidate-site"

// FORM-7: which builder's version visitors see — LEGACY renders siteConfig, PUCK renders
// sitePuckPublished. Switching never touches either store, so it can be undone at any time.

const SITE_EDITOR_ROLES = ["ADMIN", "PRESIDENT"]

const siteBuilderSchema = z.object({
  siteBuilder: z.enum(["LEGACY", "PUCK"]),
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

  if (siteBuilder === "PUCK") {
    const association = await prisma.association.findUnique({
      where:  { id: associationId },
      select: { sitePuckPublished: true },
    })
    if (!association) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (association.sitePuckPublished === null) {
      return NextResponse.json({ error: "Publiez d'abord une version depuis le nouvel éditeur." }, { status: 409 })
    }
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
}, { roles: SITE_EDITOR_ROLES, module: "site" })
