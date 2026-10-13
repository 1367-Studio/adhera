import { NextResponse } from "next/server"
import { format } from "date-fns"
import { withAdminAuth } from "@/lib/api-wrapper"
import { collectPersonalData } from "@/lib/gdpr/subject-data"

// Answers a GDPR Art.15 (access) or Art.20 (portability) request — security audit H7.
// Administrator-only: this aggregates data across every area of the association (dons,
// adhésions, comptabilité, réunions, communication…), a materially broader disclosure than
// any single-area export route.
export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const data = await collectPersonalData(ctx.associationId, id)
  if (!data) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const filename = `donnees-personnelles-${id}-${format(new Date(), "yyyy-MM-dd")}.json`

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type":        "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}, { administrator: true })
