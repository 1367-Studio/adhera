import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

export const GET = withPortalAuth(async (_req, ctx) => {
  const cotisations = await prisma.cotisation.findMany({
    where:   { membreId: ctx.membreId! },
    orderBy: { year: "desc" },
  })

  return NextResponse.json(cotisations)
})
