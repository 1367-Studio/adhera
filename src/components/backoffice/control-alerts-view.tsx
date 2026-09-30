"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useTranslations, useLocale } from "next-intl"
import { formatDistanceToNow, differenceInDays } from "date-fns"
import { toast } from "sonner"
import {
  useBackofficeControlAlerts, useResolveBackofficeControlAlert,
  useReopenBackofficeControlAlert, useResolveManyBackofficeControlAlerts,
  type ControlAlertStatus, type BackofficeControlAlert,
} from "@/hooks/use-backoffice-control-alerts"
import { DataTable, type Column } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchInput } from "@/components/ui/search-input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Textarea } from "@/components/ui/textarea"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"

const PAGE_SIZE = 20

function ResolveDialog({
  title, description, isPending, onConfirm, onOpenChange,
}: {
  title: string; description: string; isPending: boolean
  onConfirm: (note?: string) => Promise<unknown>
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations("controlAlerts")
  const tCommon = useTranslations("common")
  const [note, setNote] = useState("")

  async function handleConfirm() {
    try {
      await onConfirm(note || undefined)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("genericError"))
    }
  }

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      dismissable={!isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={isPending}>
            {t("resolveAction")}
          </Button>
        </>
      }
    >
      <div className="space-y-1.5">
        <label className="text-sm font-medium">{t("noteLabel")}</label>
        <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder={t("notePlaceholder")} rows={3} />
      </div>
    </Modal>
  )
}

export function ControlAlertsView() {
  const t = useTranslations("controlAlerts")
  const dateFnsLocale = getDateFnsLocale(useLocale() as Locale)

  const [statusFilter, setStatusFilter] = useState<ControlAlertStatus | "all">("OUVERT")
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [resolvingAlert, setResolvingAlert] = useState<BackofficeControlAlert | null>(null)
  const [bulkResolveOpen, setBulkResolveOpen] = useState(false)
  const [reopeningAlert, setReopeningAlert] = useState<BackofficeControlAlert | null>(null)

  const { data: result, isLoading } = useBackofficeControlAlerts({
    status: statusFilter === "all" ? undefined : statusFilter,
    page, limit: PAGE_SIZE, search: search || undefined,
  })
  const alerts = result?.data ?? []

  const resolveOne = useResolveBackofficeControlAlert(resolvingAlert?.id ?? "")
  const resolveMany = useResolveManyBackofficeControlAlerts()
  const reopenOne = useReopenBackofficeControlAlert(reopeningAlert?.id ?? "")

  function handleSearch(value: string) {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(value); setPage(1) }, 300)
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAllOnPage(ids: string[], checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of ids) { if (checked) next.add(id); else next.delete(id) }
      return next
    })
  }

  const columns: Column<BackofficeControlAlert>[] = [
    {
      key: "membre", header: t("columns.membre"),
      cell: alert => (
        <div>
          <span className="font-medium">{alert.membre.firstName} {alert.membre.lastName}</span>
          {alert.membre.email && <span className="block text-xs text-muted-foreground">{alert.membre.email}</span>}
        </div>
      ),
    },
    {
      key: "association", header: t("columns.association"),
      cell: alert => (
        <Link href={`/backoffice/associations/${alert.associationId}/members#membre-${alert.membreId}`} className="hover:underline">
          {alert.association.name}
        </Link>
      ),
    },
    {
      key: "raisedAt", header: t("columns.raisedAt"),
      cell: alert => (
        <span className="text-muted-foreground">
          {formatDistanceToNow(new Date(alert.raisedAt), { addSuffix: true, locale: dateFnsLocale })}
        </span>
      ),
    },
    {
      key: "days", header: t("columns.daysWithoutCotisation"),
      cell: alert => (
        <span className="text-muted-foreground">{differenceInDays(new Date(), new Date(alert.membre.createdAt))}</span>
      ),
    },
    {
      key: "status", header: t("columns.status"), className: "text-right",
      cell: alert => (
        <div className="flex items-center justify-end gap-1.5">
          {alert.autoResolved && <span className="text-xs text-muted-foreground">{t("autoResolvedLabel")}</span>}
          <Badge variant={alert.status === "OUVERT" ? "default" : "secondary"}>
            {alert.status === "OUVERT" ? t("status.open") : t("status.resolved")}
          </Badge>
        </div>
      ),
    },
    {
      key: "actions", header: "", className: "text-right",
      cell: alert => (
        alert.status === "OUVERT" ? (
          <Button variant="ghost" size="sm" onClick={() => setResolvingAlert(alert)}>{t("resolveAction")}</Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setReopeningAlert(alert)}>{t("reopenAction")}</Button>
        )
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("subtitle")} />

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
        <Select value={statusFilter} onValueChange={v => { setStatusFilter((v ?? "all") as ControlAlertStatus | "all"); setPage(1) }}>
          <SelectTrigger className="w-40">
            <SelectValue>
              {statusFilter === "all" ? t("filterAll") : statusFilter === "OUVERT" ? t("status.open") : t("status.resolved")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filterAll")}</SelectItem>
            <SelectItem value="OUVERT">{t("status.open")}</SelectItem>
            <SelectItem value="RESOLU">{t("status.resolved")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-2.5">
          <p className="text-sm font-medium">{t("selectedCount", { count: selected.size })}</p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>{t("deselectAll")}</Button>
            <Button variant="outline" size="sm" onClick={() => setBulkResolveOpen(true)}>{t("resolveSelected")}</Button>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        data={alerts}
        loading={isLoading}
        keyExtractor={alert => alert.id}
        empty={search ? t("emptyForSearch", { search }) : t("empty")}
        selection={{
          selectedIds:  selected,
          onToggle:     toggleOne,
          onToggleAll:  toggleAllOnPage,
          isSelectable: alert => alert.status === "OUVERT",
        }}
        pagination={result ? {
          page: result.page, totalPages: result.totalPages, total: result.total, limit: result.limit,
          onPageChange: setPage,
        } : undefined}
      />

      {resolvingAlert && (
        <ResolveDialog
          title={t("resolveConfirmTitle")}
          description={t("resolveConfirmDescription")}
          isPending={resolveOne.isPending}
          onConfirm={note => resolveOne.mutateAsync(note)}
          onOpenChange={open => { if (!open) setResolvingAlert(null) }}
        />
      )}

      {bulkResolveOpen && (
        <ResolveDialog
          title={t("resolveManyConfirmTitle")}
          description={t("resolveConfirmDescription")}
          isPending={resolveMany.isPending}
          onConfirm={async note => {
            await resolveMany.mutateAsync({ ids: Array.from(selected), note })
            setSelected(new Set())
          }}
          onOpenChange={setBulkResolveOpen}
        />
      )}

      {reopeningAlert && (
        <ConfirmDialog
          open
          onOpenChange={open => { if (!open) setReopeningAlert(null) }}
          title={t("reopenConfirmTitle")}
          description={t("reopenConfirmDescription")}
          confirmLabel={t("reopenAction")}
          confirmVariant="default"
          loading={reopenOne.isPending}
          onConfirm={() => reopenOne.mutateAsync().then(() => setReopeningAlert(null))}
        />
      )}
    </div>
  )
}
