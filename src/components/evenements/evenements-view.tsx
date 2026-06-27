"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { PlusIcon, PencilIcon, Trash2Icon, SearchIcon, XIcon, UsersIcon, BookmarkIcon, ListIcon, CalendarDaysIcon, MapPinIcon } from "lucide-react"
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
import { EvenementsCalendar } from "@/components/evenements/evenements-calendar"
import { Button } from "@/components/ui/button"
import { RowActions } from "@/components/ui/row-actions"

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
  capacity:    number | null
  qrToken:     string | null
  qrExpiresAt: string | null
  _count:         { participations: number }
  confirmedCount: number
}

function toDatetimeLocal(iso: string) {
  return iso.slice(0, 16)
}

function dateToDatetimeLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type ViewMode = "list" | "calendar"

const PAGE_SIZE = 20

export function EvenementsView() {
  const router = useRouter()
  const [view, setView]                   = useState<ViewMode>("list")
  const [page, setPage]                   = useState(1)
  const [searchInput, setSearchInput]     = useState("")
  const [search, setSearch]               = useState("")
  const [createOpen, setCreateOpen]       = useState(false)
  const [createDate, setCreateDate]       = useState<string | undefined>()
  const [editTarget, setEditTarget]       = useState<Evenement | null>(null)
  const [deleteTarget, setDeleteTarget]   = useState<Evenement | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function openCreate(date?: Date) {
    setCreateDate(date ? dateToDatetimeLocal(date) : undefined)
    setCreateOpen(true)
  }

  function calendarEventToEvenement(ev: CalendarEvenement): Evenement {
    return { id: ev.id, title: ev.title, date: ev.date, endDate: ev.endDate, location: ev.location, lat: ev.lat, lng: ev.lng, price: ev.price, description: ev.description, capacity: ev.capacity, qrToken: ev.qrToken, qrExpiresAt: ev.qrExpiresAt, _count: ev._count, confirmedCount: 0 }
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

  useEffect(() => {
    if (result && result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages)
  }, [result, page])

  const createMutation = useCreateEvenement()
  const updateMutation = useUpdateEvenement(editTarget?.id ?? "")
  const deleteMutation = useDeleteEvenement()

  async function handleCreate(data: EvenementInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success("Événement créé avec succès")
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleUpdate(data: EvenementInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success("Événement mis à jour")
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success("Événement supprimé")
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  const columns: Column<Evenement>[] = [
    {
      key: "event",
      header: "Événement",
      cell: (e) => (
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <p className="font-medium">{e.title}</p>
            <PriceBadge price={e.price} />
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
      header: "Date",
      cell: (e) => (
        <div>
          <p className="text-sm">{format(new Date(e.date), "dd MMM yyyy", { locale: fr })}</p>
          <p className="text-xs text-muted-foreground">{format(new Date(e.date), "HH:mm", { locale: fr })}</p>
        </div>
      ),
    },
    {
      key: "presences",
      header: "Présences",
      cell: (e) => {
        const hasFee = e.price != null && Number(e.price) > 0
        return (
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); router.push(`/dashboard/evenements/${e.id}/presences`) }}
            className="flex flex-col gap-0.5 text-left hover:opacity-75 transition-opacity"
          >
            <span className="flex items-center gap-1.5 text-sm text-primary">
              <UsersIcon className="size-3.5" />
              {e._count.participations} présent{e._count.participations !== 1 ? "s" : ""}
            </span>
            {hasFee && e.confirmedCount > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <BookmarkIcon className="size-3.5" />
                {e.confirmedCount} réservé{e.confirmedCount !== 1 ? "s" : ""}
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
          { label: "Présences", icon: <UsersIcon className="size-3.5" />,  onClick: () => router.push(`/dashboard/evenements/${e.id}/presences`) },
          { label: "Modifier",  icon: <PencilIcon className="size-3.5" />, onClick: () => setEditTarget(e),     separator: true },
          { label: "Supprimer", icon: <Trash2Icon className="size-3.5" />, destructive: true, separator: true,  onClick: () => setDeleteTarget(e) },
        ]} />
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Événements"
        description={view === "list" ? `${result?.total ?? 0} événement${(result?.total ?? 0) !== 1 ? "s" : ""}` : "Vue calendrier"}
        action={
          <div className="flex items-center gap-2">
            <ViewToggle
              options={[
                { value: "list",     label: "Liste",      icon: <ListIcon         className="size-3.5" /> },
                { value: "calendar", label: "Calendrier", icon: <CalendarDaysIcon className="size-3.5" /> },
              ]}
              value={view}
              onChange={setView}
            />
            <Button size="sm" onClick={() => openCreate()}>
              <PlusIcon className="mr-1.5 size-4" />
              Créer
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
          <div className="relative w-72">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Rechercher un événement…"
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

          <DataTable
            columns={columns}
            data={evenements}
            loading={isLoading}
            keyExtractor={(e) => e.id}
            empty={search ? `Aucun résultat pour « ${search} »` : "Aucun événement créé"}
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
      <Modal open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setCreateDate(undefined) } }} title="Créer un événement" size="lg" dismissable={false}>
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
        title="Modifier l'événement"
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
            lat:         editTarget.lat      ?? undefined,
            lng:         editTarget.lng      ?? undefined,
            price:       editTarget.price    != null ? Number(editTarget.price)    : undefined,
            capacity:    editTarget.capacity != null ? Number(editTarget.capacity) : undefined,
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
        title={`Supprimer « ${deleteTarget?.title} » ?`}
        description="L'événement et toutes les présences associées seront supprimés définitivement."
        confirmLabel="Supprimer"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />

    </div>
  )
}
