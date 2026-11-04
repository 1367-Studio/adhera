import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { detectMembreDuplicates } from "@/lib/membre-duplicate-matches"

// Triggered by the "Rechercher les doublons" button on /dashboard/membres/duplicates — no
// cron, scanning only runs when an admin asks for it.
export const POST = withAdminAuth(async (_req, ctx) => {
  const summary = await detectMembreDuplicates(ctx.associationId)
  return NextResponse.json(summary)
}, { area: "membres" })
