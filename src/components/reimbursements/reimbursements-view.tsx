"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { PlusIcon, EyeIcon, PaperPlaneTiltIcon, XIcon, TrashIcon, DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr"
import {
  useReimbursementsPaginated, useReimbursementTotals, useCreateReimbursementRequest,
  useSubmitReimbursementRequest, useCancelReimbursementRequest, useDeleteReimbursementRequest,
} from "@/hooks/use-reimbursements"
import { useTeamAccess } from "@/hooks/use-team-access"
import { useFinanceCategories } from "@/hooks/use-finance-categories"
import type { ReimbursementRequestInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { FilterSelect } from "@/components/ui/filter-select"
import { DateField } from "@/components/ui/date-field"
import { ReimbursementForm } from "@/components/reimbursements/reimbursement-form"
import { useCurrentUser, useHasAccess } from "@/lib/user-context"
import { BASE_PATH } from "@/lib/env"
import { useActionsTodoHighlight } from "@/hooks/use-actions-todo-highlight"

type ReimbursementStatus = "DRAFT" | "PENDING_APPROVAL" | "NEEDS_CORRECTION" | "APPROVED" | "REJECTED" | "REIMBURSED" | "CANCELLED"

type ReimbursementRow = {
  id:          string
  subject:     string
  status:      ReimbursementStatus
  totalAmount: string
  createdAt:   string
  submittedAt: string | null
  requester:   { id: string; name: string | null }
  project:     { id: string; name: string } | null
  event:       { id: string; title: string } | null
}

const PAGE_SIZE = 20
const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

type Translator = ReturnType<typeof useTranslations>

function getStatusBadge(t: Translator): Record<ReimbursementStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" }> {
  return {
    DRAFT:            { label: t("reimbursements.view.status.draft"),            variant: "outline"     },
    PENDING_APPROVAL: { label: t("reimbursements.view.status.pendingApproval"),  variant: "secondary"   },
    NEEDS_CORRECTION: { label: t("reimbursements.view.status.needsCorrection"),  variant: "warning"     },
    APPROVED:         { label: t("reimbursements.view.status.approved"),        variant: "secondary"   },
    REJECTED:         { label: t("reimbursements.view.status.rejected"),        variant: "destructive" },
    REIMBURSED:       { label: t("reimbursements.view.status.reimbursed"),      variant: "success"     },
    CANCELLED:        { label: t("reimbursements.view.status.cancelled"),       variant: "outline"     },
  }
}

export function ReimbursementsView() {
  const t = useTranslations()
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentUser = useCurrentUser()
  const canViewAll = useHasAccess("reimbursements", "read")

  const [page, setPage] = useState(1)
  const [showAll, setShowAll]       = useState(canViewAll)
  const [requesterFilter, setRequesterFilter] = useState("")
  // Deep-link from the dashboard's "Notes de frais à valider" action (FORM-119): pre-fill
  // from ?status=, same pattern as membres-view.tsx's statusFilter.
  const [statusFilter, setStatusFilter]       = useState(() => searchParams.get("status") ?? "")
  const [categoryFilter, setCategoryFilter]   = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo]     = useState("")
  const [createOpen, setCreateOpen]   = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ReimbursementRow | null>(null)
  const [cancelTarget, setCancelTarget] = useState<ReimbursementRow | null>(null)

  const { data: team = [] } = useTeamAccess(canViewAll && showAll)
  const { data: categories = [] } = useFinanceCategories("EXPENSE")

  const filters = {
    requesterId: showAll ? (requesterFilter || undefined) : currentUser.id,
    status:      statusFilter || undefined,
    categoryId:  categoryFilter || undefined,
    dateFrom:    dateFrom || undefined,
    dateTo:      dateTo || undefined,
  }
  const { data: result, isLoading } = useReimbursementsPaginated(page, PAGE_SIZE, filters)
  useActionsTodoHighlight(!isLoading)
  // Mirrors the list's own requesterId scope — the summary line must always agree with what
  // the table below it is actually showing, not silently fall back to association-wide totals
  // while the list itself is filtered to "Mes demandes".
  const { data: totals } = useReimbursementTotals(filters.requesterId)
  const rows = (result?.data ?? []) as ReimbursementRow[]

  const createMutation   = useCreateReimbursementRequest()
  const submitMutation   = useSubmitReimbursementRequest()
  const cancelMutation   = useCancelReimbursementRequest()
  const deleteMutation   = useDeleteReimbursementRequest()

  async function handleCreate(data: ReimbursementRequestInput) {
    try {
      const created = await createMutation.mutateAsync(data)
      toast.success(t("reimbursements.view.toasts.created"))
      setCreateOpen(false)
      router.push(`/dashboard/reimbursements/${created.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleSubmit(row: ReimbursementRow) {
    try {
      await submitMutation.mutateAsync(row.id)
      toast.success(t("reimbursements.view.toasts.submitted"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return
    try {
      await cancelMutation.mutateAsync({ id: cancelTarget.id, data: {} })
      toast.success(t("reimbursements.view.toasts.cancelled"))
      setCancelTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success(t("reimbursements.view.toasts.deleted"))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  function handleExport() {
    const params = new URLSearchParams()
    if (filters.requesterId) params.set("requesterId", filters.requesterId)
    if (filters.status)      params.set("status", filters.status)
    if (filters.categoryId)  params.set("categoryId", filters.categoryId)
    if (filters.dateFrom)    params.set("dateFrom", filters.dateFrom)
    if (filters.dateTo)      params.set("dateTo", filters.dateTo)
    window.location.href = `${BASE_PATH}/api/finances/reimbursements/export?${params}`
  }

  const statusBadge = getStatusBadge(t)

  const columns: Column<ReimbursementRow>[] = [
    {
      key: "subject",
      header: t("reimbursements.view.columns.subject"),
      cell: (r) => (
        <div className="space-y-0.5">
          <p className="font-medium">{r.subject}</p>
          {showAll && <p className="text-xs text-muted-foreground">{r.requester.name}</p>}
          {r.event && <p className="text-xs text-muted-foreground">{r.event.title}</p>}
          {r.project && <p className="text-xs text-muted-foreground">{r.project.name}</p>}
        </div>
      ),
    },
    {
      key: "date",
      header: t("reimbursements.view.columns.date"),
      cell: (r) => format(new Date(r.submittedAt ?? r.createdAt), "dd/MM/yyyy", { locale: fr }),
      hideInCard: true,
    },
    {
      key: "amount",
      header: t("reimbursements.view.columns.amount"),
      className: "text-right",
      cell: (r) => <p className="tabular-nums font-medium text-right">{fmt(Number(r.totalAmount))}</p>,
    },
    {
      key: "status",
      header: t("reimbursements.view.columns.status"),
      cell: (r) => {
        const s = statusBadge[r.status]
        return <Badge variant={s.variant}>{s.label}</Badge>
      },
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      cell: (r) => {
        const isOwner = r.requester.id === currentUser.id
        return (
          <RowActions actions={[
            { label: t("reimbursements.view.actions.view"), icon: <EyeIcon className="size-3.5" />, onClick: () => router.push(`/dashboard/reimbursements/${r.id}`) },
            ...(isOwner && (r.status === "DRAFT" || r.status === "NEEDS_CORRECTION") ? [
              { label: t("reimbursements.view.actions.submit"), icon: <PaperPlaneTiltIcon className="size-3.5" />, onClick: () => handleSubmit(r), separator: true },
            ] : []),
            // Not offered on DRAFT: a request never submitted has nothing to withdraw — Delete
            // below is the only meaningful action on it.
            ...(isOwner && (r.status === "PENDING_APPROVAL" || r.status === "NEEDS_CORRECTION") ? [
              { label: t("reimbursements.view.actions.cancel"), icon: <XIcon className="size-3.5" />, onClick: () => setCancelTarget(r) },
            ] : []),
            ...(isOwner && r.status === "DRAFT" ? [
              { label: t("common.delete"), icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(r) },
            ] : []),
          ]} />
        )
      },
    },
  ]

  const summary = totals
    ? t("reimbursements.view.summary", {
        pending:   totals.pendingApproval.count,
        pendingAmount: fmt(totals.pendingApproval.amount),
        approved:  totals.approved.count,
        approvedAmount: fmt(totals.approved.amount),
        reimbursed: totals.reimbursed.count,
        reimbursedAmount: fmt(totals.reimbursed.amount),
      })
    : ""

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("reimbursements.view.title")}
        description={summary}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExport}>
              <DownloadSimpleIcon className="mr-1.5 size-4" />
              {t("reimbursements.view.export")}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="mr-1.5 size-4" />
              {t("reimbursements.view.newRequest")}
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {canViewAll && (
          <FilterSelect
            value={showAll ? "all" : "mine"}
            onValueChange={(v) => { setShowAll(v === "all"); setPage(1) }}
            options={[
              { value: "mine", label: t("reimbursements.view.myRequests") },
              { value: "all",  label: t("reimbursements.view.allRequests") },
            ]}
            width="w-44"
          />
        )}

        {canViewAll && showAll && (
          <FilterSelect
            value={requesterFilter}
            onValueChange={(v) => { setRequesterFilter(v); setPage(1) }}
            options={team.map(member => ({ value: member.userId, label: member.name }))}
            placeholder={t("reimbursements.view.allRequesters")}
            width="w-48"
          />
        )}

        <FilterSelect
          value={statusFilter}
          onValueChange={(v) => { setStatusFilter(v); setPage(1) }}
          options={[
            { value: "DRAFT",            label: t("reimbursements.view.status.draft") },
            { value: "PENDING_APPROVAL", label: t("reimbursements.view.status.pendingApproval") },
            { value: "NEEDS_CORRECTION", label: t("reimbursements.view.status.needsCorrection") },
            { value: "APPROVED",         label: t("reimbursements.view.status.approved") },
            { value: "REJECTED",         label: t("reimbursements.view.status.rejected") },
            { value: "REIMBURSED",       label: t("reimbursements.view.status.reimbursed") },
            { value: "CANCELLED",        label: t("reimbursements.view.status.cancelled") },
          ]}
          placeholder={t("reimbursements.view.allStatuses")}
          width="w-48"
        />

        <FilterSelect
          value={categoryFilter}
          onValueChange={(v) => { setCategoryFilter(v); setPage(1) }}
          options={categories.map((c: { id: string; name: string }) => ({ value: c.id, label: c.name }))}
          placeholder={t("reimbursements.view.allCategories")}
          width="w-48"
        />

        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground">{t("reimbursements.view.dateFrom")}</label>
          <DateField
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(v) => { setDateFrom(v); setPage(1) }}
            className="w-36"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground">{t("reimbursements.view.dateTo")}</label>
          <DateField
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(v) => { setDateTo(v); setPage(1) }}
            className="w-36"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        keyExtractor={(r) => r.id}
        onRowClick={(r) => router.push(`/dashboard/reimbursements/${r.id}`)}
        empty={t("reimbursements.view.noRequest")}
        pagination={result ? {
          page: result.page, totalPages: result.totalPages, total: result.total, limit: result.limit,
          onPageChange: (p) => setPage(p),
        } : undefined}
      />

      <Modal open={createOpen} onOpenChange={setCreateOpen} title={t("reimbursements.view.newRequest")} size="lg" dismissable={false}>
        <ReimbursementForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} loading={createMutation.isPending} />
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("reimbursements.view.deleteConfirmTitle")}
        description={t("reimbursements.view.deleteConfirmDescription")}
        confirmLabel={t("common.delete")}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title={t("reimbursements.view.cancelConfirmTitle")}
        description={t("reimbursements.view.cancelConfirmDescription")}
        confirmLabel={t("reimbursements.view.actions.cancel")}
        loading={cancelMutation.isPending}
        onConfirm={handleCancel}
      />
    </div>
  )
}
