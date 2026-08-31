"use client"

import { useTranslations } from "next-intl"
import { Modal } from "@/components/ui/modal"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export type MembresStatsBucket = {
  count:            number
  hommes:           number
  femmes:           number
  sexeNonRenseigne: number
  adultes:          number
  enfants:          number
  ageNonRenseigne:  number
}

export type MembresStats = MembresStatsBucket & {
  adherents: MembresStatsBucket
  benevoles: MembresStatsBucket
}

type Row = { label: string; values: number[]; strong?: boolean }

function StatsTable({ headers, rows, showLabels }: { headers: string[]; rows: Row[]; showLabels: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
          {showLabels && <TableHead className="w-1/3" />}
          {headers.map((h) => (
            <TableHead key={h} className="text-right font-normal text-muted-foreground">
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.label} className="hover:bg-transparent dark:hover:bg-transparent">
            {showLabels && (
              <TableCell className={row.strong ? "font-medium" : "text-muted-foreground"}>
                {row.label}
              </TableCell>
            )}
            {row.values.map((v, i) => (
              <TableCell key={i} className={`text-right tabular-nums${row.strong ? " font-medium" : ""}`}>
                {v}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function MembresStatsModal({
  open,
  onOpenChange,
  stats,
  showMembership,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  stats?: MembresStats
  /** The adhérent/bénévole split only means something when the cotisations module is on. */
  showMembership: boolean
}) {
  const t = useTranslations()

  function buildRows(pick: (b: MembresStatsBucket) => number[]): Row[] {
    if (!stats) return []
    if (!showMembership) return [{ label: t("membres.view.statsTotal"), values: pick(stats) }]
    return [
      { label: t("membres.view.statsAdherents"), values: pick(stats.adherents) },
      { label: t("membres.view.statsBenevoles"), values: pick(stats.benevoles) },
      { label: t("membres.view.statsTotal"),     values: pick(stats), strong: true },
    ]
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("membres.view.statsTitle")} size="xl">
      {!stats ? (
        <div className="space-y-3 py-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-6 pb-1">
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("membres.view.statsSex")}</h3>
            <StatsTable
              showLabels={showMembership}
              headers={[
                t("membres.view.statsTotal"),
                t("membres.view.statsMen"),
                t("membres.view.statsWomen"),
                t("membres.view.statsUnknown"),
              ]}
              rows={buildRows((b) => [b.count, b.hommes, b.femmes, b.sexeNonRenseigne])}
            />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("membres.view.statsAge")}</h3>
            <StatsTable
              showLabels={showMembership}
              headers={[
                t("membres.view.statsAdults"),
                t("membres.view.statsChildren"),
                t("membres.view.statsUnknown"),
              ]}
              rows={buildRows((b) => [b.adultes, b.enfants, b.ageNonRenseigne])}
            />
          </section>
        </div>
      )}
    </Modal>
  )
}
