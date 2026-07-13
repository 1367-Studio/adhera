"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { PlusIcon, PencilSimpleIcon, TrashIcon, MagnifyingGlassIcon, XIcon, ArrowRightIcon, WarningIcon, CopyIcon, ClockCounterClockwiseIcon, DownloadSimpleIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { useDevisPaginated, useDevisDetail, useCreateDevis, useUpdateDevis, useDeleteDevis, useConvertDevis, useDuplicateDevis, useSendDevisEmail } from "@/hooks/use-devis"
import { ApiError } from "@/lib/api-error"
import type { DevisInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DocumentHistoryModal } from "@/components/ui/document-history-modal"
import { SendEmailModal } from "@/components/ui/send-email-modal"
import { DevisForm } from "@/components/devis/devis-form"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { useModules } from "@/lib/user-context"
import { BASE_PATH } from "@/lib/env"

type Devis = {
  id:          string
  number:      string
  status:      "BROUILLON" | "ENVOYE" | "ACCEPTE" | "REFUSE" | "EXPIRE"
  issueDate:   string
  validUntil:  string | null
  total:       string
  notes:       string | null
  paymentTerms: string | null
  fournisseurId: string | null
  fournisseur: { id: string; companyName: string; email: string | null; billingEmail: string | null } | null
  facture?:    { id: string; number: string } | null
  items?: { id: string; description: string; quantity: string; unitPrice: string; vatRate: string; discount: string }[]
}

const statusBadge: Record<Devis["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  BROUILLON: { label: "Brouillon", variant: "secondary"   },
  ENVOYE:    { label: "Envoyé",    variant: "outline"     },
  ACCEPTE:   { label: "Accepté",   variant: "default"     },
  REFUSE:    { label: "Refusé",    variant: "destructive" },
  EXPIRE:    { label: "Expiré",    variant: "outline"     },
}

function FilterSelect({
  value, onChange, options, placeholder,
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

function toFormValues(d: Devis): Partial<DevisInput> {
  return {
    fournisseurId: d.fournisseurId ?? "",
    status:        d.status,
    issueDate:     d.issueDate.split("T")[0],
    validUntil:    d.validUntil ? d.validUntil.split("T")[0] : "",
    notes:         d.notes ?? "",
    paymentTerms:  d.paymentTerms ?? "",
    items: d.items?.length ? d.items.map(i => ({
      id:          i.id,
      description: i.description,
      quantity:    Number(i.quantity),
      unitPrice:   Number(i.unitPrice),
      vatRate:     Number(i.vatRate),
      discount:    Number(i.discount),
    })) : undefined,
  }
}

export function DevisView() {
  const router = useRouter()
  const modules = useModules()
  // Seeded from ?search=… so a "Voir tout" link from the Fournisseur detail page (or
  // any other deep link) lands here pre-filtered instead of on the unfiltered list.
  const searchParams = useSearchParams()
  const initialSearch = searchParams.get("search") ?? ""
  // ?fournisseurId=… is how the Fournisseur detail page links to "all devis for this
  // supplier" — filtering by id rather than a `search=companyName` text match, which used
  // to false-positive whenever another supplier's name contained this one's as a substring
  // (e.g. "Dupont" matching "Dupont Fils" too).
  const fournisseurIdParam = searchParams.get("fournisseurId") ?? undefined
  const [page, setPage]                 = useState(1)
  const [searchInput, setSearchInput]   = useState(initialSearch)
  const [search, setSearch]             = useState(initialSearch)
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [createOpen, setCreateOpen]     = useState(false)
  const [editTarget, setEditTarget]     = useState<Devis | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Devis | null>(null)
  const [historyTarget, setHistoryTarget] = useState<Devis | null>(null)
  const [emailTarget, setEmailTarget] = useState<Devis | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function handleSearch(val: string) {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(val); setPage(1) }, 300)
  }

  const { data: result, isLoading } = useDevisPaginated(page, PAGE_SIZE, search || undefined, statusFilter || undefined, fournisseurIdParam)
  const devisList = (result?.data ?? []) as Devis[]

  useEffect(() => {
    if (result && result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages)
  }, [result, page])

  const createMutation  = useCreateDevis()
  const updateMutation  = useUpdateDevis(editTarget?.id ?? "")
  const deleteMutation  = useDeleteDevis()
  const convertMutation = useConvertDevis()
  const duplicateMutation = useDuplicateDevis()
  const sendEmailMutation = useSendDevisEmail(emailTarget?.id ?? "")
  // The list query doesn't include line items (kept light) — the edit form needs them, so
  // fetch the full record by id once a row is targeted for editing.
  const { data: editDetail, isLoading: editDetailLoading } = useDevisDetail(editTarget?.id ?? "")

  async function handleCreate(data: DevisInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success("Devis créé avec succès")
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleUpdate(data: DevisInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success("Devis mis à jour")
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleConvert(d: Devis) {
    try {
      const facture = await convertMutation.mutateAsync(d.id)
      toast.success(`Facture ${facture.number} créée`, {
        action: { label: "Voir", onClick: () => router.push("/dashboard/factures") },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDuplicate(d: Devis) {
    try {
      const copy = await duplicateMutation.mutateAsync(d.id)
      toast.success(`Devis ${copy.number} créé`, {
        action: { label: "Modifier", onClick: () => setEditTarget({ id: copy.id } as Devis) },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleSendEmail(to: string, message: string) {
    if (!emailTarget) return
    try {
      await sendEmailMutation.mutateAsync({ to, message })
      toast.success("Devis envoyé par e-mail")
      setEmailTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDelete(force?: boolean) {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync({ id: deleteTarget.id, force })
      toast.success("Devis supprimé")
      setDeleteTarget(null)
    } catch (err) {
      if (err instanceof ApiError && err.code === "REQUIRES_CONFIRMATION") {
        toast.error(err.message, {
          action: { label: "Confirmer", onClick: () => handleDelete(true) },
        })
        return
      }
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  const columns: Column<Devis>[] = [
    {
      key: "number",
      header: "N°",
      cell: (d) => (
        <div className="space-y-0.5">
          <p className="font-medium tabular-nums">{d.number}</p>
          {d.fournisseur && <p className="text-xs text-muted-foreground">{d.fournisseur.companyName}</p>}
        </div>
      ),
    },
    {
      key: "issueDate",
      header: "Date",
      cell: (d) => format(new Date(d.issueDate), "dd/MM/yyyy", { locale: fr }),
      hideInCard: true,
    },
    {
      key: "total",
      header: "Montant",
      className: "text-right",
      cell: (d) => <span className="tabular-nums font-medium">{Number(d.total).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</span>,
    },
    {
      key: "status",
      header: "Statut",
      cell: (d) => {
        const s = statusBadge[d.status]
        return (
          <div className="flex items-center gap-1.5">
            <Badge variant={s.variant}>{s.label}</Badge>
            {d.facture && <Badge variant="outline">Facturé</Badge>}
          </div>
        )
      },
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      cell: (d) => (
        <RowActions actions={[
          ...(d.status === "ACCEPTE" && !d.facture && modules.factures ? [
            { label: "Convertir en facture", icon: <ArrowRightIcon className="size-3.5" />, onClick: () => handleConvert(d) },
          ] : []),
          { label: "Modifier",  icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => setEditTarget(d), separator: true },
          { label: "Dupliquer", icon: <CopyIcon className="size-3.5" />, onClick: () => handleDuplicate(d) },
          { label: "Télécharger le PDF", icon: <DownloadSimpleIcon className="size-3.5" />, onClick: () => window.open(`${BASE_PATH}/api/devis/${d.id}/pdf`, "_blank") },
          { label: "Envoyer par e-mail", icon: <EnvelopeSimpleIcon className="size-3.5" />, onClick: () => setEmailTarget(d) },
          { label: "Historique", icon: <ClockCounterClockwiseIcon className="size-3.5" />, onClick: () => setHistoryTarget(d) },
          {
            label: d.facture ? "Supprimer (déjà facturé)" : "Supprimer",
            icon: <TrashIcon className="size-3.5" />,
            destructive: true,
            separator: true,
            disabled: !!d.facture,
            onClick: () => setDeleteTarget(d),
          },
        ]} />
      ),
    },
  ]

  const descriptionText = search
    ? `${result?.total ?? 0} résultat${(result?.total ?? 0) !== 1 ? "s" : ""}`
    : `${result?.total ?? 0} devis`

  return (
    <div className="space-y-4">
      <PageHeader
        title="Devis"
        description={descriptionText}
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            Nouveau devis
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <div className="relative w-72">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Rechercher un devis…"
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
            { value: "BROUILLON", label: "Brouillon" },
            { value: "ENVOYE",    label: "Envoyé"    },
            { value: "ACCEPTE",   label: "Accepté"   },
            { value: "REFUSE",    label: "Refusé"    },
            { value: "EXPIRE",    label: "Expiré"    },
          ]}
          placeholder="Tous les statuts"
        />

        {fournisseurIdParam && (
          <button
            type="button"
            onClick={() => router.push("/dashboard/devis")}
            className="flex items-center gap-1.5 rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Fournisseur : {devisList.find(d => d.fournisseurId === fournisseurIdParam)?.fournisseur?.companyName ?? "filtré"}
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={devisList}
        loading={isLoading}
        keyExtractor={(d) => d.id}
        empty={search ? `Aucun résultat pour « ${search} »` : "Aucun devis enregistré"}
        pagination={result ? {
          page:         result.page,
          totalPages:   result.totalPages,
          total:        result.total,
          limit:        result.limit,
          onPageChange: (p) => setPage(p),
        } : undefined}
      />

      <Modal open={createOpen} onOpenChange={setCreateOpen} title="Nouveau devis" size="2xl" dismissable={false}>
        <DevisForm
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
          loading={createMutation.isPending}
        />
      </Modal>

      <Modal open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)} title="Modifier le devis" size="2xl" dismissable={false}>
        {editDetailLoading || !editDetail ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Chargement…</p>
        ) : (
          <div className="space-y-4">
            {(editDetail as Devis).facture && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                <WarningIcon className="mt-0.5 size-4 shrink-0" />
                <p>
                  Ce devis a déjà été converti en facture <strong>{(editDetail as Devis).facture?.number}</strong>.
                  Les articles sont donc figés — seuls le statut, les dates et les notes restent modifiables.
                </p>
              </div>
            )}
            <DevisForm
              key={editDetail.id}
              defaultValues={toFormValues(editDetail as Devis)}
              onSubmit={handleUpdate}
              onCancel={() => setEditTarget(null)}
              loading={updateMutation.isPending}
              itemsLocked={!!(editDetail as Devis).facture}
            />
          </div>
        )}
      </Modal>

      {historyTarget && (
        <DocumentHistoryModal
          entity="Devis"
          entityId={historyTarget.id}
          documentNumber={historyTarget.number}
          open={!!historyTarget}
          onOpenChange={(open) => !open && setHistoryTarget(null)}
        />
      )}

      {emailTarget && (
        <SendEmailModal
          documentLabel={`le devis ${emailTarget.number}`}
          defaultTo={emailTarget.fournisseur?.billingEmail || emailTarget.fournisseur?.email || ""}
          open={!!emailTarget}
          onOpenChange={(open) => !open && setEmailTarget(null)}
          onSend={handleSendEmail}
          loading={sendEmailMutation.isPending}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Supprimer le devis ${deleteTarget?.number} ?`}
        description="Cette action est irréversible."
        confirmLabel="Supprimer"
        loading={deleteMutation.isPending}
        onConfirm={() => handleDelete(false)}
      />
    </div>
  )
}
