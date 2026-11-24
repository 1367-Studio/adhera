"use client"

import { useState } from "react"
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { WarningCircleIcon, DownloadSimpleIcon, ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { EmptyState } from "@/components/ui/empty-state"
import type { BilanAccountRow, BilanPeriod, BilanRubrique, BilanSide, BilanSideKey } from "@/lib/finance/bilan-shared"
import { sanitizeForFilename } from "@/lib/finance/income-statement-shared"
import { exportBilanPdf, type BilanPdfRow } from "@/lib/pdf/bilan-pdf-client"
import { JournalLineDrillDownModal, type JournalDrillDown } from "@/components/finances/journal-line-drill-down"

// The virtual "Résultat de l'exercice" fold and the Grupo B memo rows (see computeBilanPeriod)
// have no real JournalLine rows to drill into — neither is a postable account.
const NON_DRILLABLE_PREFIXES = ["virtual:", "memo:"]

type ExerciceOption = { id: string; label: string; startDate: string; endDate: string }

type ApiResponse = {
  exercices: ExerciceOption[]
  current:   BilanPeriod | null
  previous:  BilanPeriod | null
}

async function fetchBilan(exerciceId: string): Promise<ApiResponse> {
  const params = exerciceId ? `?exerciceId=${exerciceId}` : ""
  const res = await fetch(`/api/finances/rapports/bilan${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json()
}

const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

// Same UTC-midnight display fix already established in reports-view.tsx/exercices-view.tsx —
// exercice boundaries are stored at UTC midnight, a plain local-timezone format would shift
// the displayed date for anyone west of UTC.
const fmtExerciceDate = (d: string | Date) => new Date(d).toLocaleDateString("fr-FR", { timeZone: "UTC" })

function previousRubriqueFor(previous: BilanPeriod | null, side: BilanSideKey, key: BilanRubrique["key"]): BilanRubrique | null {
  if (!previous) return null
  const bilanSide = side === "ACTIF" ? previous.actif : previous.passif
  return bilanSide.rubriques.find(r => r.key === key) ?? null
}

// account.code is empty only for the virtual "Résultat de l'exercice" fold (see
// computeBilanPeriod) — chartAccountId is still a stable match key for it across periods
// because bilan.ts always writes that same literal virtual id.
function accountLabel(account: BilanAccountRow, t: ReturnType<typeof useTranslations>): string {
  if (account.labelKey) return t(`accountLabels.${account.labelKey}`)
  return account.code ? `${account.code} — ${account.label}` : account.label
}

// The N-1 column is always rendered — per FORM-107, a missing comparative must say so
// explicitly ("Comparatif indisponible", already the fallback baked into previousYearLabel),
// never just vanish as if nothing was ever going to be there.
function SideTable({ side, sideKey, previous, previousYearLabel, currentYearLabel, onOpenDrillDown }: {
  side:              BilanPeriod["actif"]
  sideKey:           BilanSideKey
  previous:          BilanPeriod | null
  previousYearLabel: string | undefined
  currentYearLabel:  string | undefined
  onOpenDrillDown:   (account: BilanAccountRow) => void
}) {
  const t = useTranslations("finances.bilan")
  const titleKey = sideKey === "ACTIF" ? "actif" : "passif"
  const totalKey = sideKey === "ACTIF" ? "totalActif" : "totalPassif"
  const previousSide = previous ? (sideKey === "ACTIF" ? previous.actif : previous.passif) : null

  // Memo rubriques (Créances, Stocks — see ComputeBilanOptions) render after the real total,
  // behind a divider and a fixed notice, so "Total actif" never silently includes a figure
  // that isn't actually in the ledger.
  const journalRubriques = side.rubriques.filter(r => !r.isMemo)
  const memoRubriques    = side.rubriques.filter(r => r.isMemo && r.accounts.length > 0)

  return (
    <div className="min-w-0">
      <h3 className="text-sm font-semibold mb-2">{t(titleKey)}</h3>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="py-2 pl-4 pr-3 text-left font-medium text-muted-foreground">{t("rubriqueColumnLabel")}</th>
              <th className="py-2 px-3 text-right font-medium text-muted-foreground w-32">{currentYearLabel}</th>
              <th className="py-2 pr-4 pl-3 text-right font-medium text-muted-foreground w-32">{previousYearLabel}</th>
            </tr>
          </thead>
          <tbody>
            {journalRubriques.map(rubrique => (
              <RubriqueBlock
                key={rubrique.key}
                rubrique={rubrique}
                previousRubrique={previousRubriqueFor(previous, sideKey, rubrique.key)}
                onOpenDrillDown={onOpenDrillDown}
              />
            ))}
            <tr className="border-t-2 border-foreground/20">
              <td className="py-2 pl-4 pr-3 font-semibold">{t(totalKey)}</td>
              <td className="py-2 px-3 text-right font-semibold tabular-nums">{fmt(side.total)}</td>
              <td className="py-2 pr-4 pl-3 text-right font-semibold tabular-nums text-muted-foreground">{previousSide ? fmt(previousSide.total) : ""}</td>
            </tr>
            {memoRubriques.length > 0 && (
              <tr className="border-t border-dashed">
                <td colSpan={3} className="pt-3 pb-1 pl-4 text-xs italic text-muted-foreground">
                  {t("memoNotice")}
                </td>
              </tr>
            )}
            {memoRubriques.map(rubrique => (
              <RubriqueBlock
                key={rubrique.key}
                rubrique={rubrique}
                previousRubrique={null}
                onOpenDrillDown={onOpenDrillDown}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RubriqueBlock({ rubrique, previousRubrique, onOpenDrillDown }: {
  rubrique:         BilanRubrique
  previousRubrique: BilanRubrique | null
  onOpenDrillDown:  (account: BilanAccountRow) => void
}) {
  const t = useTranslations("finances.bilan")
  const previousTotal = previousRubrique?.total ?? 0
  if (rubrique.accounts.length === 0 && previousTotal === 0) return null

  const previousByAccountId = new Map((previousRubrique?.accounts ?? []).map(a => [a.chartAccountId, a.amount]))
  // Memo rubriques (Créances, Stocks) never carry a previous-period figure — they're a live
  // snapshot with no historical trail (see ComputeBilanOptions) — so a blank N-1 cell here
  // would read as missing data next to a header that otherwise shows a real prior exercice.
  // Say so explicitly instead of leaving it blank.
  const previousCell = (value: number | undefined) => {
    if (rubrique.isMemo) return <span className="italic text-muted-foreground/60">{t("memoNoHistory")}</span>
    return value !== undefined ? fmt(value) : ""
  }

  return (
    <>
      <tr className="border-b">
        <td colSpan={3} className="pt-3 pb-1 pl-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(`rubriques.${rubrique.key}`)}
          </div>
        </td>
      </tr>
      {rubrique.accounts.length > 0 ? rubrique.accounts.map(account => {
        const clickable = !NON_DRILLABLE_PREFIXES.some(p => account.chartAccountId.startsWith(p))
        return (
          <tr
            key={account.chartAccountId}
            className={`border-b last:border-0 ${clickable ? "cursor-pointer hover:bg-muted/40" : ""}`}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => onOpenDrillDown(account) : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenDrillDown(account) } } : undefined}
          >
            <td className="py-1.5 pl-4 pr-3 text-muted-foreground">{accountLabel(account, t)}</td>
            <td className="py-1.5 px-3 text-right tabular-nums">{fmt(account.amount)}</td>
            <td className="py-1.5 pr-4 pl-3 text-right tabular-nums text-muted-foreground">
              {previousCell(previousByAccountId.get(account.chartAccountId))}
            </td>
          </tr>
        )
      }) : (
        <tr className="border-b last:border-0">
          <td colSpan={3} className="py-2 pl-4 text-xs text-muted-foreground italic">
            {t("noAccountsInRubrique")}
          </td>
        </tr>
      )}
      <tr className="border-b last:border-0">
        <td className="py-1.5 pl-4 pr-3 text-sm font-medium">{t(`rubriques.${rubrique.key}`)}</td>
        <td className="py-1.5 px-3 text-right text-sm font-medium tabular-nums">{fmt(rubrique.total)}</td>
        <td className="py-1.5 pr-4 pl-3 text-right text-sm font-medium tabular-nums text-muted-foreground">
          {previousCell(previousRubrique ? previousTotal : undefined)}
        </td>
      </tr>
      {rubrique.caveat && (
        <tr className="border-b last:border-0">
          <td colSpan={3} className="py-1 pl-4 pr-3 text-xs italic text-muted-foreground">
            {t(`caveats.${rubrique.caveat.labelKey}`, { count: rubrique.caveat.count })}
          </td>
        </tr>
      )}
    </>
  )
}

// Mirrors RubriqueBlock's own render/skip rules exactly — the PDF must show the same rubriques,
// accounts and totals as the screen (FORM-107's "le PDF et la tela usam o mesmo cálculo").
function buildPdfRows(side: BilanSide, previousSide: BilanSide | null, t: ReturnType<typeof useTranslations>, totalLabel: string): BilanPdfRow[] {
  const rows: BilanPdfRow[] = []

  function pushRubrique(rubrique: BilanSide["rubriques"][number]) {
    // Memo rubriques (Créances, Stocks) structurally exist on every period's BilanSide (just
    // empty on past ones — see computeBilanPeriod), so a plain lookup here would find an
    // empty-but-present rubrique and print "0,00 €" for the prior exercice — unlike the screen,
    // which deliberately shows no prior-period figure for them at all (see RubriqueBlock).
    // Force the same null here so the PDF and the screen never disagree.
    const previousRubrique = rubrique.isMemo ? null : (previousSide?.rubriques.find(r => r.key === rubrique.key) ?? null)
    const previousTotal = previousRubrique?.total ?? 0
    if (rubrique.accounts.length === 0 && previousTotal === 0) return

    const previousByAccountId = new Map((previousRubrique?.accounts ?? []).map(a => [a.chartAccountId, a.amount]))
    const rubriqueLabel = t(`rubriques.${rubrique.key}`)
    rows.push({ label: rubriqueLabel, current: null, previous: null, bold: true })
    for (const account of rubrique.accounts) {
      rows.push({
        label:    accountLabel(account, t),
        current:  account.amount,
        previous: previousByAccountId.has(account.chartAccountId) ? previousByAccountId.get(account.chartAccountId)! : null,
      })
    }
    rows.push({ label: rubriqueLabel, current: rubrique.total, previous: previousRubrique ? previousTotal : null, bold: true })
    if (rubrique.caveat) {
      rows.push({ label: t(`caveats.${rubrique.caveat.labelKey}`, { count: rubrique.caveat.count }), current: null, previous: null })
    }
  }

  const journalRubriques = side.rubriques.filter(r => !r.isMemo)
  const memoRubriques    = side.rubriques.filter(r => r.isMemo && r.accounts.length > 0)
  journalRubriques.forEach(pushRubrique)
  rows.push({ label: totalLabel, current: side.total, previous: previousSide ? previousSide.total : null, bold: true })
  if (memoRubriques.length > 0) {
    rows.push({ label: t("memoNotice"), current: null, previous: null })
    memoRubriques.forEach(pushRubrique)
  }
  return rows
}

export function BilanView() {
  const t = useTranslations("finances.bilan")
  const queryClient = useQueryClient()
  const [exerciceId, setExerciceId] = useState("")
  const [drillDown, setDrillDown] = useState<JournalDrillDown | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["bilan", exerciceId],
    queryFn:  () => fetchBilan(exerciceId),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })

  const exercices = data?.exercices ?? []
  const current    = data?.current  ?? null
  const previous   = data?.previous ?? null

  const selectedExerciceId = exerciceId || current?.exercice?.id || ""
  const selectedExercice   = exercices.find(e => e.id === selectedExerciceId)

  const currentYearLabel  = selectedExercice?.label
  const previousYearLabel = previous?.exercice?.label ?? t("noPreviousExercice")

  const noExercice = !isLoading && exercices.length === 0
  // Memo rubriques (Créances, Stocks) count too — they're real, useful information even on an
  // exercice that has nothing journalized yet (see computeBilanPeriod/ComputeBilanOptions).
  const hasLedgerActivity = Boolean(
    current && (current.actif.rubriques.some(r => r.accounts.length > 0) || current.passif.rubriques.some(r => r.accounts.length > 0)),
  )
  const periodRange = selectedExercice
    ? `${fmtExerciceDate(selectedExercice.startDate)} → ${fmtExerciceDate(selectedExercice.endDate)}`
    : null

  // Exporting IS the "validate as definitive" action FORM-107 asks for — there's no separate
  // persisted Bilan record to lock, so the gate is simply: don't let a treasurer walk away with
  // a PDF of a Bilan that has unresolved issues (missing opening entry, account without a
  // rubrique, actif≠passif, or a result divergence). The draft itself — this screen, with its
  // warning banner — stays visible either way.
  const exportDisabled = !current?.exercice || current.issues.length > 0

  function openDrillDown(account: BilanAccountRow) {
    if (!current?.exercice) return
    setDrillDown({ title: accountLabel(account, t), chartAccountId: account.chartAccountId, exerciceId: current.exercice.id })
  }

  // Manual, on-demand sync — see the RESULT_DIVERGENCE issue message below, which already
  // promises "relancez la synchronisation": this is what makes that promise true. Reuses the
  // same catch-up (`ensurePostedJournalEntries`) the exercice-closing route runs, just callable
  // without closing anything (see src/app/api/finances/rapports/bilan/refresh/route.ts).
  async function refreshLedger() {
    if (!current?.exercice) return
    setRefreshing(true)
    try {
      const res = await fetch("/api/finances/rapports/bilan/refresh", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ exerciceId: current.exercice.id }),
      })
      if (!res.ok) throw new Error("refresh failed")
      const { posted, reversed } = await res.json() as { posted: number; reversed: number }
      const message = t("refreshLedgerSuccessPosted", { count: posted }) + t("refreshLedgerSuccessReversed", { count: reversed })
      toast.success(message)
      await queryClient.invalidateQueries({ queryKey: ["bilan"] })
    } catch {
      toast.error(t("refreshLedgerError"))
    } finally {
      setRefreshing(false)
    }
  }

  function exportPdf() {
    if (!current?.exercice) return
    const periodLabel = t("pdf.periodLabel", {
      start: fmtExerciceDate(current.exercice.startDate),
      end:   fmtExerciceDate(current.exercice.endDate),
    })
    exportBilanPdf({
      title:          t("title"),
      rubriqueLabel:  t("rubriqueColumnLabel"),
      currentLabel:   currentYearLabel ?? current.exercice.label,
      previousLabel:  previousYearLabel,
      actifTitle:     t("actif"),
      passifTitle:    t("passif"),
      actifRows:      buildPdfRows(current.actif, previous?.actif ?? null, t, t("totalActif")),
      passifRows:     buildPdfRows(current.passif, previous?.passif ?? null, t, t("totalPassif")),
      periodLabel,
      fileNameSuffix: sanitizeForFilename(current.exercice.label),
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        action={
          !noExercice && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Select
                  value={selectedExerciceId}
                  onValueChange={(v) => setExerciceId(v ?? selectedExerciceId)}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue>{selectedExercice?.label ?? t("exerciceLabel")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {exercices.map(e => <SelectItem key={e.id} value={e.id}>{e.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Tooltip>
                  <TooltipTrigger render={
                    <Button size="sm" variant="outline" disabled={refreshing || !current?.exercice} onClick={refreshLedger} />
                  }>
                    <ArrowsClockwiseIcon className={`mr-1.5 size-4 ${refreshing ? "animate-spin" : ""}`} />
                    {t("refreshLedger")}
                  </TooltipTrigger>
                  <TooltipContent>{t("refreshLedgerTooltip")}</TooltipContent>
                </Tooltip>
                <span title={exportDisabled && current ? t("exportDisabledTooltip") : undefined}>
                  <Button size="sm" variant="outline" disabled={exportDisabled} onClick={exportPdf}>
                    <DownloadSimpleIcon className="mr-1.5 size-4" />
                    {t("exportPdf")}
                  </Button>
                </span>
              </div>
              {periodRange && <span className="text-xs text-muted-foreground pl-0.5">{periodRange}</span>}
            </div>
          )
        }
      />

      {noExercice ? (
        <EmptyState title={t("emptyExercice.title")} description={t("emptyExercice.description")} />
      ) : isLoading || !current ? (
        <div className="h-72 animate-pulse rounded-lg border bg-muted/30" />
      ) : !hasLedgerActivity ? (
        <EmptyState title={t("emptyLedger.title")} description={t("emptyLedger.description")} />
      ) : (
        <>
          {current.issues.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 flex items-start gap-2">
              <WarningCircleIcon className="size-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-medium">{t("issues.title")}</p>
                {current.issues.map((issue, i) => <p key={i}>{t(`issues.messages.${issue.code}`, issue.params)}</p>)}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SideTable
              side={current.actif} sideKey="ACTIF" previous={previous}
              previousYearLabel={previousYearLabel} currentYearLabel={currentYearLabel}
              onOpenDrillDown={openDrillDown}
            />
            <SideTable
              side={current.passif} sideKey="PASSIF" previous={previous}
              previousYearLabel={previousYearLabel} currentYearLabel={currentYearLabel}
              onOpenDrillDown={openDrillDown}
            />
          </div>
        </>
      )}

      <JournalLineDrillDownModal drillDown={drillDown} onClose={() => setDrillDown(null)} />
    </div>
  )
}
