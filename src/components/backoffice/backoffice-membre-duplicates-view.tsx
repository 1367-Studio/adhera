"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { formatDistanceToNow } from "date-fns"
import { toast } from "sonner"
import {
  useMembreDuplicates, useScanMembreDuplicates, useSetMembreDuplicateStatus,
  useBackofficeAssociationSearch, type MembreDuplicateStatusFilter,
} from "@/hooks/use-membre-duplicates"
import type { MembreDuplicateMatchListItem } from "@/lib/schemas"
import { DataTable, type Column } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchInput } from "@/components/ui/search-input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from "@/components/ui/command"
import { XIcon } from "@phosphor-icons/react/dist/ssr"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"

const PAGE_SIZE = 20
const BASE_PATH = "/api/backoffice/membre-duplicates"

type BackofficeMatch = MembreDuplicateMatchListItem & { associationName?: string }

function AssociationPicker({ onScan, scanning }: { onScan: (associationId: string) => void; scanning: boolean }) {
  const t = useTranslations("membreDuplicates.backoffice")
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleQueryChange(value: string) {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 250)
  }

  const { data: result, isLoading } = useBackofficeAssociationSearch(debouncedQuery)
  const candidates = result?.data ?? []

  return (
    <div className="flex flex-wrap items-start gap-2">
      {selected ? (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
          <span className="text-sm font-medium">{selected.name}</span>
          <Button variant="ghost" size="icon-sm" aria-label={t("changeAssociation")} onClick={() => setSelected(null)}>
            <XIcon className="size-4" />
          </Button>
        </div>
      ) : (
        <Command className="w-72 rounded-lg! border" shouldFilter={false}>
          <CommandInput value={query} onValueChange={handleQueryChange} placeholder={t("associationSearchPlaceholder")} />
          <CommandList>
            {!debouncedQuery ? (
              <CommandEmpty>{t("typeToSearch")}</CommandEmpty>
            ) : isLoading ? (
              <div className="p-3 text-sm text-muted-foreground">{t("loading")}</div>
            ) : candidates.length === 0 ? (
              <CommandEmpty>{t("noResults")}</CommandEmpty>
            ) : (
              candidates.map(association => (
                <CommandItem key={association.id} value={association.name} onSelect={() => setSelected(association)}>
                  {association.name}
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      )}
      <Button onClick={() => selected && onScan(selected.id)} disabled={!selected || scanning}>
        {t("scanAction")}
      </Button>
    </div>
  )
}

export function BackofficeMembreDuplicatesView() {
  const t = useTranslations("membreDuplicates.backoffice")
  const tList = useTranslations("membreDuplicates.list")
  const router = useRouter()
  const dateFnsLocale = getDateFnsLocale(useLocale() as Locale)

  const [statusFilter, setStatusFilter] = useState<MembreDuplicateStatusFilter>("PENDING")
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const { data: result, isLoading } = useMembreDuplicates(BASE_PATH, {
    status: statusFilter, page, limit: PAGE_SIZE, search: search || undefined,
  })
  const matches = (result?.data ?? []) as BackofficeMatch[]

  const scan = useScanMembreDuplicates(BASE_PATH)

  function handleSearch(value: string) {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(value); setPage(1) }, 300)
  }

  async function handleScan(associationId: string) {
    try {
      const summary = await scan.mutateAsync({ associationId })
      toast.success(tList("scanSuccess", { count: summary.pendingCount }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tList("scanError"))
    }
  }

  function matchedFieldLabel(field: string): string {
    return field === "EMAIL" ? tList("matchedFields.EMAIL") : field === "NAME" ? tList("matchedFields.NAME") : field
  }

  const columns: Column<BackofficeMatch>[] = [
    {
      key: "membreA", header: tList("columns.membreA"),
      cell: match => (
        <div>
          <span className="font-medium">{match.membreA.firstName} {match.membreA.lastName}</span>
          {match.membreA.email && <span className="block text-xs text-muted-foreground">{match.membreA.email}</span>}
        </div>
      ),
    },
    {
      key: "membreB", header: tList("columns.membreB"),
      cell: match => (
        <div>
          <span className="font-medium">{match.membreB.firstName} {match.membreB.lastName}</span>
          {match.membreB.email && <span className="block text-xs text-muted-foreground">{match.membreB.email}</span>}
        </div>
      ),
    },
    {
      key: "association", header: t("columns.association"),
      cell: match => (
        <Link href={`/backoffice/associations/${match.associationId}`} className="hover:underline">
          {match.associationName}
        </Link>
      ),
    },
    {
      key: "matchedFields", header: tList("columns.matchedFields"),
      cell: match => <span className="text-muted-foreground">{match.matchedFields.map(matchedFieldLabel).join(", ")}</span>,
    },
    {
      key: "lastSeenAt", header: tList("columns.detectedAt"),
      cell: match => (
        <span className="text-muted-foreground">
          {formatDistanceToNow(new Date(match.firstDetectedAt), { addSuffix: true, locale: dateFnsLocale })}
        </span>
      ),
    },
    {
      key: "status", header: tList("columns.status"), className: "text-right",
      cell: match => (
        <Badge variant={match.status === "PENDING" ? "secondary" : match.status === "MERGED" ? "success" : "outline"}>
          {tList(`status.${match.status}`)}
        </Badge>
      ),
    },
    {
      key: "actions", header: "", className: "text-right",
      cell: match => (
        <div className="flex items-center justify-end gap-1">
          {match.status !== "MERGED" && (
            <Button variant="ghost" size="sm" onClick={() => router.push(`/backoffice/membre-duplicates/${match.id}`)}>
              {tList("compareAction")}
            </Button>
          )}
          {match.status !== "MERGED" && <DismissButton id={match.id} status={match.status} />}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <AssociationPicker onScan={handleScan} scanning={scan.isPending} />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          placeholder={tList("searchPlaceholder")}
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
            <SelectValue>{tList(`status.${statusFilter}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">{tList("status.PENDING")}</SelectItem>
            <SelectItem value="DISMISSED">{tList("status.DISMISSED")}</SelectItem>
            <SelectItem value="MERGED">{tList("status.MERGED")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={matches}
        loading={isLoading}
        keyExtractor={match => match.id}
        empty={search ? tList("emptyForSearch", { search }) : tList("empty")}
        pagination={result ? {
          page: result.page, totalPages: result.totalPages, total: result.total, limit: result.limit,
          onPageChange: setPage,
        } : undefined}
      />
    </div>
  )
}

// Toggles PENDING <-> DISMISSED — same reasoning as the dashboard list's own DismissButton:
// dismissal must stay recoverable from the list, not just via direct DB access.
function DismissButton({ id, status }: { id: string; status: "PENDING" | "DISMISSED" }) {
  const t = useTranslations("membreDuplicates.list")
  const setStatus = useSetMembreDuplicateStatus(BASE_PATH, id)
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
