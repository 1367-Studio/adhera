"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { dateOnlyToLocal } from "@/lib/date-format"
import { PlusIcon, PencilSimpleIcon, ArchiveIcon, ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr"
import { useGrupos, useCreateGrupo, useUpdateGrupo, useArchiveGrupo, type Grupo } from "@/hooks/use-grupos"
import { useHasAccess } from "@/lib/user-context"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { FilterSelect } from "@/components/ui/filter-select"
import { SearchInput } from "@/components/ui/search-input"
import { GrupoForm } from "@/components/grupos/grupo-form"
import type { GrupoInput } from "@/lib/schemas"

export function GruposView() {
  const t      = useTranslations()
  const router = useRouter()
  const canEdit = useHasAccess("groupes", "edit")

  const [searchInput, setSearchInput]   = useState("")
  const [search, setSearch]             = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [createOpen, setCreateOpen]     = useState(false)
  const [editTarget, setEditTarget]     = useState<Grupo | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Grupo | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function handleSearch(val: string) {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearch(val), 300)
  }

  const statusParam = statusFilter === "ACTIF" ? "ativo" : statusFilter === "ARCHIVE" ? "arquivado" : undefined
  const { data: grupos = [], isLoading } = useGrupos({ status: statusParam, search: search || undefined })

  const createMutation  = useCreateGrupo()
  const updateMutation  = useUpdateGrupo(editTarget?.id ?? "")
  const archiveMutation = useArchiveGrupo(archiveTarget?.id ?? "")

  async function handleCreate(data: GrupoInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success(t("groupes.view.toasts.created"))
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleUpdate(data: GrupoInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success(t("groupes.view.toasts.updated"))
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleArchiveToggle() {
    if (!archiveTarget) return
    const archiving = !archiveTarget.archivedAt
    try {
      await archiveMutation.mutateAsync(archiving)
      toast.success(archiving ? t("groupes.view.toasts.archived") : t("groupes.view.toasts.unarchived"))
      setArchiveTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  const columns: Column<Grupo>[] = [
    {
      key: "nome",
      header: t("groupes.view.columns.nome"),
      cell: (g) => (
        <div className="space-y-0.5">
          <p className="font-medium">{g.nome}</p>
          {g.descricao && <p className="text-xs text-muted-foreground">{g.descricao}</p>}
        </div>
      ),
    },
    {
      key: "membres",
      header: t("groupes.view.columns.membres"),
      cell: (g) => g._count.membros,
      className: "tabular-nums",
    },
    {
      key: "responsaveis",
      header: t("groupes.view.columns.responsaveis"),
      cell: (g) => g.responsaveis.length
        ? g.responsaveis.map(r => r.user.name ?? r.user.email).join(", ")
        : <span className="text-muted-foreground text-xs">—</span>,
      hideInCard: true,
    },
    {
      key: "lastChamada",
      header: t("groupes.view.columns.lastChamada"),
      cell: (g) => g.chamadas[0] ? format(dateOnlyToLocal(g.chamadas[0].data), "dd/MM/yyyy") : <span className="text-muted-foreground text-xs">—</span>,
      hideInCard: true,
    },
    {
      key: "status",
      header: "",
      cell: (g) => g.archivedAt ? <Badge variant="outline">{t("groupes.view.statusBadge.archive")}</Badge> : null,
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      cell: (g) => canEdit ? (
        <RowActions actions={[
          { label: t("groupes.view.actions.edit"), icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => setEditTarget(g) },
          g.archivedAt
            ? { label: t("groupes.view.actions.unarchive"), icon: <ArrowCounterClockwiseIcon className="size-3.5" />, separator: true, onClick: () => setArchiveTarget(g) }
            : { label: t("groupes.view.actions.archive"), icon: <ArchiveIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setArchiveTarget(g) },
        ]} />
      ) : null,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("groupes.view.title")}
        description={t(search ? "groupes.view.count" : "groupes.view.countTotal", { count: grupos.length })}
        action={canEdit && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            {t("common.add")}
          </Button>
        )}
      />

      <div className="flex flex-wrap gap-2">
        <SearchInput
          value={searchInput}
          onValueChange={handleSearch}
          onClear={() => { if (debounceRef.current) clearTimeout(debounceRef.current); setSearchInput(""); setSearch("") }}
          placeholder={t("groupes.view.searchPlaceholder")}
          containerClassName="w-72"
        />
        <FilterSelect
          value={statusFilter}
          onValueChange={setStatusFilter}
          options={[
            { value: "ACTIF",   label: t("groupes.view.statusFilter.actifs")  },
            { value: "ARCHIVE", label: t("groupes.view.statusFilter.archives") },
          ]}
          placeholder={t("groupes.view.allStatuses")}
          width="w-40"
        />
      </div>

      <DataTable
        columns={columns}
        data={grupos}
        loading={isLoading}
        keyExtractor={(g) => g.id}
        empty={search ? t("groupes.view.noResultsFor", { search }) : t("groupes.view.noGroupe")}
        onRowClick={(g) => router.push(`/dashboard/groupes/${g.id}`)}
      />

      <Modal open={createOpen} onOpenChange={setCreateOpen} title={t("groupes.view.addTitle")} dismissable={false}>
        <GrupoForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} loading={createMutation.isPending} />
      </Modal>

      <Modal open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)} title={t("groupes.view.editTitle")} dismissable={false}>
        {editTarget && (
          <GrupoForm
            key={editTarget.id}
            defaultValues={{ nome: editTarget.nome, descricao: editTarget.descricao ?? "" }}
            onSubmit={handleUpdate}
            onCancel={() => setEditTarget(null)}
            loading={updateMutation.isPending}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={t(archiveTarget?.archivedAt ? "groupes.view.unarchiveConfirmTitle" : "groupes.view.archiveConfirmTitle", { name: archiveTarget?.nome ?? "" })}
        description={archiveTarget?.archivedAt ? undefined : t("groupes.view.archiveConfirmDescription")}
        confirmLabel={t(archiveTarget?.archivedAt ? "groupes.view.actions.unarchive" : "groupes.view.actions.archive")}
        confirmVariant={archiveTarget?.archivedAt ? "default" : "destructive"}
        loading={archiveMutation.isPending}
        onConfirm={handleArchiveToggle}
      />
    </div>
  )
}
