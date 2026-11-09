"use client"

import { useTranslations } from "next-intl"
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import type { DistributionGroup, CotisationsSummary } from "@/hooks/use-cotisations"

const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

export function CotisationsDistribution({ groups, total, loading }: {
  groups:  DistributionGroup[]
  total:   CotisationsSummary
  loading: boolean
}) {
  const t = useTranslations("cotisations.view.distribution")
  // Shares the filter dropdown's "Automatique"/"Manuel" labels (cotisations.view.renewal.*)
  // rather than duplicating them in the distribution namespace.
  const tRenewal = useTranslations("cotisations.view.renewal")

  if (loading) {
    return <div className="rounded-lg border p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
  }

  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">{t("empty")}</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("category")}</TableHead>
          <TableHead>{t("renewal")}</TableHead>
          <TableHead className="text-right">{t("count")}</TableHead>
          <TableHead className="text-right">{t("aPagar")}</TableHead>
          <TableHead className="text-right">{t("recebido")}</TableHead>
          <TableHead className="text-right">{t("saldo")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map(g => (
          <TableRow key={`${g.tierId ?? "none"}-${g.renewalMode}`}>
            <TableCell>{g.tierLabel ?? t("noCategory")}</TableCell>
            <TableCell>{g.renewalMode === "AUTO" ? tRenewal("automatic") : tRenewal("manual")}</TableCell>
            <TableCell className="text-right tabular-nums">{g.count}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(g.aPagar)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(g.recebido)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(g.saldo)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={2}>{t("total")}</TableCell>
          <TableCell className="text-right tabular-nums">{total.count}</TableCell>
          <TableCell className="text-right tabular-nums">{fmt(total.aPagar)}</TableCell>
          <TableCell className="text-right tabular-nums">{fmt(total.recebido)}</TableCell>
          <TableCell className="text-right tabular-nums">{fmt(total.saldo)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}
