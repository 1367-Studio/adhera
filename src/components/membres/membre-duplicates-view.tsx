"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { formatDistanceToNow } from "date-fns"
import { toast } from "sonner"
import {
  useMembreDuplicates, useScanMembreDuplicates, useSetMembreDuplicateStatus,
  type MembreDuplicateStatusFilter,
} from "@/hooks/use-membre-duplicates"
import type { MembreDuplicateMatchListItem } from "@/lib/schemas"
import { DataTable, type Column } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchInput } from "@/components/ui/search-input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"

const PAGE_SIZE = 20

export function MembreDuplicatesView() {
  const t = useTranslations("membreDuplicates.list")
  const router = useRouter()
  const dateFnsLocale = getDateFnsLocale(useLocale() as Locale)

  const [statusFilter, setStatusFilter] = useState<MembreDuplicateStatusFilter>("PENDING")
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const basePath = "/api/membres/duplicates"
  const { data: result, isLoading } = useMembreDuplicates(basePath, {
    status: statusFilter, page, limit: PAGE_SIZE, search: search || undefined,
  })
  const matches = result?.data ?? []

  const scan = useScanMembreDuplicates(basePath)

  function handleSearch(value: string) {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(value); setPage(1) }, 300)
  }

  async function handleScan() {
    try {
      const summary = await scan.mutateAsync()
      toast.success(t("scanSuccess", { count: summary.pendingCount }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("scanError"))
    }
  }

  function matchedFieldLabel(field: string): string {
    return field === "EMAIL" ? t("matchedFields.EMAIL") : field === "NAME" ? t("matchedFields.NAME") : field
  }

  const columns: Column<MembreDuplicateMatchListItem>[] = [
    {
      key: "membreA", header: t("columns.membreA"),
      cell: match => (
        <div>
          <span className="font-medium">{match.membreA.firstName} {match.membreA.lastName}</span>
          {match.membreA.email && <span className="block text-xs text-muted-foreground">{match.membreA.email}</span>}
        </div>
      ),
    },
    {
      key: "membreB", header: t("columns.membreB"),
      cell: match => (
        <div>
          <span className="font-medium">{match.membreB.firstName} {match.membreB.lastName}</span>
          {match.membreB.email && <span className="block text-xs text-muted-foreground">{match.membreB.email}</span>}
        </div>
      ),
    },
    {
      key: "matchedFields", header: t("columns.matchedFields"),
      cell: match => (
        <span className="text-muted-foreground">{match.matchedFields.map(matchedFieldLabel).join(", ")}</span>
      ),
    },
    {
      key: "lastSeenAt", header: t("columns.detectedAt"),
      cell: match => (
        <span className="text-muted-foreground">
          {formatDistanceToNow(new Date(match.firstDetectedAt), { addSuffix: true, locale: dateFnsLocale })}
        </span>
      ),
    },
    {
      key: "status", header: t("columns.status"), className: "text-right",
      cell: match => (
        <div className="flex items-center justify-end gap-1.5">
          {match.autoDismissed && match.status === "DISMISSED" && <span className="text-xs text-muted-foreground">{t("autoDismissedLabel")}</span>}
          <Badge variant={match.status === "PENDING" ? "secondary" : match.status === "MERGED" ? "success" : "outline"}>
            {t(`status.${match.status}`)}
          </Badge>
        </div>
      ),
    },
    {
      key: "actions", header: "", className: "text-right",
      cell: match => (
        <div className="flex items-center justify-end gap-1">
          {match.status !== "MERGED" && (
            <Button variant="ghost" size="sm" onClick={() => router.push(`/dashboard/membres/duplicates/${match.id}`)}>
              {t("compareAction")}
            </Button>
          )}
          {match.status !== "MERGED" && <DismissButton basePath={basePath} id={match.id} status={match.status} />}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={<Button onClick={handleScan} disabled={scan.isPending}>{t("scanAction")}</Button>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          placeholder={t("searchPlaceholder")}
          value={searchInput}
          onValueChange={handleSearch}
          onClear={() => {
            if (debounceRef.current) clearTimeout(debounceRef.current)
            setSearchInput(""); setSearch(""); setPage(1)
          }}
          containerClassName="w-72"
        />
        <Select value={statusFilter} onValueChange={v => { setStatusFilter((v ?? "PENDING") as MembreDuplicateStatusFilter); setPage(1) }}>
          <SelectTrigger className="w-40">
            <SelectValue>{t(`status.${statusFilter}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">{t("status.PENDING")}</SelectItem>
            <SelectItem value="DISMISSED">{t("status.DISMISSED")}</SelectItem>
            <SelectItem value="MERGED">{t("status.MERGED")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={matches}
        loading={isLoading}
        keyExtractor={match => match.id}
        empty={search ? t("emptyForSearch", { search }) : t("empty")}
        pagination={result ? {
          page: result.page, totalPages: result.totalPages, total: result.total, limit: result.limit,
          onPageChange: setPage,
        } : undefined}
      />
    </div>
  )
}

// Toggles PENDING <-> DISMISSED. Dismissal is never a dead end — a pair ignored by mistake
// (or worth reconsidering later) must stay recoverable from the list itself, not just via
// direct DB access.
function DismissButton({ basePath, id, status }: { basePath: string; id: string; status: "PENDING" | "DISMISSED" }) {
  const t = useTranslations("membreDuplicates.list")
  const setStatus = useSetMembreDuplicateStatus(basePath, id)
  const target = status === "PENDING" ? "DISMISSED" : "PENDING"

  async function handleClick() {
    try {
      await setStatus.mutateAsync(target)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("scanError"))
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleClick} disabled={setStatus.isPending}>
      {target === "DISMISSED" ? t("dismissAction") : t("restoreAction")}
    </Button>
  )
}
