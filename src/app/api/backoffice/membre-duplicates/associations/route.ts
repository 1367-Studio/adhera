import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"

// Backs the association picker on /backoffice/membre-duplicates — a small search-as-you-type
// lookup, not a general-purpose backoffice associations API (no such endpoint exists yet;
// the associations list page itself queries prisma directly from a server component).
export const GET = withSuperAdminAuth(async (req) => {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search")?.trim()

  const associations = await prisma.association.findMany({
    where:   search ? { name: { contains: search, mode: "insensitive" } } : {},
    select:  { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
    take:    20,
  })
  return NextResponse.json({ data: associations })
})
