// src/lib/finance/bilan.ts
// Computes the Bilan (balance sheet) for one exercice from the real double-entry ledger
// (JournalEntry/JournalLine) — see FORM-107 Fase 4. Distinct from income-statement.ts, which
// derives the Compte de résultat from Income/Expense + FinanceCategory rows; the two read
// different source tables and are expected to agree on the operating result (see the
// RESULT_DIVERGENCE note below for the one deliberate exception).
//
// Scoped strictly by `exerciceId`, never by a cumulative `date <= asOfDate` range: every
// exercice's own opening entry (see journal/opening-balance.ts) already restates the true
// carried-forward balance of every ACTIF/PASSIF account as of its start, so summing only this
// exercice's own JournalLine rows (its opening entry + its own movements) gives the exact
// ending balance — summing across exercice boundaries by date instead would double-count
// whatever a prior opening entry already restated.
import { prisma } from "@/lib/prisma/client"
import { rubriqueForAccountCode, BILAN_RUBRIQUES } from "@/lib/finance/bilan-rubriques"
import { factureStatusWhere } from "@/lib/facture-status"
import type { CotisationStatus, FactureStatus } from "@prisma/client"
import type {
  BilanPeriod, BilanSide, BilanRubrique, BilanValidationIssue, BilanSideKey, ExerciceRef,
} from "@/lib/finance/bilan-shared"

export type { ExerciceRef, BilanPeriod }

const RESULT_ACCOUNT_CODE = "120000"
const VIRTUAL_PERIOD_RESULT_ACCOUNT_ID = "virtual:resultat-periode"

// Same fr-FR currency format the client uses for every other amount on this screen (see
// bilan-view.tsx's `fmt`) — kept server-side here only for the ACTIF_PASSIF_MISMATCH i18n
// param, so a validation message embeds the same figure a treasurer sees in the tables above it.
function fmtAmount(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
}

function emptySide(side: BilanSideKey): BilanSide {
  return {
    rubriques: BILAN_RUBRIQUES
      .filter(r => r.side === side)
      .sort((a, b) => a.order - b.order)
      .map(r => ({ key: r.key, accounts: [], total: 0, isMemo: r.isMemo })),
    total: 0,
  }
}

function emptyPeriod(exercice: ExerciceRef | null): BilanPeriod {
  return { exercice, actif: emptySide("ACTIF"), passif: emptySide("PASSIF"), balanced: true, issues: [], resultOfPeriod: 0 }
}

export interface ComputeBilanOptions {
  // True only for the association's chronologically latest exercice (decided by the route,
  // not here — see bilan/route.ts) — Créances/Stocks are live "right now" snapshots with no
  // historical trail, so showing them next to a past, already-closed exercice would be
  // meaningless. Default false so no caller gets memo content by accident.
  includeMemo?: boolean
}

export async function computeBilanPeriod(
  associationId: string,
  exercice:      ExerciceRef | null,
  options:       ComputeBilanOptions = {},
): Promise<BilanPeriod> {
  if (!exercice) return emptyPeriod(null)

  const actif  = emptySide("ACTIF")
  const passif = emptySide("PASSIF")
  const rubriqueByKey = new Map<string, BilanRubrique>(
    [...actif.rubriques, ...passif.rubriques].map(r => [r.key, r]),
  )
  const issues: BilanValidationIssue[] = []
  // Net credit-minus-debit of every classe 6/7 account posted under this exercice — this
  // exercice's own operating result, whether or not a following exercice has since closed over
  // it (closing never edits/deletes these lines — see JournalEntry's doc comment).
  let resultCents = 0

  const sums = await prisma.journalLine.groupBy({
    by:    ["chartAccountId"],
    where: { journalEntry: { associationId, exerciceId: exercice.id } },
    _sum:  { debit: true, credit: true },
  })

  if (sums.length > 0) {
    const accounts = await prisma.chartAccount.findMany({
      where:  { id: { in: sums.map(s => s.chartAccountId) } },
      select: { id: true, code: true, label: true, nature: true, normalSide: true },
    })
    const byId = new Map(accounts.map(a => [a.id, a]))

    for (const s of sums) {
      const account = byId.get(s.chartAccountId)
      if (!account) continue
      const debitCents  = Math.round(Number(s._sum.debit  ?? 0) * 100)
      const creditCents = Math.round(Number(s._sum.credit ?? 0) * 100)
      if (debitCents === 0 && creditCents === 0) continue

      if (account.nature === "CHARGE" || account.nature === "PRODUIT") {
        resultCents += creditCents - debitCents
        continue
      }

      // Positive = balance sits on the account's normal side, same convention as
      // journal/opening-balance.ts's computeAccountBalancesAsOf.
      const netCents = account.normalSide === "DEBIT" ? debitCents - creditCents : creditCents - debitCents
      if (netCents === 0) continue

      const match = rubriqueForAccountCode(account.code)
      if (!match) {
        issues.push({ code: "ACCOUNT_WITHOUT_RUBRIQUE", params: { code: account.code, label: account.label } })
        continue
      }

      const rubrique = rubriqueByKey.get(match.rubrique)!
      const amount   = (match.contra ? -netCents : netCents) / 100
      // 120000 literally reads "Résultat de l'exercice" as a ledger label (the name it's seeded
      // under for journal/opening-balance.ts's own entry lines), but from THIS exercice's own
      // Bilan it's the cumulative equity carried IN at the exercice's start — "Résultat de
      // l'exercice" is reserved below for the live classe 6/7 fold instead, matching standard
      // Fonds propres presentation (report à nouveau + résultat de l'exercice as two lines).
      // labelKey (translated client-side) overrides the raw account.label in that one case.
      const labelKey = account.code === RESULT_ACCOUNT_CODE ? "reportANouveau" as const : undefined
      rubrique.accounts.push({ chartAccountId: account.id, code: account.code, label: account.label, labelKey, amount })
      rubrique.total += amount
    }

    if (resultCents !== 0) {
      const fondsPropres = rubriqueByKey.get("fondsPropres")!
      const amount = resultCents / 100
      fondsPropres.accounts.push({
        chartAccountId: VIRTUAL_PERIOD_RESULT_ACCOUNT_ID,
        code:           "",
        label:          "",
        labelKey:       "resultatExercice",
        amount,
      })
      fondsPropres.total += amount
    }
  }

  // Memo rubriques (Créances, Stocks) — live snapshots from their own source tables, never
  // from JournalLine, computed independently of whether the journal has any activity at all.
  // See populateCreancesMemo/populateStocksMemo's own doc comments.
  if (options.includeMemo) {
    await populateCreancesMemo(associationId, rubriqueByKey.get("creances")!)
    await populateStocksMemo(associationId, rubriqueByKey.get("stocksEtEnCours")!)
  }

  // Memo rubriques are deliberately excluded here — they're not journalized, so they must
  // never affect the actif≠passif check (see ComputeBilanOptions's doc comment).
  actif.total  = actif.rubriques.filter(r => !r.isMemo).reduce((sum, r) => sum + r.total, 0)
  passif.total = passif.rubriques.filter(r => !r.isMemo).reduce((sum, r) => sum + r.total, 0)

  const diffCents = Math.round((actif.total - passif.total) * 100)
  const balanced  = diffCents === 0
  if (!balanced) {
    issues.push({
      code:   "ACTIF_PASSIF_MISMATCH",
      params: { actif: fmtAmount(actif.total), passif: fmtAmount(passif.total) },
    })
  }

  return { exercice, actif, passif, balanced, issues, resultOfPeriod: resultCents / 100 }
}

// Déjà en EN_RETARD: `cron/cotisation-status-sweep` ou l'absence d'un sweep équivalent pour
// Facture (voir facture-status.ts — EN_RETARD n'y est jamais stocké, seulement dérivé à la
// lecture) ne changent rien ici : les trois statuts "dû" (EN_ATTENTE/PARTIELLEMENT_PAYEE/
// EN_RETARD) sont déjà traités comme un seul groupe "en attente" par les figures existantes
// (dashboard, invoice-totals.ts) — on réutilise cette même définition, pas une nouvelle.
const COTISATION_OPEN_STATUSES: CotisationStatus[] = ["EN_ATTENTE", "PARTIELLEMENT_PAYEE", "EN_RETARD"]
const FACTURE_OPEN_STATUSES: FactureStatus[]       = ["EN_ATTENTE", "PARTIELLEMENT_PAYEE"]

// FORM-107 Grupo B — Créances, memo rubrique (see ComputeBilanOptions). Lit directement
// Cotisation/Facture, jamais JournalLine : il n'existe aucune reconnaissance en comptabilité
// d'un montant dû avant son encaissement (voir le contexte du plan — l'ajouter au journal
// obligerait postIncomeToJournal à distinguer un paiement "nouveau" d'un qui solde une créance
// déjà reconnue, pour ne pas compter le produit deux fois).
// Rounded in cents, not compared as raw floats — Decimal→Number subtraction on two aggregated
// sums (e.g. 100.10 - 50.05) can otherwise leave a trailing-cent artifact (49.999999999999996)
// that happens to format away on screen but would still throw off rubrique.total's own sum.
function roundCents(n: number): number {
  return Math.round(n * 100) / 100
}

async function populateCreancesMemo(associationId: string, rubrique: BilanRubrique): Promise<void> {
  // Facture splits "en attente" (not yet due) from "en retard" (overdue) — unlike Cotisation,
  // whose dashboard figures already lump EN_RETARD into the same "en attente" bucket (see
  // COTISATION_OPEN_STATUSES above), the dashboard's own invoice widget (invoice-totals.ts)
  // already shows these as two separate figures for Facture. Reusing factureStatusWhere here
  // (rather than re-deriving the dueDate comparison) keeps "what counts as overdue" defined in
  // exactly one place.
  const now              = new Date()
  const factureBaseWhere = { associationId, deletedAt: null, status: { in: FACTURE_OPEN_STATUSES } }

  const [cotisations, facturesAll, facturesOverdue] = await Promise.all([
    prisma.cotisation.aggregate({
      where: { associationId, status: { in: COTISATION_OPEN_STATUSES }, membre: { deletedAt: null } },
      _sum:  { amount: true, amountPaid: true },
    }),
    prisma.facture.aggregate({
      where: factureBaseWhere,
      _sum:  { total: true, amountPaid: true },
    }),
    prisma.facture.aggregate({
      where: { associationId, deletedAt: null, ...factureStatusWhere("EN_RETARD", now) },
      _sum:  { total: true, amountPaid: true },
    }),
  ])

  const cotisationsOutstanding     = roundCents(Number(cotisations._sum?.amount ?? 0) - Number(cotisations._sum?.amountPaid ?? 0))
  const facturesAllOutstanding     = roundCents(Number(facturesAll._sum?.total ?? 0) - Number(facturesAll._sum?.amountPaid ?? 0))
  const facturesOverdueOutstanding = roundCents(Number(facturesOverdue._sum?.total ?? 0) - Number(facturesOverdue._sum?.amountPaid ?? 0))
  const facturesOutstanding        = roundCents(facturesAllOutstanding - facturesOverdueOutstanding)

  if (cotisationsOutstanding > 0) {
    rubrique.accounts.push({ chartAccountId: "memo:creances-cotisations", code: "", label: "", labelKey: "creancesCotisations", amount: cotisationsOutstanding })
    rubrique.total += cotisationsOutstanding
  }
  if (facturesOutstanding > 0) {
    rubrique.accounts.push({ chartAccountId: "memo:creances-factures", code: "", label: "", labelKey: "creancesFactures", amount: facturesOutstanding })
    rubrique.total += facturesOutstanding
  }
  if (facturesOverdueOutstanding > 0) {
    rubrique.accounts.push({ chartAccountId: "memo:creances-factures-en-retard", code: "", label: "", labelKey: "creancesFacturesEnRetard", amount: facturesOverdueOutstanding })
    rubrique.total += facturesOverdueOutstanding
  }
}

// FORM-107 Grupo B — Stocks et en-cours, memo rubrique. `BoutiqueVariante.stock` (quantité) est
// fiable mais ne porte aucun coût d'achat avant la Fase 4 de ce plan (`costPrice`) — tant que ce
// champ est null sur une variante (produits existants, créés avant cette fonctionnalité), elle
// contribue 0 à l'estimation plutôt que de faire échouer le calcul. See the `caveat` set below
// for surfacing that instead of leaving it silent.
//
// Deliberately NOT filtered by BoutiqueProduit.status: a product taken off the storefront
// (DRAFT, not yet published, or ARCHIVED, no longer sold) can still have real, unsold physical
// stock sitting in storage — `status` is a storefront-visibility flag, not a disposal event.
// Excluding archived/draft products would understate this estimate for exactly the goods most
// likely to still be sitting around unsold; a treasurer who has actually disposed of or written
// off that stock should zero it out on the variante itself, not rely on this memo rubrique to
// infer it from `status`.
async function populateStocksMemo(associationId: string, rubrique: BilanRubrique): Promise<void> {
  const variantes = await prisma.boutiqueVariante.findMany({
    where:  { produit: { associationId } },
    select: { stock: true, costPrice: true },
  })
  const totalCents = variantes.reduce((sum, v) => sum + v.stock * (v.costPrice ?? 0), 0)
  if (totalCents > 0) {
    rubrique.accounts.push({ chartAccountId: "memo:stocks", code: "", label: "", labelKey: "stocksEstimatedValue", amount: totalCents / 100 })
    rubrique.total += totalCents / 100
  }
  const missingCostCount = variantes.filter(v => v.stock > 0 && v.costPrice == null).length
  if (missingCostCount > 0) {
    rubrique.caveat = { labelKey: "stocksMissingCostPrice", count: missingCostCount }
  }
}
