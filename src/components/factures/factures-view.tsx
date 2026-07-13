"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { PlusIcon, PencilSimpleIcon, TrashIcon, MagnifyingGlassIcon, XIcon, MoneyIcon, ClockCounterClockwiseIcon, CopyIcon, DownloadSimpleIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { useFacturesPaginated, useFactureDetail, useCreateFacture, useUpdateFacture, useDeleteFacture, useDuplicateFacture, useSendFactureEmail } from "@/hooks/use-factures"
import { ApiError } from "@/lib/api-error"
import type { FactureInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DocumentHistoryModal } from "@/components/ui/document-history-modal"
import { SendEmailModal } from "@/components/ui/send-email-modal"
import { FactureForm } from "@/components/factures/facture-form"
import { FacturePaymentModal } from "@/components/factures/facture-payment-modal"
import { FacturePaymentsModal } from "@/components/factures/facture-payments-modal"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { BASE_PATH } from "@/lib/env"

type FactureStatus = "BROUILLON" | "EN_ATTENTE" | "PARTIELLEMENT_PAYEE" | "PAYEE" | "EN_RETARD" | "ANNULEE"

type Facture = {
  id:            string
  number:        string
  status:        FactureStatus
  issueDate:     string
  dueDate:       string | null
  total:         string
  amountPaid:    string
  notes:         string | null
  paymentTerms:  string | null
  fournisseurId: string | null
  fournisseur:   { id: string; companyName: string; email: string | null; billingEmail: string | null } | null
  devis?:        { id: string; number: string } | null
  items?: { id: string; description: string; quantity: string; unitPrice: string; vatRate: string; discount: string }[]
}

const statusBadge: Record<FactureStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  BROUILLON:           { label: "Brouillon",           variant: "secondary"   },
  EN_ATTENTE:          { label: "En attente",          variant: "outline"     },
  PARTIELLEMENT_PAYEE: { label: "Partiellement payée", variant: "outline"     },
  PAYEE:               { label: "Payée",               variant: "default"    },
  EN_RETARD:           { label: "En retard",           variant: "destructive" },
  ANNULEE:             { label: "Annulée",             variant: "secondary"  },
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
      <SelectTrigger className="w-44">
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
const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

function toFormValues(f: Facture): Partial<FactureInput> {
  return {
    fournisseurId: f.fournisseurId ?? "",
    status:        f.status === "EN_RETARD" ? "EN_ATTENTE" : f.status,
    issueDate:     f.issueDate.split("T")[0],
    dueDate:       f.dueDate ? f.dueDate.split("T")[0] : "",
    notes:         f.notes ?? "",
    paymentTerms:  f.paymentTerms ?? "",
    items: f.items?.length ? f.items.map(i => ({
      id:          i.id,
      description: i.description,
      quantity:    Number(i.quantity),
      unitPrice:   Number(i.unitPrice),
      vatRate:     Number(i.vatRate),
      discount:    Number(i.discount),
    })) : undefined,
  }
}

export function FacturesView() {
  const router = useRouter()
  // Seeded from ?search=… so a "Voir tout" link from the Fournisseur detail page (or
  // any other deep link) lands here pre-filtered instead of on the unfiltered list.
  const searchParams = useSearchParams()
  const initialSearch = searchParams.get("search") ?? ""
  // ?fournisseurId=… is how the Fournisseur detail page links to "all factures for this
  // supplier" — filtering by id rather than a `search=companyName` text match, which used
  // to false-positive whenever another supplier's name contained this one's as a substring
  // (e.g. "Dupont" matching "Dupont Fils" too).
  const fournisseurIdParam = searchParams.get("fournisseurId") ?? undefined
  const [page, setPage]                 = useState(1)
  const [searchInput, setSearchInput]   = useState(initialSearch)
  const [search, setSearch]             = useState(initialSearch)
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [createOpen, setCreateOpen]     = useState(false)
  const [editTarget, setEditTarget]     = useState<Facture | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Facture | null>(null)
  const [paymentTarget, setPaymentTarget] = useState<Facture | null>(null)
  const [paymentsHistoryTarget, setPaymentsHistoryTarget] = useState<Facture | null>(null)
  const [historyTarget, setHistoryTarget] = useState<Facture | null>(null)
  const [emailTarget, setEmailTarget] = useState<Facture | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function handleSearch(val: string) {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(val); setPage(1) }, 300)
  }

  const { data: result, isLoading } = useFacturesPaginated(page, PAGE_SIZE, search || undefined, statusFilter || undefined, fournisseurIdParam)
  const facturesList = (result?.data ?? []) as Facture[]

  useEffect(() => {
    if (result && result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages)
  }, [result, page])

  const createMutation = useCreateFacture()
  const updateMutation = useUpdateFacture(editTarget?.id ?? "")
  const deleteMutation  = useDeleteFacture()
  const duplicateMutation = useDuplicateFacture()
  const sendEmailMutation = useSendFactureEmail(emailTarget?.id ?? "")
  const { data: editDetail, isLoading: editDetailLoading } = useFactureDetail(editTarget?.id ?? "")

  async function handleCreate(data: FactureInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success("Facture créée avec succès")
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleUpdate(data: FactureInput, force?: boolean) {
    try {
      await updateMutation.mutateAsync({ data, force })
      toast.success("Facture mise à jour")
      setEditTarget(null)
    } catch (err) {
      if (err instanceof ApiError && err.code === "REQUIRES_CONFIRMATION") {
        toast.error(err.message, {
          action: { label: "Confirmer", onClick: () => handleUpdate(data, true) },
        })
        return
      }
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDuplicate(f: Facture) {
    try {
      const copy = await duplicateMutation.mutateAsync(f.id)
      toast.success(`Facture ${copy.number} créée`, {
        action: { label: "Modifier", onClick: () => setEditTarget({ id: copy.id } as Facture) },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleSendEmail(to: string, message: string) {
    if (!emailTarget) return
    try {
      await sendEmailMutation.mutateAsync({ to, message })
      toast.success("Facture envoyée par e-mail")
      setEmailTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDelete(force?: boolean) {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync({ id: deleteTarget.id, force })
      toast.success("Facture supprimée")
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

  const columns: Column<Facture>[] = [
    {
      key: "number",
      header: "N°",
      cell: (f) => (
        <div className="space-y-0.5">
          <p className="font-medium tabular-nums">{f.number}</p>
          {f.fournisseur && <p className="text-xs text-muted-foreground">{f.fournisseur.companyName}</p>}
          {f.devis && <p className="text-xs text-muted-foreground">Depuis {f.devis.number}</p>}
        </div>
      ),
    },
    {
      key: "dueDate",
      header: "Échéance",
      cell: (f) => f.dueDate ? format(new Date(f.dueDate), "dd/MM/yyyy", { locale: fr }) : <span className="text-muted-foreground text-xs">—</span>,
      hideInCard: true,
    },
    {
      key: "total",
      header: "Montant",
      className: "text-right",
      cell: (f) => {
        const remaining = Number(f.total) - Number(f.amountPaid)
        return (
          <div className="text-right">
            <p className="tabular-nums font-medium">{fmt(Number(f.total))}</p>
            {remaining > 0 && Number(f.amountPaid) > 0 && (
              <p className="text-xs text-muted-foreground tabular-nums">Reste {fmt(remaining)}</p>
            )}
          </div>
        )
      },
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
          ...(f.status !== "BROUILLON" && f.status !== "PAYEE" && f.status !== "ANNULEE" ? [
            { label: "Enregistrer un paiement", icon: <MoneyIcon className="size-3.5" />, onClick: () => setPaymentTarget(f) },
          ] : []),
          ...(Number(f.amountPaid) > 0 ? [
            { label: "Historique des paiements", icon: <ClockCounterClockwiseIcon className="size-3.5" />, onClick: () => setPaymentsHistoryTarget(f) },
          ] : []),
          { label: "Modifier",  icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => setEditTarget(f), separator: true },
          { label: "Dupliquer", icon: <CopyIcon className="size-3.5" />, onClick: () => handleDuplicate(f) },
          { label: "Télécharger le PDF", icon: <DownloadSimpleIcon className="size-3.5" />, onClick: () => window.open(`${BASE_PATH}/api/factures/${f.id}/pdf`, "_blank") },
          { label: "Envoyer par e-mail", icon: <EnvelopeSimpleIcon className="size-3.5" />, onClick: () => setEmailTarget(f) },
          { label: "Historique", icon: <ClockCounterClockwiseIcon className="size-3.5" />, onClick: () => setHistoryTarget(f) },
          { label: "Supprimer", icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(f) },
        ]} />
      ),
    },
  ]

  const descriptionText = search
    ? `${result?.total ?? 0} résultat${(result?.total ?? 0) !== 1 ? "s" : ""}`
    : `${result?.total ?? 0} facture${(result?.total ?? 0) !== 1 ? "s" : ""}`

  return (
    <div className="space-y-4">
      <PageHeader
        title="Factures"
        description={descriptionText}
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            Nouvelle facture
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <div className="relative w-72">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Rechercher une facture…"
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
            { value: "BROUILLON",           label: "Brouillon"           },
            { value: "EN_ATTENTE",          label: "En attente"          },
            { value: "PARTIELLEMENT_PAYEE", label: "Partiellement payée" },
            { value: "PAYEE",               label: "Payée"               },
            { value: "EN_RETARD",           label: "En retard"           },
            { value: "ANNULEE",             label: "Annulée"             },
          ]}
          placeholder="Tous les statuts"
        />

        {fournisseurIdParam && (
          <button
            type="button"
            onClick={() => router.push("/dashboard/factures")}
            className="flex items-center gap-1.5 rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Fournisseur : {facturesList.find(f => f.fournisseurId === fournisseurIdParam)?.fournisseur?.companyName ?? "filtré"}
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={facturesList}
        loading={isLoading}
        keyExtractor={(f) => f.id}
        empty={search ? `Aucun résultat pour « ${search} »` : "Aucune facture enregistrée"}
        pagination={result ? {
          page:         result.page,
          totalPages:   result.totalPages,
          total:        result.total,
          limit:        result.limit,
          onPageChange: (p) => setPage(p),
        } : undefined}
      />

      <Modal open={createOpen} onOpenChange={setCreateOpen} title="Nouvelle facture" size="2xl" dismissable={false}>
        <FactureForm
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
          loading={createMutation.isPending}
        />
      </Modal>

      <Modal open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)} title="Modifier la facture" size="2xl" dismissable={false}>
        {editDetailLoading || !editDetail ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Chargement…</p>
        ) : (
          <FactureForm
            key={editDetail.id}
            defaultValues={toFormValues(editDetail as Facture)}
            onSubmit={handleUpdate}
            onCancel={() => setEditTarget(null)}
            loading={updateMutation.isPending}
            lockedFromDevis={!!(editDetail as Facture & { devisId?: string }).devisId}
            amountPaid={Number((editDetail as Facture).amountPaid)}
          />
        )}
      </Modal>

      {paymentTarget && (
        <FacturePaymentModal
          factureId={paymentTarget.id}
          remaining={Number(paymentTarget.total) - Number(paymentTarget.amountPaid)}
          open={!!paymentTarget}
          onOpenChange={(open) => !open && setPaymentTarget(null)}
        />
      )}

      {paymentsHistoryTarget && (
        <FacturePaymentsModal
          factureId={paymentsHistoryTarget.id}
          open={!!paymentsHistoryTarget}
          onOpenChange={(open) => !open && setPaymentsHistoryTarget(null)}
        />
      )}

      {historyTarget && (
        <DocumentHistoryModal
          entity="Facture"
          entityId={historyTarget.id}
          documentNumber={historyTarget.number}
          open={!!historyTarget}
          onOpenChange={(open) => !open && setHistoryTarget(null)}
        />
      )}

      {emailTarget && (
        <SendEmailModal
          documentLabel={`la facture ${emailTarget.number}`}
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
        title={`Supprimer la facture ${deleteTarget?.number} ?`}
        description="Cette action est irréversible."
        confirmLabel="Supprimer"
        loading={deleteMutation.isPending}
        onConfirm={() => handleDelete(false)}
      />
    </div>
  )
}
