"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, PencilSimpleIcon, TrashIcon, MagnifyingGlassIcon, XIcon, DownloadSimpleIcon, CaretDownIcon, BellIcon, MoneyIcon, ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useCotisationsPaginated, useCreateCotisation, useUpdateCotisation, useDeleteCotisation } from "@/hooks/use-cotisations"
import { useQuery } from "@tanstack/react-query"
import type { CotisationInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { CotisationForm } from "@/components/cotisations/cotisation-form"
import { SendReminderModal } from "@/components/cotisations/send-reminder-modal"
import { CotisationPaymentModal } from "@/components/cotisations/cotisation-payment-modal"
import { CotisationPaymentsModal } from "@/components/cotisations/cotisation-payments-modal"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { clientNextAmountDue } from "@/lib/cotisation-display"
import { exportMembresPdf } from "@/lib/pdf/membres-export-client"
import { BASE_PATH } from "@/lib/env";
import { ApiError } from "@/lib/api-error"

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

function getStatusBadge(t: Translator): Record<CotisationStatus, { label: string; tooltip: string; variant: "default" | "secondary" | "destructive" | "outline" }> {
  return {
    EN_ATTENTE:          { label: t("membres.detail.cotisationStatus.enAttente"),          tooltip: t("cotisations.statusTooltip.enAttente"),          variant: "secondary"   },
    PARTIELLEMENT_PAYEE: { label: t("membres.detail.cotisationStatus.partiellementPayee"), tooltip: t("cotisations.statusTooltip.partiellementPayee"), variant: "outline"     },
    PAYE:                { label: t("membres.detail.cotisationStatus.paye"),               tooltip: t("cotisations.statusTooltip.paye"),               variant: "default"     },
    EN_RETARD:           { label: t("membres.detail.cotisationStatus.enRetard"),           tooltip: t("cotisations.statusTooltip.enRetard"),           variant: "destructive" },
    EXONERE:             { label: t("membres.detail.cotisationStatus.exonere"),            tooltip: t("cotisations.statusTooltip.exonere"),            variant: "outline"     },
    ANNULEE:             { label: t("membres.detail.cotisationStatus.annulee"),            tooltip: t("cotisations.statusTooltip.annulee"),            variant: "secondary"   },
  }
}

const currentYear = new Date().getFullYear()
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i)

const PAGE_SIZE = 25

export function CotisationsView() {
  const t = useTranslations()
  const [page, setPage]                 = useState(1)
  const [searchInput, setSearchInput]   = useState("")
  const [search, setSearch]             = useState("")
  const [yearFilter, setYearFilter]     = useState<number>(currentYear)
  const [statusFilter, setStatusFilter] = useState<string>("")
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
    year:   yearFilter || undefined,
    status: statusFilter || undefined,
    search: search       || undefined,
  }

  const { data: result, isLoading } = useCotisationsPaginated(page, PAGE_SIZE, filters)
  const cotisations = (result?.data ?? []) as Cotisation[]
  const totalPaye   = result?.totalPaye ?? 0

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
  }, [yearFilter, statusFilter, search])

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

  // Fetches every EN_ATTENTE/PARTIELLEMENT_PAYEE/EN_RETARD cotisation matching the current
  // year/search filters (ignoring the status filter itself — a reminder is only ever sent to
  // members who still owe something, so "select all matching filters" always means that,
  // capped at 500 like GET /api/cotisations already is). Must stay in lockstep with
  // isSelectable below and the reminders route's own server-side filter.
  async function selectAllMatching() {
    setSelectingAll(true)
    try {
      const params = new URLSearchParams({ status: "EN_ATTENTE,PARTIELLEMENT_PAYEE,EN_RETARD" })
      if (yearFilter) params.set("year", String(yearFilter))
      if (search)     params.set("search", search)
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
  const statusFilterLabel: Record<string, string> = {
    all:                 t("cotisations.view.all"),
    EN_ATTENTE:          t("cotisations.view.statusFilter.enAttente"),
    PARTIELLEMENT_PAYEE: t("cotisations.view.statusFilter.partiellementPayees"),
    PAYE:                t("cotisations.view.statusFilter.payees"),
    EN_RETARD:           t("cotisations.view.statusFilter.enRetard"),
    EXONERE:             t("cotisations.view.statusFilter.exonerees"),
    ANNULEE:             t("cotisations.view.statusFilter.annulees"),
  }

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
          ...(c.status !== "EXONERE" && c.status !== "ANNULEE" && Number(c.amountPaid) < Number(c.amount) ? [{
            label:   t("cotisations.view.actions.recordPayment"),
            icon:    <MoneyIcon className="size-3.5" />,
            onClick: () => setPaymentTarget(c),
          }] : []),
          ...(c.payments.length > 0 ? [{
            label:   t("cotisations.view.actions.paymentHistory"),
            icon:    <ClockCounterClockwiseIcon className="size-3.5" />,
            onClick: () => setPaymentsHistoryTarget(c),
          }] : []),
          { label: t("cotisations.view.actions.edit"), icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => setEditTarget(c), separator: true },
          // Gated on declarationNumber rather than status === "PAYE" — a cotisation that was
          // PAYE and later cancelled can still have an already-issued fiscal document that
          // shouldn't disappear just because ANNULEE isn't PAYE anymore.
          ...(c.declarationNumber ? [{
            label:   t("cotisations.view.actions.declaration"),
            icon:    <DownloadSimpleIcon className="size-3.5" />,
            onClick: () => window.open(`${BASE_PATH}/api/membres/${c.membre.id}/cotisations/${c.id}/declaration`, "_blank"),
          }] : []),
          { label: t("cotisations.view.actions.delete"), icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(c) },
        ]
        return <RowActions actions={actions} />
      },
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("cotisations.view.title")}
        description={t("cotisations.view.count", { count: result?.total ?? 0 }) + (totalPaye > 0 ? t("cotisations.view.totalCollected", { amount: totalPaye.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) }) : "")}
        action={
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" variant="outline" disabled={membresLoading} />}>
                <DownloadSimpleIcon className="mr-1.5 size-4" />
                {t("cotisations.view.exportMembers")}
                <CaretDownIcon className="ml-1 size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportMembresXlsx}>
                  {t("cotisations.view.exportExcel")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportMembresPdf}>
                  {t("cotisations.view.exportPdf")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="mr-1.5 size-4" />
              {t("common.add")}
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {/* Search */}
        <div className="relative w-60">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder={t("cotisations.view.searchPlaceholder")}
            value={searchInput}
            onChange={e => handleSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-9 pr-8 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                if (debounceRef.current) clearTimeout(debounceRef.current)
                setSearchInput("")
                setSearch("")
                setPage(1)
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>

        {/* Year filter */}
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

        {/* Status filter */}
        <Select
          value={statusFilter || "all"}
          onValueChange={v => { setStatusFilter(v === "all" || v === null ? "" : v); setPage(1) }}
        >
          <SelectTrigger className="w-36">
            {/* base-ui's SelectValue only auto-resolves a label when Select.Root is given an
                `items` prop — without it, it falls back to the raw value ("EN_ATTENTE" etc).
                Passing explicit children here is the documented workaround (see the
                valueMode Select in import-wizard.tsx for the same pattern). */}
            <SelectValue placeholder={t("cotisations.view.allStatuses")}>
              {statusFilterLabel[statusFilter || "all"]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("cotisations.view.all")}</SelectItem>
            <SelectItem value="EN_ATTENTE">{t("cotisations.view.statusFilter.enAttente")}</SelectItem>
            <SelectItem value="PARTIELLEMENT_PAYEE">{t("cotisations.view.statusFilter.partiellementPayees")}</SelectItem>
            <SelectItem value="PAYE">{t("cotisations.view.statusFilter.payees")}</SelectItem>
            <SelectItem value="EN_RETARD">{t("cotisations.view.statusFilter.enRetard")}</SelectItem>
            <SelectItem value="EXONERE">{t("cotisations.view.statusFilter.exonerees")}</SelectItem>
            <SelectItem value="ANNULEE">{t("cotisations.view.statusFilter.annulees")}</SelectItem>
          </SelectContent>
        </Select>

        {statusFilter !== "PAYE" && statusFilter !== "EXONERE" && statusFilter !== "ANNULEE" && (
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
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-2.5">
          <p className="text-sm font-medium">{t("cotisations.view.selectedCount", { count: selected.size })}</p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={clearSelection}>{t("cotisations.view.deselectAll")}</Button>
            <Button size="sm" onClick={() => setReminderOpen(true)}>
              <BellIcon className="mr-1.5 size-4" />
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
        selection={{
          selectedIds:  new Set(selected.keys()),
          onToggle:     toggleOne,
          onToggleAll:  toggleAllOnPage,
          isSelectable: (c) => c.status === "EN_ATTENTE" || c.status === "PARTIELLEMENT_PAYEE" || c.status === "EN_RETARD",
        }}
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

      {paymentTarget && (
        <CotisationPaymentModal
          cotisationId={paymentTarget.id}
          remaining={Number(paymentTarget.amount) - Number(paymentTarget.amountPaid)}
          suggestedAmount={clientNextAmountDue(
            Number(paymentTarget.amount),
            Number(paymentTarget.amountPaid),
            paymentTarget.installments.map(i => ({ amount: Number(i.amount), dueDate: i.dueDate })),
          )}
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
