"use client"

import { useState, useRef, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { DownloadIcon, SearchIcon, XIcon, HeartHandshakeIcon, UsersIcon, TrendingUpIcon } from "lucide-react"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

type Don = {
  id:            string
  firstName:     string
  lastName:      string
  email:         string
  amount:        string
  message:       string | null
  anonymous:     boolean
  paidAt:        string | null
  receiptNumber: string | null
}

type DonsResult = {
  data:        Don[]
  total:       number
  page:        number
  limit:       number
  totalPages:  number
  totalAmount: number
  totalCount:  number
}

const currentYear = new Date().getFullYear()
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i)
const PAGE_SIZE   = 25

export default function DonsPage() {
  const [page, setPage]               = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch]           = useState("")
  const [yearFilter, setYearFilter]   = useState<number>(currentYear)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function handleSearch(val: string) {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(val); setPage(1) }, 300)
  }

  const params = new URLSearchParams({
    page:  String(page),
    limit: String(PAGE_SIZE),
    year:  String(yearFilter),
    ...(search ? { search } : {}),
  })

  const { data: result, isLoading } = useQuery<DonsResult>({
    queryKey:  ["dashboard-dons", page, yearFilter, search],
    queryFn:   () => fetch(`/api/dons?${params}`).then(r => r.json()),
    staleTime: 0,
  })

  const dons = result?.data ?? []

  function downloadRecu(donId: string) {
    window.open(`/api/dons/${donId}/recu`, "_blank")
  }

  const columns: Column<Don>[] = [
    {
      key:       "donor",
      header:    "Donateur",
      cell: (d) => d.anonymous
        ? <span className="text-muted-foreground italic">Anonyme</span>
        : <div>
            <p className="font-medium">{d.firstName} {d.lastName}</p>
            <p className="text-xs text-muted-foreground">{d.email}</p>
          </div>,
    },
    {
      key:       "message",
      header:    "Message",
      cell: (d) => d.message
        ? <p className="text-sm text-muted-foreground italic truncate max-w-xs">« {d.message} »</p>
        : <span className="text-muted-foreground/40">—</span>,
    },
    {
      key:       "paidAt",
      header:    "Date",
      className: "w-28",
      cell: (d) => d.paidAt
        ? format(new Date(d.paidAt), "dd/MM/yyyy", { locale: fr })
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key:       "amount",
      header:    "Montant",
      className: "w-28 text-right",
      cell: (d) => (
        <span className="font-semibold tabular-nums text-green-600 dark:text-green-400">
          +{parseFloat(d.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
        </span>
      ),
    },
    {
      key:       "receipt",
      header:    "",
      className: "w-10",
      cell: (d) => d.paidAt ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => downloadRecu(d.id)}
          title="Générer le reçu fiscal"
          className="h-7 px-2"
        >
          <DownloadIcon className="size-3.5" />
        </Button>
      ) : null,
    },
  ]

  const totalAmount = result?.totalAmount ?? 0
  const totalCount  = result?.totalCount ?? 0
  const avgAmount   = totalCount > 0 ? totalAmount / totalCount : 0

  return (
    <div className="space-y-4">
      <PageHeader title="Dons" description="Suivi des dons reçus en ligne." />

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card p-4 space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingUpIcon className="size-3.5" />
            Total {yearFilter}
          </div>
          <p className={cn("text-xl font-bold", totalAmount > 0 ? "text-green-600 dark:text-green-400" : "")}>
            {totalAmount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4 space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <UsersIcon className="size-3.5" />
            Donateurs
          </div>
          <p className="text-xl font-bold">{totalCount}</p>
        </div>
        <div className="rounded-xl border bg-card p-4 space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <HeartHandshakeIcon className="size-3.5" />
            Don moyen
          </div>
          <p className="text-xl font-bold">
            {avgAmount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative w-60">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Rechercher…"
            value={searchInput}
            onChange={e => handleSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-9 pr-8 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => { setSearchInput(""); setSearch(""); setPage(1) }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>

        <Select
          value={String(yearFilter)}
          onValueChange={v => { if (v) { setYearFilter(parseInt(v)); setPage(1) } }}
        >
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>

        <Badge variant="secondary" className="self-center">
          {result?.total ?? 0} don{(result?.total ?? 0) !== 1 ? "s" : ""}
        </Badge>
      </div>

      <DataTable
        columns={columns}
        data={dons}
        loading={isLoading}
        keyExtractor={(d) => d.id}
        empty="Aucun don enregistré"
        pagination={result ? {
          page:         result.page,
          totalPages:   result.totalPages,
          total:        result.total,
          limit:        result.limit,
          onPageChange: (p) => setPage(p),
        } : undefined}
      />
    </div>
  )
}
