"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  PackageIcon, MapPinIcon, ClockIcon, CheckCircle2Icon,
  XCircleIcon, PlusIcon, SearchIcon, PencilIcon, Trash2Icon,
} from "lucide-react"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { Portal } from "@/components/ui/portal"
import { cn } from "@/lib/utils"

type CatalogItem = {
  id:           string
  name:         string
  category:     string | null
  description:  string | null
  location:     string | null
  quantity:     number
  status:       string
  availableQty: number
}

type MyLoan = {
  id:               string
  materialId:       string
  quantity:         number
  status:           "DEMANDE" | "CONFIRME" | "REFUSE" // Fix 1: include REFUSE
  borrowedAt:       string
  expectedReturnAt: string | null
  notes:            string | null
  material:         { id: string; name: string; category: string | null }
}

type PortalMaterielData = {
  catalog: CatalogItem[]
  myLoans: MyLoan[]
}

// ─── Loan request modal ───────────────────────────────────────────────────────

function RequestModal({
  item,
  onClose,
  onSubmit,
  loading,
  initialValues,
}: {
  item:          CatalogItem
  onClose:       () => void
  onSubmit:      (data: { quantity: number; expectedReturnAt: string; notes: string }) => void
  loading:       boolean
  initialValues?: { quantity: number; expectedReturnAt: string; notes: string }
}) {
  const [quantity,         setQuantity]         = useState(initialValues?.quantity         ?? 1)
  const [expectedReturnAt, setExpectedReturnAt] = useState(initialValues?.expectedReturnAt ?? "")
  const [notes,            setNotes]            = useState(initialValues?.notes            ?? "")

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const minDate = tomorrow.toISOString().split("T")[0]

  return (
    // Fix 8: backdrop click closes the modal
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-2xl border shadow-xl w-full max-w-md space-y-5 p-5 animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-250"
        style={{ animationFillMode: "both" }}
        onClick={e => e.stopPropagation()}
      >
        <div>
          <p className="font-semibold">{item.name}</p>
          {item.category && <p className="text-xs text-muted-foreground mt-0.5">{item.category}</p>}
        </div>

        <div className="space-y-4">
          {/* Fix 5: only show stepper when availableQty > 1 */}
          {item.availableQty > 1 && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Quantité</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  className="size-8 rounded-lg border flex items-center justify-center text-lg leading-none hover:bg-muted transition-colors"
                >
                  −
                </button>
                <span className="w-8 text-center font-medium tabular-nums">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity(q => Math.min(item.availableQty, q + 1))}
                  className="size-8 rounded-lg border flex items-center justify-center text-lg leading-none hover:bg-muted transition-colors"
                >
                  +
                </button>
                <span className="text-xs text-muted-foreground ml-1">/ {item.availableQty} disponibles</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Date de retour prévue <span className="text-muted-foreground font-normal">(optionnel)</span>
            </label>
            <input
              type="date"
              min={minDate}
              value={expectedReturnAt}
              onChange={e => setExpectedReturnAt(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Note <span className="text-muted-foreground font-normal">(optionnel)</span>
            </label>
            <textarea
              rows={2}
              maxLength={500}
              placeholder="Précisions sur l'utilisation…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex gap-2">
          {/* Fix 8: cancel is always enabled (never blocked by loading) */}
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Annuler
          </Button>
          <Button
            className="flex-1"
            disabled={loading}
            onClick={() => onSubmit({ quantity, expectedReturnAt, notes })}
          >
            {loading ? "Envoi…" : "Envoyer la demande"}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function LoanStatusBadge({ status }: { status: "DEMANDE" | "CONFIRME" }) {
  if (status === "CONFIRME") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <CheckCircle2Icon className="size-3" /> Confirmé
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
      <ClockIcon className="size-3" /> En attente
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MaterielPage() {
  const qc = useQueryClient()
  const [search,      setSearch]      = useState("")
  const [requesting,  setRequesting]  = useState<CatalogItem | null>(null)
  const [editingLoan, setEditingLoan] = useState<MyLoan | null>(null)
  const [cancelingId, setCancelingId] = useState<string | null>(null)

  const { data, isLoading } = useQuery<PortalMaterielData>({
    queryKey: ["portal-materiel"],
    queryFn:  () => fetch("/api/portal/materiel").then(r => r.json()),
    staleTime: 0,
  })

  const requestMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: object }) => {
      const r = await fetch(`/api/portal/materiel/${id}/demande`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      })
      const json = await r.json()
      if (!r.ok) throw new Error(json.error ?? "Erreur")
      return json
    },
    onSuccess: () => {
      toast.success("Demande envoyée — l'administrateur vous confirmera l'emprunt")
      qc.invalidateQueries({ queryKey: ["portal-materiel"] })
      qc.invalidateQueries({ queryKey: ["materiel"] })
      setRequesting(null)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  const editMutation = useMutation({
    mutationFn: async ({ loanId, body }: { loanId: string; body: object }) => {
      const r = await fetch(`/api/portal/materiel/loans/${loanId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      })
      const json = await r.json()
      if (!r.ok) throw new Error(json.error ?? "Erreur")
      return json
    },
    onSuccess: () => {
      toast.success("Demande mise à jour")
      qc.invalidateQueries({ queryKey: ["portal-materiel"] })
      qc.invalidateQueries({ queryKey: ["materiel"] })
      setEditingLoan(null)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  const cancelMutation = useMutation({
    mutationFn: async (loanId: string) => {
      const r = await fetch(`/api/portal/materiel/loans/${loanId}`, { method: "DELETE" })
      const json = await r.json()
      if (!r.ok) throw new Error(json.error ?? "Erreur")
      return json
    },
    onSuccess: () => {
      toast.success("Demande annulée")
      qc.invalidateQueries({ queryKey: ["portal-materiel"] })
      qc.invalidateQueries({ queryKey: ["materiel"] })
      setCancelingId(null)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  const myLoans = data?.myLoans ?? []

  // Fix 1: separate active loans from refused ones
  const myActiveLoans  = myLoans.filter(l => l.status === "DEMANDE" || l.status === "CONFIRME")
  const myRefusedLoans = myLoans.filter(l => l.status === "REFUSE")

  // Only block re-requesting for active (DEMANDE/CONFIRME) loans, not refused
  const myLoanedIds = new Set(myActiveLoans.map(l => l.materialId))

  const catalog = (data?.catalog ?? []).filter(item => {
    const q = search.toLowerCase()
    return !q || item.name.toLowerCase().includes(q) || item.category?.toLowerCase().includes(q)
  })

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-7 w-36 rounded bg-muted" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[0,1,2,3].map(i => <div key={i} className="h-24 rounded-xl bg-muted" />)}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Matériel</h1>
          <p className="text-muted-foreground text-sm mt-1">Consultez le catalogue et faites une demande d&apos;emprunt.</p>
        </div>

        {/* Fix 1: show refused loans so member knows what happened */}
        {myRefusedLoans.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-destructive/80">Demandes non accordées</h2>
            <div className="space-y-2">
              {myRefusedLoans.map(loan => (
                <div key={loan.id} className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{loan.material.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Votre demande du {format(new Date(loan.borrowedAt), "d MMM yyyy", { locale: fr })} n&apos;a pas pu être accordée.
                    </p>
                  </div>
                  <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                    <XCircleIcon className="size-3" /> Refusé
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* My active loans */}
        {myActiveLoans.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Mes emprunts en cours</h2>
            <div className="space-y-2">
              {myActiveLoans.map(loan => (
                <div key={loan.id} className="rounded-xl border bg-card px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{loan.material.name}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                      {loan.quantity > 1 && (
                        <span className="text-xs text-muted-foreground">×{loan.quantity}</span>
                      )}
                      {loan.expectedReturnAt && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <ClockIcon className="size-3" />
                          Retour prévu le {format(new Date(loan.expectedReturnAt), "d MMM yyyy", { locale: fr })}
                        </span>
                      )}
                      {loan.notes && (
                        <span className="text-xs text-muted-foreground italic truncate">{loan.notes}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <LoanStatusBadge status={loan.status as "DEMANDE" | "CONFIRME"} />
                    {loan.status === "DEMANDE" && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditingLoan(loan)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title="Modifier"
                        >
                          <PencilIcon className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setCancelingId(loan.id)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Annuler la demande"
                        >
                          <Trash2Icon className="size-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Catalog */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Catalogue</h2>
            <div className="relative">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Rechercher…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 w-44 rounded-lg border border-input bg-background text-sm px-3 outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {catalog.length === 0 ? (
            <div className="py-12 text-center">
              <PackageIcon className="size-10 mx-auto text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">
                {search ? "Aucun article correspond à votre recherche." : "Aucun article disponible pour le moment."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {catalog.map(item => {
                const alreadyLoaned = myLoanedIds.has(item.id)
                const noStock       = item.availableQty === 0
                const unavailable   = item.status !== "DISPONIBLE"

                return (
                  <div
                    key={item.id}
                    className={cn(
                      "rounded-xl border bg-card p-4 space-y-2.5",
                      (noStock || unavailable) && "opacity-60",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{item.name}</p>
                        {item.category && <p className="text-xs text-muted-foreground truncate">{item.category}</p>}
                      </div>
                      <span className={cn(
                        "shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full",
                        item.availableQty > 0
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-muted text-muted-foreground",
                      )}>
                        {item.availableQty}/{item.quantity} dispo.
                      </span>
                    </div>

                    {item.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                    )}

                    {item.location && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPinIcon className="size-3 shrink-0" /> {item.location}
                      </p>
                    )}

                    {alreadyLoaned ? (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CheckCircle2Icon className="size-3.5 text-green-500" />
                        Demande en cours
                      </div>
                    ) : noStock || unavailable ? (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <XCircleIcon className="size-3.5" />
                        {unavailable ? "Article indisponible" : "Stock épuisé"}
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-8 text-xs"
                        onClick={() => setRequesting(item)}
                      >
                        <PlusIcon className="size-3.5 mr-1" />
                        Demander un emprunt
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {requesting && (
        <Portal>
          <RequestModal
            item={requesting}
            onClose={() => setRequesting(null)}
            loading={requestMutation.isPending}
            onSubmit={(body) => requestMutation.mutate({ id: requesting.id, body })}
          />
        </Portal>
      )}

      {editingLoan && (
        <Portal>
        <RequestModal
          key={editingLoan.id}
          item={{
            id:           editingLoan.materialId,
            name:         editingLoan.material.name,
            category:     editingLoan.material.category,
            description:  null,
            location:     null,
            quantity:     editingLoan.quantity,
            status:       "DISPONIBLE",
            availableQty: editingLoan.quantity,
          }}
          initialValues={{
            quantity:         editingLoan.quantity,
            expectedReturnAt: editingLoan.expectedReturnAt ? editingLoan.expectedReturnAt.slice(0, 10) : "",
            notes:            editingLoan.notes ?? "",
          }}
          onClose={() => setEditingLoan(null)}
          loading={editMutation.isPending}
          onSubmit={(body) => editMutation.mutate({ loanId: editingLoan.id, body })}
        />
        </Portal>
      )}

      {cancelingId && (
        <Portal>
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setCancelingId(null)}
        >
          <div
            className="bg-background rounded-2xl border shadow-xl w-full max-w-sm p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div>
              <p className="font-semibold">Annuler la demande ?</p>
              <p className="text-sm text-muted-foreground mt-1">Cette action est irréversible.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setCancelingId(null)}>
                Retour
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate(cancelingId)}
              >
                {cancelMutation.isPending ? "Annulation…" : "Confirmer"}
              </Button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </>
  )
}
