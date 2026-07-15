import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveDocumentBranding } from "@/lib/plan-limits"

// Proxies the association's own logo through our own origin so client-side PDF generation
// (feuille de présence, src/app/dashboard/evenements/[id]/presences/page.tsx) can fetch()
// it without needing CORS configured on the R2 bucket — a plain <img src> doesn't need
// this, but fetch() does. The URL always comes from the caller's own association record,
// never from a query param, so there's no SSRF surface here.
export const GET = withAdminAuth(async (_req, ctx) => {
  const association = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
  })
  if (!association) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { logoUrl } = resolveDocumentBranding(association)
  if (!logoUrl) return NextResponse.json({ error: "No logo configured" }, { status: 404 })

  const res = await fetch(logoUrl)
  if (!res.ok) return NextResponse.json({ error: "Logo fetch failed" }, { status: 502 })

  const bytes = new Uint8Array(await res.arrayBuffer())
  return new NextResponse(bytes, {
    headers: {
      "Content-Type":  res.headers.get("content-type") ?? "image/png",
      "Cache-Control": "private, max-age=300",
    },
  })
})
