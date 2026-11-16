import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

// Bilan drill-down (FORM-107): "rubrique → comptes → écritures → document d'origine" — unlike
// the Compte de résultat, computeBilanPeriod only aggregates (groupBy), so this is a dedicated
// fetch-on-click endpoint rather than data already sitting in the report payload. Scoping by
// `journalEntry: { associationId, exerciceId }` is enough to keep this association-safe: a
// ChartAccount only ever gets referenced by JournalLine rows whose JournalEntry belongs to the
// same association it was seeded for (see chart-accounts-seed.ts) — no separate ownership check
// on chartAccountId is needed.
export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const url = new URL(req.url)
  const chartAccountId = url.searchParams.get("chartAccountId")
  const exerciceId     = url.searchParams.get("exerciceId")
  if (!chartAccountId || !exerciceId) {
    return NextResponse.json({ error: "chartAccountId et exerciceId sont requis" }, { status: 400 })
  }

  const lines = await prisma.journalLine.findMany({
    where: { chartAccountId, journalEntry: { associationId, exerciceId } },
    select: {
      id: true, debit: true, credit: true, label: true,
      journalEntry: { select: { date: true, label: true, sourceType: true } },
    },
    orderBy: { journalEntry: { date: "asc" } },
  })

  return NextResponse.json({
    lines: lines.map(l => ({
      id:         l.id,
      date:       l.journalEntry.date,
      debit:      Number(l.debit),
      credit:     Number(l.credit),
      // A line's own label (e.g. one side of a split) falls back to its entry's label when
      // null — every JournalLine is pushed with an optional `label`, but postJournalEntry's
      // own callers almost always leave it unset and rely on the entry-level label instead.
      label:      l.label ?? l.journalEntry.label,
      sourceType: l.journalEntry.sourceType,
    })),
  })
}, { area: "comptabilite", module: "finances" })
