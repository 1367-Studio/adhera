"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PlusIcon, TrashIcon, UsersIcon, BookmarkSimpleIcon, ListIcon, CalendarDotsIcon, MapPinIcon, LinkIcon, StarIcon, NotePencilIcon, CloudArrowUpIcon, CloudArrowDownIcon, CopyIcon, ArchiveIcon } from "@phosphor-icons/react/dist/ssr";
import { ViewToggle } from "@/components/ui/view-toggle"
import { PriceBadge } from "@/components/ui/price-badge"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useRouter } from "next/navigation"
import { useEvenementsPaginated, useDeleteEvenement } from "@/hooks/use-evenements"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EvenementsCalendar } from "@/components/evenements/evenements-calendar"
import { Button } from "@/components/ui/button"
import { RowActions } from "@/components/ui/row-actions"
import { SearchInput } from "@/components/ui/search-input"
import { BASE_PATH } from "@/lib/env"
import { cheapestAvailableTicketTypePrice } from "@/lib/ticket-types"

type EvenementStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED"
type EvenementTicketType = { id: string; label: string; price: string; remaining: number | null; full: boolean; active: boolean }

type Evenement = {
  id:          string
  title:       string
  status:      EvenementStatus
  date:        string
  endDate:     string | null
  location:    string | null
  lat:         number | null
  lng:         number | null
  price:       string | null
  description: string | null
  imageUrl:    string | null
  capacity:    number | null
  ticketTypes:    EvenementTicketType[]
  _count:         { participations: number }
  confirmedCount: number
}

function dateToDatetimeLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type ViewMode = "list" | "calendar"

const PAGE_SIZE = 20

export function EvenementsView() {
  const t = useTranslations()
  const router = useRouter()
  const qc = useQueryClient()
  const [view, setView]                   = useState<ViewMode>("list")
  const [page, setPage]                   = useState(1)
  const [searchInput, setSearchInput]     = useState("")
  const [search, setSearch]               = useState("")
  const [createOpen, setCreateOpen]       = useState(false)
  const [newTitle, setNewTitle]           = useState("")
  const [newDate, setNewDate]             = useState<string>("")
  const [deleteTarget, setDeleteTarget]   = useState<Evenement | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function openCreate(date?: Date) {
    setNewDate(date ? dateToDatetimeLocal(date) : dateToDatetimeLocal(new Date(Date.now() + 86400000)))
    setNewTitle("")
    setCreateOpen(true)
  }

  function handleCalendarPresencesClick(ev: { id: string }) { router.push(`/dashboard/evenements/${ev.id}/presences`) }

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function handleSearch(val: string) {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(val); setPage(1) }, 300)
  }

  const { data: result, isLoading } = useEvenementsPaginated(page, PAGE_SIZE, search || undefined)
  const evenements = (result?.data ?? []) as Evenement[]

  // Only need the slug to build the public registration link — reuses the same
  // query key as parametres-view.tsx so react-query can dedupe it when both are cached.
  const { data: assoc } = useQuery<{ slug: string }>({
    queryKey: ["association"],
    queryFn:  () => fetch("/api/association").then(r => r.json()),
  })

  async function handleCopyLink(evenementId: string) {
    if (!assoc?.slug) return
    const url = `${window.location.origin}${BASE_PATH}/${assoc.slug}/evenements/${evenementId}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t("evenements.view.toasts.linkCopied"))
    } catch {
      toast.error(t("common.error"))
    }
  }

  useEffect(() => {
    if (result && result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages)
  }, [result, page])

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; date: string }) => {
      const res = await fetch("/api/evenements", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? t("common.error"))
      return res.json() as Promise<Evenement>
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["evenements"] })
      setCreateOpen(false)
      router.push(`/dashboard/evenements/${created.id}`)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  })

  const publishMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "publish" | "unpublish" | "archive" | "duplicate" }) => {
      const res = await fetch(`/api/evenements/${id}/publish`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? t("common.error"))
      return res.json() as Promise<Evenement>
    },
    onSuccess: (_ev, variables) => {
      qc.invalidateQueries({ queryKey: ["evenements"] })
      toast.success(variables.action === "duplicate" ? t("evenements.view.toasts.duplicated") : t("evenements.view.toasts.statusUpdated"))
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  })

  const deleteMutation = useDeleteEvenement()

  function handleCreate() {
    if (!newTitle.trim() || !newDate) return
    createMutation.mutate({ title: newTitle.trim(), date: new Date(newDate).toISOString() })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success(t("evenements.view.toasts.deleted"))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  const STATUS_LABEL   = { DRAFT: t("evenements.formStatus.draft"), PUBLISHED: t("evenements.formStatus.published"), ARCHIVED: t("evenements.formStatus.archived") }
  const STATUS_VARIANT: Record<EvenementStatus, "secondary" | "default" | "outline"> = {
    DRAFT: "secondary", PUBLISHED: "default", ARCHIVED: "outline",
  }

  const columns: Column<Evenement>[] = [
    {
      key: "event",
      header: t("evenements.view.columns.event"),
      cell: (e) => {
        // Une tarif désactivée n'est plus achetable — même filtre que le formulaire public
        // (realTicketTypes dans inscription/route.ts), pour ne jamais afficher un prix que
        // personne ne peut plus obtenir.
        const activeTicketTypes = e.ticketTypes.filter(tt => tt.active)
        return (
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <p className="font-medium">{e.title}</p>
            <Badge variant={STATUS_VARIANT[e.status]}>{STATUS_LABEL[e.status]}</Badge>
            {activeTicketTypes.length > 1
              ? <PriceBadge price={cheapestAvailableTicketTypePrice(activeTicketTypes)} fromPrice />
              : activeTicketTypes.length === 1
                ? <PriceBadge price={activeTicketTypes[0].price} />
                : <PriceBadge price={e.price} />}
          </div>
          {e.location && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              {e.location}
              {e.lat != null && e.lng != null && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={ev => ev.stopPropagation()}
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  <MapPinIcon className="size-3" />
                </a>
              )}
            </p>
          )}
        </div>
        )
      },
    },
    {
      key: "date",
      header: t("evenements.view.columns.date"),
      cell: (e) => (
        <div>
          <p className="text-sm">{format(new Date(e.date), "dd MMM yyyy", { locale: fr })}</p>
          <p className="text-xs text-muted-foreground">{format(new Date(e.date), "HH:mm", { locale: fr })}</p>
        </div>
      ),
    },
    {
      key: "presences",
      header: t("evenements.view.columns.presences"),
      cell: (e) => {
        const hasFee = e.ticketTypes.length > 0 || (e.price != null && Number(e.price) > 0)
        return (
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); router.push(`/dashboard/evenements/${e.id}/presences`) }}
            className="flex flex-col gap-0.5 text-left transition-colors hover:text-primary"
          >
            <span className="flex items-center gap-1.5 text-sm text-primary">
              <UsersIcon className="size-3.5" />
              {t("evenements.view.presentCount", { count: e._count.participations })}
            </span>
            {hasFee && e.confirmedCount > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <BookmarkSimpleIcon className="size-3.5" />
                {t("evenements.view.reservedCount", { count: e.confirmedCount })}
                {e.capacity != null && ` / ${e.capacity}`}
              </span>
            )}
          </button>
        )
      },
      hideInCard: true,
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      cell: (e) => (
        <RowActions actions={[
          { label: t("evenements.view.actions.open"), icon: <NotePencilIcon className="size-3.5" />, onClick: () => router.push(`/dashboard/evenements/${e.id}`) },
          { label: t("evenements.view.actions.presences"), icon: <UsersIcon className="size-3.5" />,  onClick: () => router.push(`/dashboard/evenements/${e.id}/presences`) },
          { label: t("evenements.view.actions.avaliacoes"), icon: <StarIcon className="size-3.5" />,  onClick: () => router.push(`/dashboard/evenements/${e.id}/avaliacoes`) },
          ...(e.status === "PUBLISHED"
            ? [{ label: t("evenements.view.actions.copyLink"), icon: <LinkIcon className="size-3.5" />, disabled: !assoc?.slug, onClick: () => handleCopyLink(e.id), separator: true }]
            : []),
          ...(e.status !== "PUBLISHED"
            ? [{ label: t("evenements.view.actions.publish"), icon: <CloudArrowUpIcon className="size-3.5" />, onClick: () => publishMutation.mutate({ id: e.id, action: "publish" }), separator: true }]
            : [{ label: t("evenements.view.actions.unpublish"), icon: <CloudArrowDownIcon className="size-3.5" />, onClick: () => publishMutation.mutate({ id: e.id, action: "unpublish" }) }]),
          { label: t("evenements.view.actions.duplicate"), icon: <CopyIcon className="size-3.5" />, onClick: () => publishMutation.mutate({ id: e.id, action: "duplicate" }) },
          ...(e.status !== "ARCHIVED"
            ? [{ label: t("evenements.view.actions.archive"), icon: <ArchiveIcon className="size-3.5" />, onClick: () => publishMutation.mutate({ id: e.id, action: "archive" }) }]
            : []),
          { label: t("evenements.view.actions.delete"), icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(e) },
        ]} />
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("evenements.view.title")}
        description={view === "list" ? t("evenements.view.count", { count: result?.total ?? 0 }) : t("evenements.view.calendarView")}
        action={
          <div className="flex items-center gap-2">
            <ViewToggle
              options={[
                { value: "list",     label: t("evenements.view.listLabel"),     icon: <ListIcon         className="size-3.5" /> },
                { value: "calendar", label: t("evenements.view.calendarLabel"), icon: <CalendarDotsIcon className="size-3.5" /> },
              ]}
              value={view}
              onChange={setView}
            />
            <Button size="sm" onClick={() => openCreate()}>
              <PlusIcon className="mr-1.5 size-4" />
              {t("evenements.view.create")}
            </Button>
          </div>
        }
      />

      {view === "calendar" ? (
        <EvenementsCalendar
          onEditClick={(ev) => router.push(`/dashboard/evenements/${ev.id}`)}
          onPresencesClick={handleCalendarPresencesClick}
          onCreateClick={openCreate}
        />
      ) : (
        <>
          <SearchInput
            value={searchInput}
            onValueChange={handleSearch}
            onClear={() => {
              if (debounceRef.current) clearTimeout(debounceRef.current)
              setSearchInput("")
              setSearch("")
              setPage(1)
            }}
            placeholder={t("evenements.view.searchPlaceholder")}
            containerClassName="w-72"
          />

          <DataTable
            columns={columns}
            data={evenements}
            loading={isLoading}
            keyExtractor={(e) => e.id}
            onRowClick={(e) => router.push(`/dashboard/evenements/${e.id}`)}
            empty={search ? t("evenements.view.noResultsFor", { search }) : t("evenements.view.noEvent")}
            pagination={result ? {
              page:         result.page,
              totalPages:   result.totalPages,
              total:        result.total,
              limit:        result.limit,
              onPageChange: (p) => setPage(p),
            } : undefined}
          />
        </>
      )}

      {/* Nouvel événement — titre + date seulement, la configuration complète se fait dans
          l'assistant (voir src/app/dashboard/evenements/[id]/page.tsx), même principe que
          "Nouveau formulaire" pour les adhésions. */}
      <Modal
        open={createOpen}
        onOpenChange={(o) => { if (!o) setCreateOpen(false) }}
        title={t("evenements.view.newEventModal.title")}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button>
            <Button
              loading={createMutation.isPending}
              disabled={!newTitle.trim() || !newDate}
              onClick={handleCreate}
            >
              {t("evenements.view.newEventModal.createButton")}
            </Button>
          </>
        }
      >
        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="new-event-title">{t("evenements.view.newEventModal.titleLabel")}</Label>
            <Input
              id="new-event-title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t("evenements.view.newEventModal.titlePlaceholder")}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-event-date">{t("evenements.view.newEventModal.dateLabel")}</Label>
            <Input
              id="new-event-date"
              type="datetime-local"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      {/* Delete */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("evenements.view.deleteConfirmTitle", { title: deleteTarget?.title ?? "" })}
        description={t("evenements.view.deleteConfirmDescription")}
        confirmLabel={t("common.delete")}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />

    </div>
  )
}
