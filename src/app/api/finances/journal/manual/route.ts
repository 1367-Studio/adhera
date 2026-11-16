import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { ensureChartAccounts } from "@/lib/finance/journal/chart-accounts-seed"
import { postJournalEntry, UnbalancedJournalEntryError } from "@/lib/finance/journal/post-journal-entry"
import { writeActivityLog } from "@/lib/activity-log"

// Lançamento manual (FORM-107, rubricas restantes) — la seule porte d'entrée pour Provisions,
// Immobilisations financières et les comptes 486/487 : ces montants sont décidés par le
// trésorier, aucune formule ne les calcule (contrairement à l'amortissement). `postJournalEntry`
// fait déjà tout le travail de validation qui compte (débit=crédit, au moins 2 lignes) — cette
// route ne fait que de la mise en forme et l'autorisation.
interface ManualLineInput {
  chartAccountId: string
  debit?:  number
  credit?: number
}

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx
  const body = await req.json()

  const exerciceId = typeof body.exerciceId === "string" ? body.exerciceId : null
  const date        = typeof body.date === "string" ? new Date(body.date) : null
  const label       = typeof body.label === "string" ? body.label.trim() : ""
  const lines       = Array.isArray(body.lines) ? (body.lines as ManualLineInput[]) : null

  if (!exerciceId || !date || Number.isNaN(date.getTime()) || !label || !lines) {
    return NextResponse.json({ error: "Exercice, date, libellé et lignes sont requis" }, { status: 422 })
  }
  if (lines.some(l => typeof l.chartAccountId !== "string" || (!l.debit && !l.credit))) {
    return NextResponse.json({ error: "Chaque ligne doit avoir un compte et un montant au débit ou au crédit" }, { status: 422 })
  }

  const exercice = await prisma.exerciceComptable.findFirst({ where: { id: exerciceId, associationId } })
  if (!exercice) return NextResponse.json({ error: "Exercice introuvable" }, { status: 404 })
  if (exercice.status === "CLOTURE") {
    return NextResponse.json({ error: "Cet exercice est clôturé — réouvrez-le avant de lancer une écriture." }, { status: 422 })
  }

  await ensureChartAccounts(associationId)

  try {
    const result = await postJournalEntry({
      associationId,
      exerciceId,
      date,
      label,
      sourceType:      "MANUAL",
      // Chaque lançamento manual est son propre événement — il n'y a pas de document d'origine
      // dont dériver une clé déterministe, donc un identifiant aléatoire fait l'affaire ici
      // (contrairement à tous les autres posters du journal, qui doivent rester rejouables).
      idempotencyKey:  `manual:${randomUUID()}`,
      createdByUserId: userId,
      lines: lines.map(l => ({ chartAccountId: l.chartAccountId, debit: l.debit, credit: l.credit })),
    })

    await writeActivityLog({
      associationId, actorId: userId, action: "JOURNAL_MANUAL_ENTRY_CREATED",
      entity: "JournalEntry", entityId: result.journalEntry.id, label,
    })
    return NextResponse.json(result.journalEntry, { status: 201 })
  } catch (err) {
    if (err instanceof UnbalancedJournalEntryError) {
      return NextResponse.json({ error: "Le débit et le crédit doivent être égaux" }, { status: 422 })
    }
    if (err instanceof Error && err.message.includes("needs at least two lines")) {
      return NextResponse.json({ error: "Au moins deux lignes sont nécessaires" }, { status: 422 })
    }
    throw err
  }
}, { area: "comptabilite", module: "finances" })
