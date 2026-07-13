"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { PlusIcon, PencilSimpleIcon, ArchiveIcon, MagnifyingGlassIcon, XIcon, EyeIcon } from "@phosphor-icons/react/dist/ssr";
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
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"

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

const statusBadge: Record<Fournisseur["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ACTIF:   { label: "Actif",   variant: "default"   },
  INACTIF: { label: "Inactif", variant: "secondary" },
  ARCHIVE: { label: "Archivé", variant: "outline"   },
}

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder: string
}) {
  const selected = options.find(o => o.value === value)
  return (
    <Select value={value || "__all__"} onValueChange={v => onChange(!v || v === "__all__" ? "" : v)}>
      <SelectTrigger className="w-40">
        <span className={selected ? "text-sm" : "text-sm text-muted-foreground"}>
          {selected?.label ?? placeholder}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{placeholder}</SelectItem>
        {options.map(o => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const PAGE_SIZE = 20

export function FournisseursView() {
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
      toast.success("Fournisseur ajouté avec succès")
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleUpdate(data: FournisseurInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success("Fournisseur mis à jour")
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success("Fournisseur archivé")
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  const columns: Column<Fournisseur>[] = [
    {
      key: "name",
      header: "Fournisseur",
      cell: (f) => (
        <div className="space-y-0.5">
          <p className="font-medium">{f.companyName}</p>
          {f.contactName && <p className="text-xs text-muted-foreground">{f.contactName}</p>}
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
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
      header: "Ville",
      cell: (f) => f.city ?? <span className="text-muted-foreground text-xs">—</span>,
      hideInCard: true,
    },
    {
      key: "category",
      header: "Catégorie",
      cell: (f) => f.category ?? <span className="text-muted-foreground text-xs">—</span>,
      hideInCard: true,
    },
    {
      key: "status",
      header: "Statut",
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
          { label: "Voir la fiche", icon: <EyeIcon className="size-3.5" />, onClick: () => router.push(`/dashboard/fournisseurs/${f.id}`) },
          { label: "Modifier",      icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => setEditTarget(f) },
          { label: "Archiver",     icon: <ArchiveIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(f) },
        ]} />
      ),
    },
  ]

  const descriptionText = search
    ? `${result?.total ?? 0} résultat${(result?.total ?? 0) !== 1 ? "s" : ""}`
    : `${result?.total ?? 0} fournisseur${(result?.total ?? 0) !== 1 ? "s" : ""}`

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fournisseurs"
        description={descriptionText}
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            Ajouter
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <div className="relative w-72">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Rechercher un fournisseur…"
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

        <FilterSelect
          value={statusFilter}
          onChange={v => { setStatusFilter(v); setPage(1) }}
          options={[
            { value: "ACTIF",   label: "Actifs"   },
            { value: "INACTIF", label: "Inactifs" },
            { value: "ARCHIVE", label: "Archivés" },
          ]}
          placeholder="Tous les statuts"
        />
      </div>

      <DataTable
        columns={columns}
        data={fournisseurs}
        loading={isLoading}
        keyExtractor={(f) => f.id}
        empty={search ? `Aucun résultat pour « ${search} »` : "Aucun fournisseur enregistré"}
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
        title="Ajouter un fournisseur"
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
        title="Modifier le fournisseur"
        size="lg"
        dismissable={false}
      >
        {editDetailLoading || !editDetail ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Chargement…</p>
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
        title={`Archiver ${deleteTarget?.companyName} ?`}
        description={
          dependencyCounts && dependencyCounts.devis + dependencyCounts.factures > 0
            ? `Ce fournisseur n'apparaîtra plus dans les listes. Il reste lié à ${dependencyCounts.devis} devis et ${dependencyCounts.factures} facture(s) — ils resteront consultables, mais ce fournisseur n'apparaîtra plus dans les formulaires de création (sauf sur ces documents existants).`
            : "Ce fournisseur n'apparaîtra plus dans les listes."
        }
        confirmLabel="Archiver"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
