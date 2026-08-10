"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, PencilSimpleIcon, ArchiveIcon, EyeIcon } from "@phosphor-icons/react/dist/ssr";
import { useFournisseursPaginated, useFournisseur, useCreateFournisseur, useUpdateFournisseur, useDeleteFournisseur } from "@/hooks/use-fournisseurs"
import type { FournisseurInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { FournisseurForm } from "@/components/fournisseurs/fournisseur-form"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { FilterSelect } from "@/components/ui/filter-select"
import { SearchInput } from "@/components/ui/search-input"

type Fournisseur = {
  id:           string
  companyName:  string
  tradeName:    string | null
  contactName:  string | null
  email:        string | null
  phone:        string | null
  city:         string | null
  category:     string | null
  status:       "ACTIF" | "INACTIF" | "ARCHIVE"
}

type Translator = ReturnType<typeof useTranslations>

function getStatusBadge(t: Translator): Record<Fournisseur["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> {
  return {
    ACTIF:   { label: t("fournisseurs.form.status.actif"),   variant: "default"   },
    INACTIF: { label: t("fournisseurs.form.status.inactif"), variant: "secondary" },
    ARCHIVE: { label: t("fournisseurs.view.status.archive"), variant: "outline"   },
  }
}

const PAGE_SIZE = 20

export function FournisseursView() {
  const t                               = useTranslations()
  const router                          = useRouter()
  const [page, setPage]                 = useState(1)
  const [searchInput, setSearchInput]   = useState("")
  const [search, setSearch]             = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [createOpen, setCreateOpen]     = useState(false)
  const [editTarget, setEditTarget]     = useState<Fournisseur | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Fournisseur | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function handleSearch(val: string) {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(val); setPage(1) }, 300)
  }

  const { data: result, isLoading } = useFournisseursPaginated(page, PAGE_SIZE, search || undefined, statusFilter || undefined)
  const fournisseurs = (result?.data ?? []) as Fournisseur[]

  // Fetched on demand only once a fournisseur is targeted for archiving, so the count
  // shows up in the confirm dialog instead of silently hiding that the fournisseur is
  // still referenced by existing documents.
  const { data: dependencyCounts } = useQuery({
    queryKey: ["fournisseur-dependency-counts", deleteTarget?.id],
    queryFn: async () => {
      const [devisRes, facturesRes] = await Promise.all([
        fetch(`/api/devis?fournisseurId=${deleteTarget!.id}&page=1&limit=1`),
        fetch(`/api/factures?fournisseurId=${deleteTarget!.id}&page=1&limit=1`),
      ])
      const [devis, factures] = await Promise.all([devisRes.json(), facturesRes.json()])
      return { devis: devis.total ?? 0, factures: factures.total ?? 0 }
    },
    enabled: !!deleteTarget,
  })

  useEffect(() => {
    if (result && result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages)
  }, [result, page])

  const createMutation = useCreateFournisseur()
  const updateMutation = useUpdateFournisseur(editTarget?.id ?? "")
  const deleteMutation = useDeleteFournisseur()
  // The list query is trimmed to a few display columns — the edit form needs every field
  // (SIRET, adresse, notes…), so fetch the full record by id once a row is targeted for
  // editing rather than reusing the row data (see [[project-devis-facture-fournisseur-modules]]).
  const { data: editDetail, isLoading: editDetailLoading } = useFournisseur(editTarget?.id ?? "")

  async function handleCreate(data: FournisseurInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success(t("fournisseurs.view.toasts.created"))
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleUpdate(data: FournisseurInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success(t("fournisseurs.view.toasts.updated"))
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success(t("fournisseurs.view.toasts.archived"))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  const statusBadge = getStatusBadge(t)

  const columns: Column<Fournisseur>[] = [
    {
      key: "name",
      header: t("fournisseurs.view.columns.name"),
      cell: (f) => (
        <div className="space-y-0.5">
          <p className="font-medium">{f.companyName}</p>
          {f.contactName && <p className="text-xs text-muted-foreground">{f.contactName}</p>}
        </div>
      ),
    },
    {
      key: "contact",
      header: t("fournisseurs.view.columns.contact"),
      cell: (f) => (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {f.email && <p>{f.email}</p>}
          {f.phone && <p>{f.phone}</p>}
          {!f.email && !f.phone && "—"}
        </div>
      ),
      hideInCard: true,
    },
    {
      key: "city",
      header: t("fournisseurs.view.columns.city"),
      cell: (f) => f.city ?? <span className="text-muted-foreground text-xs">—</span>,
      hideInCard: true,
    },
    {
      key: "category",
      header: t("fournisseurs.view.columns.category"),
      cell: (f) => f.category ?? <span className="text-muted-foreground text-xs">—</span>,
      hideInCard: true,
    },
    {
      key: "status",
      header: t("fournisseurs.view.columns.status"),
      cell: (f) => {
        const s = statusBadge[f.status]
        return <Badge variant={s.variant}>{s.label}</Badge>
      },
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      cell: (f) => (
        <RowActions actions={[
          { label: t("fournisseurs.view.actions.view"), icon: <EyeIcon className="size-3.5" />, onClick: () => router.push(`/dashboard/fournisseurs/${f.id}`) },
          { label: t("fournisseurs.view.actions.edit"),      icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => setEditTarget(f) },
          { label: t("fournisseurs.view.actions.archive"),     icon: <ArchiveIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(f) },
        ]} />
      ),
    },
  ]

  const descriptionText = search
    ? t("fournisseurs.view.count", { count: result?.total ?? 0 })
    : t("fournisseurs.view.countTotal", { count: result?.total ?? 0 })

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("fournisseurs.view.title")}
        description={descriptionText}
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            {t("common.add")}
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <SearchInput
          value={searchInput}
          onValueChange={handleSearch}
          onClear={() => {
            if (debounceRef.current) clearTimeout(debounceRef.current)
            setSearchInput("")
            setSearch("")
            setPage(1)
          }}
          placeholder={t("fournisseurs.view.searchPlaceholder")}
          containerClassName="w-72"
        />

        <FilterSelect
          value={statusFilter}
          onValueChange={v => { setStatusFilter(v); setPage(1) }}
          options={[
            { value: "ACTIF",   label: t("fournisseurs.view.statusFilter.actifs")   },
            { value: "INACTIF", label: t("fournisseurs.view.statusFilter.inactifs") },
          ]}
          placeholder={t("fournisseurs.view.allStatuses")}
          width="w-40"
        />
      </div>

      <DataTable
        columns={columns}
        data={fournisseurs}
        loading={isLoading}
        keyExtractor={(f) => f.id}
        empty={search ? t("fournisseurs.view.noResultsFor", { search }) : t("fournisseurs.view.noFournisseur")}
        onRowClick={(f) => router.push(`/dashboard/fournisseurs/${f.id}`)}
        pagination={result ? {
          page:         result.page,
          totalPages:   result.totalPages,
          total:        result.total,
          limit:        result.limit,
          onPageChange: (p) => setPage(p),
        } : undefined}
      />

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("fournisseurs.view.addTitle")}
        size="lg"
        dismissable={false}
      >
        <FournisseurForm
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
          loading={createMutation.isPending}
        />
      </Modal>

      <Modal
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        title={t("fournisseurs.view.editTitle")}
        size="lg"
        dismissable={false}
      >
        {editDetailLoading || !editDetail ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("fournisseurs.view.loadingDetail")}</p>
        ) : (
          <FournisseurForm
            key={editDetail.id}
            defaultValues={{
              companyName:  editDetail.companyName,
              tradeName:    editDetail.tradeName    ?? "",
              contactName:  editDetail.contactName  ?? "",
              contactRole:  editDetail.contactRole  ?? "",
              siret:        editDetail.siret        ?? "",
              siren:        editDetail.siren        ?? "",
              vatNumber:    editDetail.vatNumber    ?? "",
              address:      editDetail.address      ?? "",
              city:         editDetail.city         ?? "",
              postalCode:   editDetail.postalCode   ?? "",
              country:      editDetail.country      ?? "France",
              email:        editDetail.email        ?? "",
              billingEmail: editDetail.billingEmail ?? "",
              phone:        editDetail.phone        ?? "",
              website:      editDetail.website      ?? "",
              category:     editDetail.category     ?? "",
              status:       editDetail.status,
              notes:        editDetail.notes        ?? "",
            }}
            onSubmit={handleUpdate}
            onCancel={() => setEditTarget(null)}
            loading={updateMutation.isPending}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("fournisseurs.view.archiveConfirmTitle", { name: deleteTarget?.companyName ?? "" })}
        description={
          dependencyCounts && dependencyCounts.devis + dependencyCounts.factures > 0
            ? t("fournisseurs.view.archiveConfirmWithDependencies", { devis: dependencyCounts.devis, factures: dependencyCounts.factures })
            : t("fournisseurs.view.archiveConfirmSimple")
        }
        confirmLabel={t("fournisseurs.view.actions.archive")}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
