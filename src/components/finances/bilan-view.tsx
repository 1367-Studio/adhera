"use client"

import { useState } from "react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr"
import { PageHeader } from "@/components/ui/page-header"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import type { BilanAccountRow, BilanPeriod, BilanRubrique, BilanSideKey } from "@/lib/finance/bilan-shared"

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

function SideTable({ side, sideKey, previous, hasPrevious, previousYearLabel, currentYearLabel }: {
  side:              BilanPeriod["actif"]
  sideKey:           BilanSideKey
  previous:          BilanPeriod | null
  hasPrevious:       boolean
  previousYearLabel: string | undefined
  currentYearLabel:  string | undefined
}) {
  const t = useTranslations("finances.bilan")
  const titleKey = sideKey === "ACTIF" ? "actif" : "passif"
  const totalKey = sideKey === "ACTIF" ? "totalActif" : "totalPassif"
  const previousSide = previous ? (sideKey === "ACTIF" ? previous.actif : previous.passif) : null

  return (
    <div className="min-w-0">
      <h3 className="text-sm font-semibold mb-2">{t(titleKey)}</h3>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="py-2 pl-4 pr-3 text-left font-medium text-muted-foreground">{t("rubriqueColumnLabel")}</th>
              <th className="py-2 px-3 text-right font-medium text-muted-foreground w-32">{currentYearLabel}</th>
              {hasPrevious && (
                <th className="py-2 pr-4 pl-3 text-right font-medium text-muted-foreground w-32">{previousYearLabel}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {side.rubriques.map(rubrique => (
              <RubriqueBlock
                key={rubrique.key}
                rubrique={rubrique}
                previousRubrique={previousRubriqueFor(previous, sideKey, rubrique.key)}
                hasPrevious={hasPrevious}
              />
            ))}
            <tr className="border-t-2 border-foreground/20">
              <td className="py-2 pl-4 pr-3 font-semibold">{t(totalKey)}</td>
              <td className="py-2 px-3 text-right font-semibold tabular-nums">{fmt(side.total)}</td>
              {hasPrevious && (
                <td className="py-2 pr-4 pl-3 text-right font-semibold tabular-nums text-muted-foreground">{fmt(previousSide?.total ?? 0)}</td>
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RubriqueBlock({ rubrique, previousRubrique, hasPrevious }: {
  rubrique:         BilanRubrique
  previousRubrique: BilanRubrique | null
  hasPrevious:      boolean
}) {
  const t = useTranslations("finances.bilan")
  const previousTotal = previousRubrique?.total ?? 0
  if (rubrique.accounts.length === 0 && previousTotal === 0) return null

  const previousByAccountId = new Map((previousRubrique?.accounts ?? []).map(a => [a.chartAccountId, a.amount]))

  return (
    <>
      <tr className="border-b">
        <td colSpan={hasPrevious ? 3 : 2} className="pt-3 pb-1 pl-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(`rubriques.${rubrique.key}`)}
          </div>
        </td>
      </tr>
      {rubrique.accounts.length > 0 ? rubrique.accounts.map(account => (
        <tr key={account.chartAccountId} className="border-b last:border-0">
          <td className="py-1.5 pl-4 pr-3 text-muted-foreground">{accountLabel(account, t)}</td>
          <td className="py-1.5 px-3 text-right tabular-nums">{fmt(account.amount)}</td>
          {hasPrevious && (
            <td className="py-1.5 pr-4 pl-3 text-right tabular-nums text-muted-foreground">
              {previousByAccountId.has(account.chartAccountId) ? fmt(previousByAccountId.get(account.chartAccountId)!) : ""}
            </td>
          )}
        </tr>
      )) : (
        <tr className="border-b last:border-0">
          <td colSpan={hasPrevious ? 3 : 2} className="py-2 pl-4 text-xs text-muted-foreground italic">
            {t("noAccountsInRubrique")}
          </td>
        </tr>
      )}
      <tr className="border-b last:border-0">
        <td className="py-1.5 pl-4 pr-3 text-sm font-medium">{t(`rubriques.${rubrique.key}`)}</td>
        <td className="py-1.5 px-3 text-right text-sm font-medium tabular-nums">{fmt(rubrique.total)}</td>
        {hasPrevious && (
          <td className="py-1.5 pr-4 pl-3 text-right text-sm font-medium tabular-nums text-muted-foreground">{fmt(previousTotal)}</td>
        )}
      </tr>
    </>
  )
}

export function BilanView() {
  const t = useTranslations("finances.bilan")
  const [exerciceId, setExerciceId] = useState("")

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

  const hasPrevious   = Boolean(previous?.exercice)
  const previousLabel = previous?.exercice?.label ?? t("noPreviousExercice")

  const currentYearLabel  = selectedExercice?.label
  const previousYearLabel = previous?.exercice?.label ?? previousLabel

  const noExercice = !isLoading && exercices.length === 0
  const hasLedgerActivity = Boolean(
    current && (current.actif.rubriques.some(r => r.accounts.length > 0) || current.passif.rubriques.some(r => r.accounts.length > 0)),
  )
  const periodRange = selectedExercice
    ? `${fmtExerciceDate(selectedExercice.startDate)} → ${fmtExerciceDate(selectedExercice.endDate)}`
    : null

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        action={
          !noExercice && (
            <div className="flex flex-col gap-1">
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
              hasPrevious={hasPrevious} previousYearLabel={previousYearLabel} currentYearLabel={currentYearLabel}
            />
            <SideTable
              side={current.passif} sideKey="PASSIF" previous={previous}
              hasPrevious={hasPrevious} previousYearLabel={previousYearLabel} currentYearLabel={currentYearLabel}
            />
          </div>
        </>
      )}
    </div>
  )
}
