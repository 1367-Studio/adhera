// src/app/api/finances/rapports/bilan/refresh/route.ts
// Manual, on-demand version of the catch-up `ensurePostedJournalEntries` otherwise only ever
// runs at exercice closing or via the local-only backfill script (see that function's own doc
// comment, and the RESULT_DIVERGENCE issue in validate-journal.ts, whose message already
// promises "relancez la synchronisation" — this route is what makes that promise true). Lets a
// treasurer catch the journal up on recent activity without waiting for the exercice to close.
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { ensureChartAccounts } from "@/lib/finance/journal/chart-accounts-seed"
import { ensurePostedJournalEntries } from "@/lib/finance/journal/post-income-expense"

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const body = await req.json().catch(() => ({}))
  const exerciceId = typeof body?.exerciceId === "string" ? body.exerciceId : undefined

  if (exerciceId) {
    const exercice = await prisma.exerciceComptable.findFirst({ where: { id: exerciceId, associationId } })
    if (!exercice) return NextResponse.json({ error: "Exercice introuvable" }, { status: 404 })
  }

  await ensureChartAccounts(associationId)
  const { posted, reversed } = await ensurePostedJournalEntries(associationId, exerciceId)

  return NextResponse.json({ posted, reversed })
}, { area: "comptabilite", module: "finances" })
