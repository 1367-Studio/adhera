"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { PlusIcon, PencilSimpleIcon, TrashIcon, UsersIcon, BookmarkSimpleIcon, ListIcon, CalendarDotsIcon, MapPinIcon, ListChecksIcon, LinkIcon, TagIcon } from "@phosphor-icons/react/dist/ssr";
import { ViewToggle } from "@/components/ui/view-toggle"
import { PriceBadge } from "@/components/ui/price-badge"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useRouter } from "next/navigation"
import { useEvenementsPaginated, useCreateEvenement, useUpdateEvenement, useDeleteEvenement } from "@/hooks/use-evenements"
import type { CalendarEvenement } from "@/hooks/use-evenements"
import type { EvenementInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EvenementForm } from "@/components/evenements/evenement-form"
import { EvenementCustomFieldsEditor } from "@/components/evenements/evenement-custom-fields-editor"
import { EvenementTicketTypesEditor } from "@/components/evenements/evenement-ticket-types-editor"
import { EvenementsCalendar } from "@/components/evenements/evenements-calendar"
import { Button } from "@/components/ui/button"
import { RowActions } from "@/components/ui/row-actions"
import { SearchInput } from "@/components/ui/search-input"
import { BASE_PATH } from "@/lib/env"
import { cheapestAvailableTicketTypePrice } from "@/lib/ticket-types"

type EvenementTicketType = { id: string; label: string; price: string; remaining: number | null; full: boolean }

type Evenement = {
  id:          string
  title:       string
  date:        string
  endDate:     string | null
  location:    string | null
  lat:         number | null
  lng:         number | null
  price:       string | null
  description: string | null
  imageUrl:    string | null
  capacity:    number | null
  qrToken:     string | null
  qrExpiresAt: string | null
  ticketTypes:    EvenementTicketType[]
  _count:         { participations: number }
  confirmedCount: number
}


function dateToDatetimeLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// The <input type="datetime-local"> value has no timezone — it represents wall-clock
// time in the browser's own timezone. Round-trip through a real Date so it converts to
// the correct UTC instant, instead of a server (running in UTC) misreading "14:00" as
// 14:00 UTC and shifting every event by the local UTC offset.
function toDatetimeLocal(iso: string) {
  return dateToDatetimeLocal(new Date(iso))
}

function localDatetimeToISO(value: string): string {
  return new Date(value).toISOString()
}

type ViewMode = "list" | "calendar"

const PAGE_SIZE = 20

export function EvenementsView() {
  const t = useTranslations()
  const router = useRouter()
  const [view, setView]                   = useState<ViewMode>("list")
  const [page, setPage]                   = useState(1)
  const [searchInput, setSearchInput]     = useState("")
  const [search, setSearch]               = useState("")
  const [createOpen, setCreateOpen]       = useState(false)
  const [createDate, setCreateDate]       = useState<string | undefined>()
  const [editTarget, setEditTarget]       = useState<Evenement | null>(null)
  const [deleteTarget, setDeleteTarget]   = useState<Evenement | null>(null)
  const [customFieldsTarget, setCustomFieldsTarget] = useState<Evenement | null>(null)
  const [ticketTypesTarget, setTicketTypesTarget]   = useState<Evenement | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function openCreate(date?: Date) {
    setCreateDate(date ? dateToDatetimeLocal(date) : undefined)
    setCreateOpen(true)
  }

  function calendarEventToEvenement(ev: CalendarEvenement): Evenement {
    return { id: ev.id, title: ev.title, date: ev.date, endDate: ev.endDate, location: ev.location, lat: ev.lat, lng: ev.lng, price: ev.price, description: ev.description, imageUrl: ev.imageUrl, capacity: ev.capacity, qrToken: ev.qrToken, qrExpiresAt: ev.qrExpiresAt, ticketTypes: ev.ticketTypes, _count: ev._count, confirmedCount: 0 }
  }

  function handleCalendarEditClick(ev: CalendarEvenement)      { setEditTarget(calendarEventToEvenement(ev)) }
  function handleCalendarPresencesClick(ev: CalendarEvenement) { router.push(`/dashboard/evenements/${ev.id}/presences`) }

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

  const createMutation = useCreateEvenement()
  const updateMutation = useUpdateEvenement(editTarget?.id ?? "")
  const deleteMutation = useDeleteEvenement()

  async function handleCreate(data: EvenementInput) {
    try {
      await createMutation.mutateAsync({
        ...data,
        date:    localDatetimeToISO(data.date),
        endDate: data.endDate ? localDatetimeToISO(data.endDate) : data.endDate,
      })
      toast.success(t("evenements.view.toasts.created"))
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleUpdate(data: EvenementInput) {
    try {
      await updateMutation.mutateAsync({
        ...data,
        date:    localDatetimeToISO(data.date),
        endDate: data.endDate ? localDatetimeToISO(data.endDate) : data.endDate,
      })
      toast.success(t("evenements.view.toasts.updated"))
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
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

  const columns: Column<Evenement>[] = [
    {
      key: "event",
      header: t("evenements.view.columns.event"),
      cell: (e) => (
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <p className="font-medium">{e.title}</p>
            {e.ticketTypes.length > 1
              ? <PriceBadge price={cheapestAvailableTicketTypePrice(e.ticketTypes)} fromPrice />
              : e.ticketTypes.length === 1
                ? <PriceBadge price={e.ticketTypes[0].price} />
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
      ),
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
          { label: t("evenements.view.actions.presences"), icon: <UsersIcon className="size-3.5" />,  onClick: () => router.push(`/dashboard/evenements/${e.id}/presences`) },
          { label: t("evenements.view.actions.copyLink"), icon: <LinkIcon className="size-3.5" />, disabled: !assoc?.slug, onClick: () => handleCopyLink(e.id) },
          { label: t("evenements.view.actions.edit"),  icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => setEditTarget(e),     separator: true },
          { label: t("evenements.view.actions.customFields"), icon: <ListChecksIcon className="size-3.5" />, onClick: () => setCustomFieldsTarget(e) },
          { label: t("evenements.view.actions.ticketTypes"), icon: <TagIcon className="size-3.5" />, onClick: () => setTicketTypesTarget(e) },
          { label: t("evenements.view.actions.delete"), icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true,  onClick: () => setDeleteTarget(e) },
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
          onEditClick={handleCalendarEditClick}
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

      {/* Create */}
      <Modal open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setCreateDate(undefined) } }} title={t("evenements.view.createTitle")} size="lg" dismissable={false}>
        <EvenementForm key={createDate ?? "create"}
          defaultValues={createDate ? { date: createDate } : undefined}
          onSubmit={handleCreate}
          onCancel={() => { setCreateOpen(false); setCreateDate(undefined) }}
          loading={createMutation.isPending}
        />
      </Modal>

      {/* Edit */}
      <Modal
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        title={t("evenements.view.editTitle")}
        size="lg"
        dismissable={false}
      >
        <EvenementForm key={editTarget?.id}
          defaultValues={editTarget ? {
            title:       editTarget.title,
            date:        toDatetimeLocal(editTarget.date),
            endDate:     editTarget.endDate ? toDatetimeLocal(editTarget.endDate) : "",
            location:    editTarget.location    ?? "",
            description: editTarget.description ?? "",
            imageUrl:    editTarget.imageUrl    ?? "",
            lat:         editTarget.lat      ?? undefined,
            lng:         editTarget.lng      ?? undefined,
            price:       editTarget.price    != null ? Number(editTarget.price)    : undefined,
            capacity:    editTarget.capacity != null ? Number(editTarget.capacity) : undefined,
          } : undefined}
          hasTicketTypes={!!editTarget?.ticketTypes.length}
          onSubmit={handleUpdate}
          onCancel={() => setEditTarget(null)}
          loading={updateMutation.isPending}
        />
      </Modal>

      {/* Custom fields */}
      <Modal
        open={!!customFieldsTarget}
        onOpenChange={(open) => !open && setCustomFieldsTarget(null)}
        title={t("evenements.customFields.modalTitle", { title: customFieldsTarget?.title ?? "" })}
        size="lg"
        dismissable={false}
      >
        {customFieldsTarget && (
          <EvenementCustomFieldsEditor
            evenementId={customFieldsTarget.id}
            onClose={() => setCustomFieldsTarget(null)}
          />
        )}
      </Modal>

      {/* Ticket types */}
      <Modal
        open={!!ticketTypesTarget}
        onOpenChange={(open) => !open && setTicketTypesTarget(null)}
        title={t("evenements.ticketTypes.modalTitle", { title: ticketTypesTarget?.title ?? "" })}
        size="lg"
        dismissable={false}
      >
        {ticketTypesTarget && (
          <EvenementTicketTypesEditor
            evenementId={ticketTypesTarget.id}
            eventCapacity={ticketTypesTarget.capacity}
            onClose={() => setTicketTypesTarget(null)}
          />
        )}
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
