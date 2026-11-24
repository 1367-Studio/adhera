"use client"

import { useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FilterSelect } from "@/components/ui/filter-select"
import { SearchInput } from "@/components/ui/search-input"
import { useLicencasPaginated, useLicencaFilterOptions, type MembershipLicenseRow, type MembershipLicenseStatus } from "@/hooks/use-licencas"

const STATUS_VARIANT: Record<MembershipLicenseStatus, "default" | "secondary" | "outline"> = {
  A_SOLICITAR: "secondary",
  EM_ANDAMENTO: "outline",
  VALIDADA: "default",
  A_RENOVAR: "secondary",
}
const STATUS_LABEL_KEY: Record<MembershipLicenseStatus, string> = {
  A_SOLICITAR: "statusASolicitar",
  EM_ANDAMENTO: "statusEmAndamento",
  VALIDADA: "statusValidada",
  A_RENOVAR: "statusARenovar",
}

export function LicencasView() {
  const t = useTranslations("licencas")
  const [page, setPage]             = useState(1)
  const [search, setSearch]         = useState("")
  const [federation, setFederation] = useState("")
  const [season, setSeason]         = useState("")
  const [status, setStatus]         = useState("")

  const filters = { search: search || undefined, federation: federation || undefined, season: season || undefined, status: status || undefined }
  const { data, isLoading } = useLicencasPaginated(page, 20, filters)
  // Each dropdown narrows itself out of its own request (see the route/hook's own comment) —
  // passing federation/season/status together still lets the server apply the right exclusion
  // per list (federations ignore the federation filter, seasons ignore the season filter).
  const { data: filterOptions } = useLicencaFilterOptions({ federation: federation || undefined, season: season || undefined, status: status || undefined })

  const statusOptions = [
    { value: "A_SOLICITAR", label: t("statusASolicitar") },
    { value: "EM_ANDAMENTO", label: t("statusEmAndamento") },
    { value: "VALIDADA", label: t("statusValidada") },
    { value: "A_RENOVAR", label: t("statusARenovar") },
  ]
  const federationOptions = (filterOptions?.federations ?? []).map(f => ({ value: f, label: f }))
  const seasonOptions = (filterOptions?.seasons ?? []).map(s => ({ value: s, label: s }))

  const columns: Column<MembershipLicenseRow>[] = [
    { key: "membre", header: t("columns.membre"), cell: r => <Link href={`/dashboard/membres/${r.membre.id}`} className="hover:underline">{r.membre.firstName} {r.membre.lastName}</Link> },
    { key: "tier", header: t("columns.tier"), cell: r => r.cotisation.tier?.label ?? "—" },
    { key: "federation", header: t("columns.federation"), cell: r => r.federation },
    { key: "season", header: t("columns.season"), cell: r => r.season },
    { key: "licenseNumber", header: t("columns.licenseNumber"), cell: r => r.licenseNumber ?? "—" },
    { key: "status", header: t("columns.status"), cell: r => <Badge variant={STATUS_VARIANT[r.status]}>{t(STATUS_LABEL_KEY[r.status])}</Badge> },
  ]

  function handleExport() {
    const params = new URLSearchParams()
    if (filters.search) params.set("search", filters.search)
    if (filters.federation) params.set("federation", filters.federation)
    if (filters.season) params.set("season", filters.season)
    if (filters.status) params.set("status", filters.status)
    window.location.href = `/api/licencas/export?${params}`
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        action={
          <Button variant="outline" size="sm" onClick={handleExport}>
            <DownloadSimpleIcon className="mr-1.5 size-4" />
            {t("export")}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onValueChange={v => { setSearch(v); setPage(1) }}
          onClear={() => { setSearch(""); setPage(1) }}
          placeholder={t("filters.searchPlaceholder")}
          containerClassName="w-64"
        />
        <FilterSelect value={federation} onValueChange={v => { setFederation(v); setPage(1) }} options={federationOptions} placeholder={t("filters.allFederations")} />
        <FilterSelect value={season} onValueChange={v => { setSeason(v); setPage(1) }} options={seasonOptions} placeholder={t("filters.allSeasons")} />
        <FilterSelect value={status} onValueChange={v => { setStatus(v); setPage(1) }} options={statusOptions} placeholder={t("filters.allStatuses")} />
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        keyExtractor={r => r.id}
        empty={<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>}
        pagination={data ? { page: data.page, totalPages: data.totalPages, total: data.total, limit: data.limit, onPageChange: setPage } : undefined}
      />
    </div>
  )
}
