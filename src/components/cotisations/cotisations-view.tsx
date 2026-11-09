"use client"

import { useState, useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, PencilSimpleIcon, TrashIcon, DownloadSimpleIcon, CaretDownIcon, CaretUpIcon, BellIcon, MoneyIcon, ClockCounterClockwiseIcon, FunnelXIcon } from "@phosphor-icons/react/dist/ssr";
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import {
  useCotisationsPaginated, useCreateCotisation, useUpdateCotisation, useDeleteCotisation,
  useCotisationsDistribution, useCotisationTierOptions, type RenewalMode,
} from "@/hooks/use-cotisations"
import { useQuery } from "@tanstack/react-query"
import type { CotisationInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { CotisationForm } from "@/components/cotisations/cotisation-form"
import { SendReminderModal } from "@/components/cotisations/send-reminder-modal"
import { CotisationPaymentModal } from "@/components/cotisations/cotisation-payment-modal"
import { PENDING_COTISATION_STATUSES, NO_CATEGORY_FILTER } from "@/lib/cotisation-filters"
import { CotisationPaymentsModal } from "@/components/cotisations/cotisation-payments-modal"
import { CotisationsDistribution } from "@/components/cotisations/cotisations-distribution"
import { MergeDuplicateTiersModal } from "@/components/cotisations/merge-duplicate-tiers-modal"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { FilterSelect } from "@/components/ui/filter-select"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchInput } from "@/components/ui/search-input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { exportMembresPdf } from "@/lib/pdf/membres-export-client"
import { BASE_PATH } from "@/lib/env";
import { ApiError } from "@/lib/api-error"
import { useHasAccess } from "@/lib/user-context"

type CotisationPayment = { id: string; amount: string; method: string; paidAt: string; note: string | null }
type CotisationInstallment = { id: string; amount: string; dueDate: string }

type CotisationStatus = "EN_ATTENTE" | "PARTIELLEMENT_PAYEE" | "PAYE" | "EN_RETARD" | "EXONERE" | "ANNULEE"

type Cotisation = {
  id:                 string
  year:               number
  amount:             string
  amountPaid:         string
  status:             CotisationStatus
  paidAt:             string | null
  dueDate:            string | null
  lastReminderSentAt: string | null
  note:               string | null
  declarationNumber:  string | null
  membre:             { id: string; firstName: string; lastName: string; email: string | null }
  payments:           CotisationPayment[]
  installments:       CotisationInstallment[]
}

type MembreOption = { id: string; firstName: string; lastName: string }

type Translator = ReturnType<typeof useTranslations>

const fmt = (n: number | string) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

// Canonical status semantics (CLAUDE.md §7): completed → success, attention → warning,
// overdue → destructive, pending → secondary, terminal/neutral → outline.
function getStatusBadge(t: Translator): Record<CotisationStatus, { label: string; tooltip: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" }> {
  return {
    EN_ATTENTE:          { label: t("membres.detail.cotisationStatus.enAttente"),          tooltip: t("cotisations.statusTooltip.enAttente"),          variant: "secondary"   },
    PARTIELLEMENT_PAYEE: { label: t("membres.detail.cotisationStatus.partiellementPayee"), tooltip: t("cotisations.statusTooltip.partiellementPayee"), variant: "warning"     },
    PAYE:                { label: t("membres.detail.cotisationStatus.paye"),               tooltip: t("cotisations.statusTooltip.paye"),               variant: "success"     },
    EN_RETARD:           { label: t("membres.detail.cotisationStatus.enRetard"),           tooltip: t("cotisations.statusTooltip.enRetard"),           variant: "destructive" },
    EXONERE:             { label: t("membres.detail.cotisationStatus.exonere"),            tooltip: t("cotisations.statusTooltip.exonere"),            variant: "outline"     },
    ANNULEE:             { label: t("membres.detail.cotisationStatus.annulee"),            tooltip: t("cotisations.statusTooltip.annulee"),            variant: "outline"     },
  }
}

const currentYear = new Date().getFullYear()
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i)

const PAGE_SIZE = 25

// Sentinel injected into the tier FilterSelect's own options — intercepted in its
// onValueChange before setTierFilter, so picking it opens the merge modal instead of
// filtering (see MergeDuplicateTiersModal). Never sent to the API, unlike NO_CATEGORY_FILTER.
const MERGE_DUPLICATE_TIERS_OPTION = "__merge_duplicate_tiers__"

export function CotisationsView() {
  const searchParams = useSearchParams()
  const t = useTranslations()
  // Same areas as the API (FORM-34): creating, editing, deleting a cotisation, sending
  // reminders, payments and fiscal declarations are all "adhesions" edits; the members export
  // needs "membres" read. A "read" user keeps the list, filters and history.
  const canReadMembres   = useHasAccess("membres", "read")
  const canEditAdhesions = useHasAccess("adhesions", "edit")
  const [page, setPage]                 = useState(1)
  const [searchInput, setSearchInput]   = useState("")
  const [search, setSearch]             = useState("")
  const [yearFilter, setYearFilter]     = useState<number>(currentYear)
  // Pré-rempli depuis l'URL : l'accueil renvoie ici avec ?status=… pour ouvrir directement
  // sur les cotisations à encaisser plutôt que sur la liste entière.
  const [statusFilter, setStatusFilter] = useState<string>(() => searchParams.get("status") ?? "")
  const [tierFilter, setTierFilter]         = useState("")
  const [renewalFilter, setRenewalFilter]   = useState<RenewalMode | "">("")
  const [distributionOpen, setDistributionOpen] = useState(false)
  const [mergeTiersOpen, setMergeTiersOpen] = useState(false)
  const [createOpen, setCreateOpen]     = useState(false)
  const [editTarget, setEditTarget]     = useState<Cotisation | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Cotisation | null>(null)
  const [selected, setSelected]         = useState<Map<string, Cotisation>>(new Map())
  // Tracks specifically "the last selection action was selectAllMatching()", separate from
  // selected.size > 0 — a lone manually-checked row must not make the "select all matching
  // filters" checkbox render as checked, which it would if that checkbox's state were just
  // derived from "is anything selected at all".
  const [allMatchingSelected, setAllMatchingSelected] = useState(false)
  const [selectingAll, setSelectingAll] = useState(false)
  const [reminderOpen, setReminderOpen] = useState(false)
  const [paymentTarget, setPaymentTarget] = useState<Cotisation | null>(null)
  const [paymentsHistoryTarget, setPaymentsHistoryTarget] = useState<Cotisation | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function handleSearch(val: string) {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(val); setPage(1) }, 300)
  }

  const filters = {
    year:        yearFilter || undefined,
    status:      statusFilter || undefined,
    search:      search       || undefined,
    tierId:      tierFilter    || undefined,
    renewalMode: renewalFilter || undefined,
  }
  const hasActiveFilters = !!(search || statusFilter || tierFilter || renewalFilter)

  const { data: result, isLoading } = useCotisationsPaginated(page, PAGE_SIZE, filters)
  const cotisations = (result?.data ?? []) as Cotisation[]
  const summary = result?.summary ?? { count: 0, aPagar: 0, recebido: 0, saldo: 0 }

  const { data: tierOptionsData } = useCotisationTierOptions()
  const tierOptions       = tierOptionsData?.tiers ?? []
  const hasUncategorized   = tierOptionsData?.hasUncategorized ?? false
  const { data: distribution, isLoading: distributionLoading } = useCotisationsDistribution(filters, distributionOpen)

  function resetFilters() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSearchInput("")
    setSearch("")
    setStatusFilter("")
    setTierFilter("")
    setRenewalFilter("")
    setPage(1)
  }

  // Load all active membres for the create form
  const { data: membres = [], isLoading: membresLoading } = useQuery<MembreOption[]>({
    queryKey: ["membres", "all"],
    queryFn:  async () => {
      const res = await fetch("/api/membres")
      return res.ok ? res.json() : []
    },
  })

  useEffect(() => {
    if (result && result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages)
  }, [result, page])

  // A selection made under one set of filters (e.g. year 2025) has no obvious relationship
  // to a different filter (2024) — keeping it "alive" but invisible risks a reminder going
  // out to people the admin can no longer see or double-check, so filters changing clears it.
  useEffect(() => {
    setSelected(new Map())
    setAllMatchingSelected(false)
  }, [yearFilter, statusFilter, search, tierFilter, renewalFilter])

  const createMutation = useCreateCotisation()
  const updateMutation = useUpdateCotisation(editTarget?.id ?? "")
  const deleteMutation = useDeleteCotisation()

  // A cotisation exists per (membre, year) forever, regardless of status — cancelling one
  // doesn't free its year (see POST /api/cotisations). Rather than just reporting "already
  // exists," offer to open that cancelled cotisation for editing instead of leaving the admin
  // stuck. It's not necessarily in the currently-loaded/filtered list, so fetched directly.
  async function openCancelledForEdit(cotisationId: string) {
    try {
      const res = await fetch(`/api/cotisations/${cotisationId}`)
      if (!res.ok) { toast.error(t("common.error")); return }
      const cotisation = await res.json() as Cotisation
      setCreateOpen(false)
      setEditTarget(cotisation)
    } catch {
      toast.error(t("common.networkError"))
    }
  }

  async function handleCreate(data: CotisationInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success(t("cotisations.view.toasts.created"))
      setCreateOpen(false)
    } catch (err) {
      if (err instanceof ApiError && err.code === "CANCELLED_EXISTS" && typeof err.details?.cotisationId === "string") {
        const cotisationId = err.details.cotisationId
        toast.error(err.message, {
          action: { label: t("cotisations.view.toasts.editCancelled"), onClick: () => openCancelledForEdit(cotisationId) },
        })
        return
      }
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleUpdate(data: CotisationInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success(t("cotisations.view.toasts.updated"))
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDelete(force?: boolean) {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync({ id: deleteTarget.id, force })
      toast.success(t("cotisations.view.toasts.deleted"))
      setDeleteTarget(null)
    } catch (err) {
      if (err instanceof ApiError && err.code === "REQUIRES_CONFIRMATION") {
        toast.error(err.message, {
          action: { label: t("cotisations.view.toasts.confirm"), onClick: () => handleDelete(true) },
        })
        return
      }
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  function toggleOne(id: string) {
    setAllMatchingSelected(false)
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        const row = cotisations.find(c => c.id === id)
        if (row) next.set(id, row)
      }
      return next
    })
  }

  function toggleAllOnPage(ids: string[], checked: boolean) {
    setAllMatchingSelected(false)
    setSelected(prev => {
      const next = new Map(prev)
      for (const id of ids) {
        if (checked) {
          const row = cotisations.find(c => c.id === id)
          if (row) next.set(id, row)
        } else {
          next.delete(id)
        }
      }
      return next
    })
  }

  function clearSelection() {
    setSelected(new Map())
    setAllMatchingSelected(false)
  }

  // Fetches every EN_ATTENTE/PARTIELLEMENT_PAYEE/EN_RETARD cotisation matching every other
  // active filter (ignoring the status filter itself — a reminder is only ever sent to members
  // who still owe something, so "select all matching filters" always means that, capped at 500
  // like GET /api/cotisations already is). Catégorie/Renouvellement must stay included here: the
  // checkbox is explicitly labelled "filtres actifs" — silently dropping them would select (and
  // remind) members outside the segment the admin had deliberately narrowed down to. Must stay
  // in lockstep with isSelectable below and the reminders route's own server-side filter.
  async function selectAllMatching() {
    setSelectingAll(true)
    try {
      const params = new URLSearchParams({ status: "EN_ATTENTE,PARTIELLEMENT_PAYEE,EN_RETARD" })
      if (yearFilter)   params.set("year",        String(yearFilter))
      if (search)       params.set("search",      search)
      if (tierFilter)   params.set("tierId",      tierFilter)
      if (renewalFilter) params.set("renewalMode", renewalFilter)
      const res = await fetch(`/api/cotisations?${params}`)
      if (!res.ok) { toast.error(t("common.error")); return }
      const all = await res.json() as Cotisation[]
      if (all.length >= 500) toast.warning(t("cotisations.view.selectAllTruncated"))
      setSelected(new Map(all.map(c => [c.id, c])))
      setAllMatchingSelected(true)
    } catch {
      toast.error(t("common.networkError"))
    } finally {
      setSelectingAll(false)
    }
  }

  function handleExportCotisationsXlsx() {
    const params = new URLSearchParams()
    if (filters.year)        params.set("year",        String(filters.year))
    if (filters.status)      params.set("status",      filters.status)
    if (filters.search)      params.set("search",      filters.search)
    if (filters.tierId)      params.set("tierId",      filters.tierId)
    if (filters.renewalMode) params.set("renewalMode", filters.renewalMode)
    window.location.href = `${BASE_PATH}/api/cotisations/export?${params}`
  }

  function handleExportMembresXlsx() {
    if (!membres.length) {
      toast.error(t("membres.view.toasts.noMembersToExport"))
      return
    }
    window.location.href = `${BASE_PATH}/api/membres/export?full=1&format=xlsx`
  }

  function handleExportMembresPdf() {
    if (!membres.length) {
      toast.error(t("membres.view.toasts.noMembersToExport"))
      return
    }
    exportMembresPdf(new URLSearchParams({ full: "1" }))
  }

  const statusBadge = getStatusBadge(t)

  const columns: Column<Cotisation>[] = [
    {
      key: "membre",
      header: t("cotisations.view.columns.member"),
      cell: (c) => (
        <div>
          <p className="font-medium">{c.membre.lastName} {c.membre.firstName}</p>
          {c.membre.email && <p className="text-xs text-muted-foreground">{c.membre.email}</p>}
        </div>
      ),
    },
    {
      key: "dueDate",
      header: t("cotisations.view.columns.dueDate"),
      cell: (c) => c.dueDate
        ? format(new Date(c.dueDate), "dd/MM/yyyy", { locale: fr })
        : <span className="text-muted-foreground text-xs">—</span>,
      hideInCard: true,
    },
    {
      key: "amount",
      header: t("cotisations.view.columns.amount"),
      cell: (c) => <span className="font-medium tabular-nums">{fmt(c.amount)}</span>,
      className: "w-28",
    },
    {
      key: "remaining",
      header: t("cotisations.view.columns.remaining"),
      cell: (c) => {
        const remaining = Number(c.amount) - Number(c.amountPaid)
        return remaining > 0 && c.status !== "EXONERE" && c.status !== "ANNULEE"
          ? <span className="tabular-nums">{fmt(remaining)}</span>
          : <span className="text-muted-foreground text-xs">—</span>
      },
      className: "w-28",
    },
    {
      key: "paidAt",
      header: t("cotisations.view.columns.paidAt"),
      cell: (c) => c.paidAt
        ? format(new Date(c.paidAt), "dd/MM/yyyy", { locale: fr })
        : <span className="text-muted-foreground text-xs">—</span>,
      className: "w-28",
      hideInCard: true,
    },
    {
      key: "status",
      header: t("cotisations.view.columns.status"),
      cell: (c) => {
        const s = statusBadge[c.status]
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Badge variant={s.variant}>{s.label}</Badge>
              </TooltipTrigger>
              <TooltipContent>{s.tooltip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      },
      className: "w-28",
    },
    {
      key: "paymentMethods",
      header: t("cotisations.view.columns.paymentMethod"),
      className: "max-w-32",
      cell: (c) => {
        const methods = [...new Set(c.payments.map(p => p.method))]
        const label = methods.join(" + ")
        return methods.length
          ? <span className="block truncate text-sm" title={label}>{label}</span>
          : <span className="text-muted-foreground text-xs">—</span>
      },
      hideInCard: true,
    },
    {
      key: "lastReminderSentAt",
      header: t("cotisations.view.columns.lastReminder"),
      cell: (c) => c.lastReminderSentAt
        ? format(new Date(c.lastReminderSentAt), "dd/MM/yyyy", { locale: fr })
        : <span className="text-muted-foreground text-xs">—</span>,
      className: "w-28",
      hideInCard: true,
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      cell: (c) => {
        const actions = [
          ...(canEditAdhesions && c.status !== "EXONERE" && c.status !== "ANNULEE" && Number(c.amountPaid) < Number(c.amount) ? [{
            label:   t("cotisations.view.actions.recordPayment"),
            icon:    <MoneyIcon className="size-3.5" />,
            onClick: () => setPaymentTarget(c),
          }] : []),
          ...(c.payments.length > 0 ? [{
            label:   t("cotisations.view.actions.paymentHistory"),
            icon:    <ClockCounterClockwiseIcon className="size-3.5" />,
            onClick: () => setPaymentsHistoryTarget(c),
          }] : []),
          ...(canEditAdhesions ? [
            { label: t("cotisations.view.actions.edit"), icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => setEditTarget(c), separator: true },
          ] : []),
          // Gated on declarationNumber rather than status === "PAYE" — a cotisation that was
          // PAYE and later cancelled can still have an already-issued fiscal document that
          // shouldn't disappear just because ANNULEE isn't PAYE anymore.
          ...(canEditAdhesions && c.declarationNumber ? [{
            label:   t("cotisations.view.actions.declaration"),
            icon:    <DownloadSimpleIcon className="size-3.5" />,
            onClick: () => window.open(`${BASE_PATH}/api/membres/${c.membre.id}/cotisations/${c.id}/declaration`, "_blank"),
          }] : []),
          ...(canEditAdhesions ? [
            { label: t("cotisations.view.actions.delete"), icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(c) },
          ] : []),
        ]
        return actions.length > 0 ? <RowActions actions={actions} /> : null
      },
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("cotisations.view.title")}
        description={
          <span className="inline-flex items-center gap-1 flex-wrap">
            <span>{t("cotisations.view.count", { count: summary.count })}</span>
            <span>{t("cotisations.view.summary.aPagar", { amount: fmt(summary.aPagar) })}</span>
            <span>{t("cotisations.view.summary.recebido", { amount: fmt(summary.recebido) })}</span>
            <span>{t("cotisations.view.summary.saldo", { amount: fmt(summary.saldo) })}</span>
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
                <DownloadSimpleIcon className="mr-1.5 size-4" />
                {t("cotisations.view.export")}
                <CaretDownIcon className="ml-1 size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportCotisationsXlsx}>
                  {t("cotisations.view.exportCotisationsExcel")}
                </DropdownMenuItem>
                {canReadMembres && (
                  <>
                    <DropdownMenuItem onClick={handleExportMembresXlsx} disabled={membresLoading}>
                      {t("cotisations.view.exportMembresExcel")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportMembresPdf} disabled={membresLoading}>
                      {t("cotisations.view.exportMembresPdf")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {canEditAdhesions && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <PlusIcon className="mr-1.5 size-4" />
                {t("common.add")}
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          placeholder={t("cotisations.view.searchPlaceholder")}
          value={searchInput}
          onValueChange={handleSearch}
          onClear={() => {
            if (debounceRef.current) clearTimeout(debounceRef.current)
            setSearchInput("")
            setSearch("")
            setPage(1)
          }}
          containerClassName="w-60"
        />

        {/* Not a FilterSelect: the exercice is always a single required year, never "all". */}
        <Select
          value={String(yearFilter)}
          onValueChange={v => { if (v !== null) { setYearFilter(parseInt(v)); setPage(1) } }}
        >
          <SelectTrigger className="w-36">
            <SelectValue>{t("cotisations.view.exercise", { year: yearFilter })}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map(y => (
              <SelectItem key={y} value={String(y)}>{t("cotisations.view.exercise", { year: y })}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <FilterSelect
          value={statusFilter}
          onValueChange={v => { setStatusFilter(v); setPage(1) }}
          options={[
            { value: PENDING_COTISATION_STATUSES, label: t("cotisations.view.statusFilter.aEncaisser") },
            { value: "EN_ATTENTE",          label: t("cotisations.view.statusFilter.enAttente") },
            { value: "PARTIELLEMENT_PAYEE", label: t("cotisations.view.statusFilter.partiellementPayees") },
            { value: "PAYE",                label: t("cotisations.view.statusFilter.payees") },
            { value: "EN_RETARD",           label: t("cotisations.view.statusFilter.enRetard") },
            { value: "EXONERE",             label: t("cotisations.view.statusFilter.exonerees") },
            { value: "ANNULEE",             label: t("cotisations.view.statusFilter.annulees") },
          ]}
          placeholder={t("cotisations.view.allStatuses")}
        />

        <FilterSelect
          value={tierFilter}
          onValueChange={v => {
            if (v === MERGE_DUPLICATE_TIERS_OPTION) { setMergeTiersOpen(true); return }
            setTierFilter(v)
            setPage(1)
          }}
          options={[
            ...tierOptions.map(tier => ({ value: tier.id, label: tier.label })),
            ...(hasUncategorized ? [{ value: NO_CATEGORY_FILTER, label: t("cotisations.view.distribution.noCategory") }] : []),
            ...(canEditAdhesions ? [{ value: MERGE_DUPLICATE_TIERS_OPTION, label: t("cotisations.view.mergeTiers.filterOption"), separatorBefore: true }] : []),
          ]}
          placeholder={t("cotisations.view.allCategories")}
          width="w-40"
        />

        <FilterSelect
          value={renewalFilter}
          onValueChange={v => { setRenewalFilter(v as RenewalMode | ""); setPage(1) }}
          options={[
            { value: "AUTO",   label: t("cotisations.view.renewal.automatic") },
            { value: "MANUAL", label: t("cotisations.view.renewal.manual") },
          ]}
          placeholder={t("cotisations.view.allRenewals")}
          width="w-44"
        />

        {hasActiveFilters && (
          <Button variant="ghost" onClick={resetFilters} className="text-muted-foreground">
            <FunnelXIcon className="size-3.5" />
            {t("cotisations.view.resetFilters")}
          </Button>
        )}

        {/* Selection only exists to send reminders — a "membres" edit. */}
        {canEditAdhesions && statusFilter !== "PAYE" && statusFilter !== "EXONERE" && statusFilter !== "ANNULEE" && (
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allMatchingSelected}
              disabled={selectingAll}
              onChange={e => e.target.checked ? selectAllMatching() : clearSelection()}
              className="size-4 shrink-0 cursor-pointer rounded border border-input accent-primary disabled:cursor-not-allowed"
            />
            {t("cotisations.view.selectAllMatching")}
          </label>
        )}

        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setDistributionOpen(o => !o)}>
          {distributionOpen ? <CaretUpIcon className="mr-1.5 size-3.5" /> : <CaretDownIcon className="mr-1.5 size-3.5" />}
          {distributionOpen ? t("cotisations.view.distribution.hide") : t("cotisations.view.distribution.show")}
        </Button>
      </div>

      {distributionOpen && (
        <CotisationsDistribution
          groups={distribution?.groups ?? []}
          total={distribution?.total ?? { count: 0, aPagar: 0, recebido: 0, saldo: 0 }}
          loading={distributionLoading}
        />
      )}

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-2.5">
          <p className="text-sm font-medium">{t("cotisations.view.selectedCount", { count: selected.size })}</p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={clearSelection}>{t("cotisations.view.deselectAll")}</Button>
            <Button variant="outline" size="sm" onClick={() => setReminderOpen(true)}>
              <BellIcon className="mr-1.5 size-3.5" />
              {t("cotisations.view.sendReminder")}
            </Button>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        data={cotisations}
        loading={isLoading}
        keyExtractor={(c) => c.id}
        empty={search ? t("cotisations.view.noResultsFor", { search }) : t("cotisations.view.noCotisation")}
        selection={canEditAdhesions ? {
          selectedIds:  new Set(selected.keys()),
          onToggle:     toggleOne,
          onToggleAll:  toggleAllOnPage,
          isSelectable: (c) => c.status === "EN_ATTENTE" || c.status === "PARTIELLEMENT_PAYEE" || c.status === "EN_RETARD",
        } : undefined}
        pagination={result ? {
          page:         result.page,
          totalPages:   result.totalPages,
          total:        result.total,
          limit:        result.limit,
          onPageChange: (p) => setPage(p),
        } : undefined}
      />

      <SendReminderModal
        open={reminderOpen}
        onOpenChange={setReminderOpen}
        cotisations={Array.from(selected.values())}
        onSent={() => { setReminderOpen(false); clearSelection() }}
      />

      <MergeDuplicateTiersModal
        open={mergeTiersOpen}
        onOpenChange={setMergeTiersOpen}
        onMerged={(mergedAwayIds, primaryTierId) => {
          // The active "Catégorie" filter can be pointing at a tier that was just archived —
          // left alone, the table would silently show zero results with no explanation, since
          // nothing references that tierId anymore. Follow the filter onto the tier it merged
          // into instead of just clearing it, so the admin keeps looking at the same category.
          if (mergedAwayIds.includes(tierFilter)) { setTierFilter(primaryTierId); setPage(1) }
        }}
      />

      {paymentTarget && (
        <CotisationPaymentModal
          cotisationId={paymentTarget.id}
          schedule={{
            amount:       Number(paymentTarget.amount),
            amountPaid:   Number(paymentTarget.amountPaid),
            installments: paymentTarget.installments.map(installment => ({ amount: Number(installment.amount), dueDate: installment.dueDate })),
          }}
          open={!!paymentTarget}
          onOpenChange={(open) => !open && setPaymentTarget(null)}
        />
      )}

      {paymentsHistoryTarget && (
        <CotisationPaymentsModal
          cotisationId={paymentsHistoryTarget.id}
          payments={paymentsHistoryTarget.payments}
          open={!!paymentsHistoryTarget}
          onOpenChange={(open) => !open && setPaymentsHistoryTarget(null)}
        />
      )}

      {/* Create */}
      <Modal open={createOpen} onOpenChange={setCreateOpen} title={t("cotisations.view.addTitle")} size="lg" dismissable={false}>
        <CotisationForm
          membres={membres}
          defaultValues={{ year: yearFilter }}
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
          loading={createMutation.isPending}
        />
      </Modal>

      {/* Edit */}
      <Modal
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        title={t("cotisations.view.editTitle")}
        size="lg"
        dismissable={false}
      >
        <CotisationForm
          membres={membres}
          editMode
          amountPaid={editTarget ? Number(editTarget.amountPaid) : 0}
          currentStatus={editTarget?.status}
          defaultValues={editTarget ? {
            membreId:     editTarget.membre.id,
            year:         editTarget.year,
            amount:       parseFloat(editTarget.amount),
            // Only EXONERE/ANNULEE are real manual overrides — any other current status
            // (EN_ATTENTE/PARTIELLEMENT_PAYEE/PAYE/EN_RETARD) means "no override", so the
            // form's status select shows "Automatique" for those (see CotisationForm).
            status:       editTarget.status === "EXONERE" || editTarget.status === "ANNULEE" ? editTarget.status : null,
            dueDate:      editTarget.dueDate ? editTarget.dueDate.split("T")[0] : "",
            installments: editTarget.installments.map(i => ({ amount: parseFloat(i.amount), dueDate: i.dueDate.split("T")[0] })),
            note:         editTarget.note ?? "",
          } : undefined}
          onSubmit={handleUpdate}
          onCancel={() => setEditTarget(null)}
          loading={updateMutation.isPending}
        />
      </Modal>

      {/* Delete */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("cotisations.view.deleteConfirmTitle")}
        description={deleteTarget
          ? t("cotisations.view.deleteConfirmDescription", { year: deleteTarget.year, name: `${deleteTarget.membre.lastName} ${deleteTarget.membre.firstName}` })
          : ""}
        confirmLabel={t("common.delete")}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
