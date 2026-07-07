"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { PlusIcon, ShoppingBagIcon, PackageIcon, ShoppingCartIcon, EyeIcon, ArchiveIcon, NotePencilIcon, MoneyIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Modal } from "@/components/ui/modal"
import { DataTable, type Column } from "@/components/ui/data-table"
import { cn } from "@/lib/utils"

type Variante = { id: string; label: string; price: number; stock: number }
type Produit = {
  id:          string
  name:        string
  description: string | null
  imageUrl:    string | null
  status:      "DRAFT" | "ACTIVE" | "ARCHIVED"
  createdAt:   string
  variantes:   Variante[]
  _count:      { commandeItems: number }
}

type CommandeItem = {
  id:        string
  quantity:  number
  unitPrice: number
  produit:   { name: string }
  variante:  { label: string }
}

type Commande = {
  id:            string
  status:        "PENDING" | "PAID" | "CANCELLED"
  paymentMethod: "STRIPE" | "MANUAL"
  totalAmount:   number
  note:          string | null
  createdAt:     string
  membre:        { firstName: string; lastName: string; email: string } | null
  items:         CommandeItem[]
}

type EditableItem = { id: string; qty: number; originalQty: number; unitPrice: number; produitName: string; varianteLabel: string }

const STATUS_PRODUIT_LABEL  = { DRAFT: "Brouillon", ACTIVE: "En ligne", ARCHIVED: "Archivé" }
const STATUS_PRODUIT_VARIANT: Record<string, "secondary" | "default" | "outline"> = {
  DRAFT:    "secondary",
  ACTIVE:   "default",
  ARCHIVED: "outline",
}
const STATUS_COMMANDE_LABEL   = { PENDING: "En attente", PAID: "Payée", CANCELLED: "Annulée" }
const STATUS_COMMANDE_VARIANT: Record<string, "secondary" | "default" | "outline" | "destructive"> = {
  PENDING:   "secondary",
  PAID:      "default",
  CANCELLED: "destructive",
}

type Tab = "produits" | "commandes"

export default function BoutiquePage() {
  const router   = useRouter()
  const qc       = useQueryClient()
  const [tab, setTab]               = useState<Tab>("produits")
  const [deleteTarget, setDeleteTarget] = useState<Produit | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>("ALL")
  const [payTarget, setPayTarget]         = useState<Commande | null>(null)
  const [editItems, setEditItems]         = useState<EditableItem[]>([])
  const [cancelTarget, setCancelTarget]   = useState<Commande | null>(null)
  const [stripePayTarget, setStripePayTarget] = useState<Commande | null>(null)

  const { data: produits = [], isLoading: loadingProduits } = useQuery<Produit[]>({
    queryKey:  ["boutique-produits"],
    queryFn:   () => fetch("/api/boutique/produits").then(r => r.json()),
    staleTime: 0,
  })

  const commandeParams = new URLSearchParams({ limit: "50", ...(statusFilter !== "ALL" ? { status: statusFilter } : {}) })
  const { data: commandeResult, isLoading: loadingCommandes } = useQuery<{ data: Commande[]; total: number }>({
    queryKey:  ["boutique-commandes", statusFilter],
    queryFn:   () => fetch(`/api/boutique/commandes?${commandeParams}`).then(r => r.json()),
    enabled:   tab === "commandes",
    staleTime: 0,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/boutique/produits/${id}`, { method: "DELETE" }).then(async r => {
      if (!r.ok) throw new Error((await r.json()).error ?? "Erreur")
      return r.json()
    }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["boutique-produits"] }); toast.success("Produit supprimé") },
    onError:    (err) => toast.error(err instanceof Error ? err.message : "Erreur lors de la suppression"),
  })

  const updateCommandeStatus = useMutation({
    mutationFn: ({ id, status, items }: { id: string; status: string; items?: { id: string; quantity: number }[] }) =>
      fetch(`/api/boutique/commandes/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status, ...(items ? { items } : {}) }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Erreur")
        return r.json()
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["boutique-commandes"] }); toast.success("Commande mise à jour") },
    onError:   (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  })

  function openPayModal(c: Commande) {
    if (c.paymentMethod === "STRIPE") {
      setStripePayTarget(c)
      return
    }
    setEditItems(c.items.map(i => ({
      id:            i.id,
      qty:           i.quantity,
      originalQty:   i.quantity,
      unitPrice:     i.unitPrice,
      produitName:   i.produit.name,
      varianteLabel: i.variante.label,
    })))
    setPayTarget(c)
  }

  function adjustQty(itemId: string, delta: number) {
    setEditItems(prev => prev.map(i =>
      i.id === itemId
        ? { ...i, qty: Math.min(i.originalQty, Math.max(0, i.qty + delta)) }
        : i,
    ))
  }

  async function handleEncaisser() {
    if (!payTarget) return
    try {
      await updateCommandeStatus.mutateAsync({
        id:     payTarget.id,
        status: "PAID",
        items:  editItems.map(i => ({ id: i.id, quantity: i.qty })),
      })
      setPayTarget(null)
    } catch {
      // onError already shows toast; keep modal open so user can retry
    }
  }

  const produitColumns: Column<Produit>[] = [
    {
      key:    "produit",
      header: "Produit",
      cell: (p) => (
        <div className="flex items-center gap-3">
          {p.imageUrl
            ? <img src={p.imageUrl} alt="" className="size-10 rounded-lg object-cover shrink-0 bg-muted" />
            : <div className="size-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <ShoppingBagIcon className="size-4 text-muted-foreground" />
              </div>
          }
          <div>
            <p className="font-medium">{p.name}</p>
            <p className="text-xs text-muted-foreground">{p.variantes.length} variante{p.variantes.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
      ),
    },
    {
      key:    "status",
      header: "Statut",
      cell: (p) => (
        <Badge variant={STATUS_PRODUIT_VARIANT[p.status]}>
          {STATUS_PRODUIT_LABEL[p.status]}
        </Badge>
      ),
    },
    {
      key:    "stock",
      header: "Stock",
      cell: (p) => {
        const total = p.variantes.reduce((s, v) => s + v.stock, 0)
        return <span className={cn("text-sm tabular-nums", total === 0 ? "text-destructive" : "")}>{total}</span>
      },
    },
    {
      key:    "prix",
      header: "Prix",
      cell: (p) => {
        const prices = p.variantes.map(v => v.price)
        const min    = Math.min(...prices)
        const max    = Math.max(...prices)
        const fmt    = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
        return (
          <span className="text-sm tabular-nums">
            {min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`}
          </span>
        )
      },
    },
    {
      key:    "ventes",
      header: "Ventes",
      className: "text-right",
      cell: (p) => <span className="text-sm tabular-nums">{p._count.commandeItems}</span>,
    },
    {
      key:    "actions",
      header: "",
      className: "w-10",
      cell: (p) => (
        <RowActions
          actions={[
            { label: "Modifier",   icon: <NotePencilIcon className="size-3.5" />, onClick: () => router.push(`/dashboard/boutique/${p.id}`) },
            {
              label:       p._count.commandeItems > 0 ? "Supprimer (déjà commandé)" : "Supprimer",
              icon:        <ArchiveIcon className="size-3.5" />,
              onClick:     () => setDeleteTarget(p),
              destructive: true,
              separator:   true,
              disabled:    p._count.commandeItems > 0,
            },
          ]}
        />
      ),
    },
  ]

  const commandeColumns: Column<Commande>[] = [
    {
      key:    "membre",
      header: "Membre",
      cell: (c) => c.membre
        ? <div><p className="font-medium">{c.membre.firstName} {c.membre.lastName}</p><p className="text-xs text-muted-foreground">{c.membre.email}</p></div>
        : <span className="text-muted-foreground italic">Invité</span>,
    },
    {
      key:    "items",
      header: "Articles",
      cell: (c) => (
        <div className="text-sm space-y-0.5">
          {c.items.slice(0, 2).map((item, i) => (
            <p key={i} className="text-muted-foreground">
              {item.quantity}× {item.produit.name} – {item.variante.label}
            </p>
          ))}
          {c.items.length > 2 && <p className="text-muted-foreground">+{c.items.length - 2} autre{c.items.length - 2 > 1 ? "s" : ""}</p>}
        </div>
      ),
    },
    {
      key:    "total",
      header: "Total",
      className: "w-24",
      cell: (c) => (
        <span className="font-semibold tabular-nums">
          {(c.totalAmount / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
        </span>
      ),
    },
    {
      key:    "paiement",
      header: "Paiement",
      className: "w-24",
      cell: (c) => (
        <span className="text-xs text-muted-foreground">{c.paymentMethod === "STRIPE" ? "Stripe" : "Manuel"}</span>
      ),
    },
    {
      key:    "status",
      header: "Statut",
      className: "w-32",
      cell: (c) => (
        <Badge variant={STATUS_COMMANDE_VARIANT[c.status] as "secondary" | "default" | "outline" | "destructive"}>
          {STATUS_COMMANDE_LABEL[c.status]}
        </Badge>
      ),
    },
    {
      key:    "date",
      header: "Date",
      className: "w-28",
      cell: (c) => format(new Date(c.createdAt), "dd/MM/yyyy", { locale: fr }),
    },
    {
      key:    "actions",
      header: "",
      className: "w-10",
      cell: (c) => c.status === "PENDING" ? (
        <RowActions
          actions={[
            { label: "Marquer payée", icon: <EyeIcon className="size-3.5" />,    onClick: () => openPayModal(c) },
            { label: "Annuler",       icon: <ArchiveIcon className="size-3.5" />, onClick: () => setCancelTarget(c), destructive: true, separator: true },
          ]}
        />
      ) : null,
    },
  ]

  const commandes = commandeResult?.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Boutique"
        description="Gérez vos produits et commandes."
        action={tab === "produits" ? (
          <Button onClick={() => router.push("/dashboard/boutique/nouveau")}>
            <PlusIcon className="mr-1.5 size-4" />
            Nouveau produit
          </Button>
        ) : undefined}
      />

      {/* Tabs */}
      <div className="inline-flex rounded-lg border bg-muted/30 p-0.5 gap-0.5">
        {([
          { key: "produits",  label: "Produits",   icon: PackageIcon     },
          { key: "commandes", label: "Commandes",  icon: ShoppingCartIcon },
        ] as const).map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-all",
              tab === t.key
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "produits" && (
        <DataTable
          columns={produitColumns}
          data={produits}
          loading={loadingProduits}
          keyExtractor={(p) => p.id}
          empty="Aucun produit"
        />
      )}

      {tab === "commandes" && (
        <>
          <div className="flex gap-2">
            {(["ALL", "PENDING", "PAID", "CANCELLED"] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  statusFilter === s
                    ? "bg-foreground text-background border-foreground"
                    : "text-muted-foreground hover:text-foreground hover:border-foreground/40",
                )}
              >
                {s === "ALL" ? "Toutes" : STATUS_COMMANDE_LABEL[s]}
              </button>
            ))}
          </div>
          <DataTable
            columns={commandeColumns}
            data={commandes}
            loading={loadingCommandes}
            keyExtractor={(c) => c.id}
            empty="Aucune commande"
          />
        </>
      )}

      {/* Payment adjustment modal */}
      {(() => {
        const adjustedTotal  = editItems.reduce((s, i) => s + i.unitPrice * i.qty, 0)
        const originalTotal  = payTarget?.totalAmount ?? 0
        const hasAdjustment  = adjustedTotal !== originalTotal
        const hasZeroItems   = editItems.some(i => i.qty === 0)
        const fmt = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
        return (
          <Modal
            open={!!payTarget}
            onOpenChange={o => { if (!o) setPayTarget(null) }}
            title="Encaisser la commande"
            size="sm"
            footer={
              <>
                <Button variant="outline" onClick={() => setPayTarget(null)}>Annuler</Button>
                <Button
                  loading={updateCommandeStatus.isPending}
                  disabled={adjustedTotal === 0}
                  onClick={handleEncaisser}
                >
                  <MoneyIcon className="mr-1.5 size-4" />
                  Encaisser {fmt(adjustedTotal)}
                </Button>
              </>
            }
          >
            {payTarget && (
              <div className="space-y-4 py-1">
                {payTarget.membre && (
                  <p className="text-sm text-muted-foreground">
                    Commande de{" "}
                    <span className="font-medium text-foreground">
                      {payTarget.membre.firstName} {payTarget.membre.lastName}
                    </span>
                  </p>
                )}
                <div className="space-y-3">
                  {editItems.map(item => {
                    const notCollected = item.qty === 0
                    return (
                      <div key={item.id} className={cn("flex items-center gap-3", notCollected && "opacity-50")}>
                        <div className="flex-1 min-w-0">
                          <p className={cn("text-sm font-medium truncate", notCollected && "line-through")}>{item.produitName}</p>
                          <p className="text-xs text-muted-foreground">{item.varianteLabel}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => adjustQty(item.id, -1)}
                            disabled={item.qty <= 0}
                            className="size-7 rounded-full border flex items-center justify-center text-base font-medium hover:bg-muted transition-colors disabled:opacity-30"
                          >
                            −
                          </button>
                          <span className="w-6 text-center text-sm font-semibold tabular-nums">{item.qty}</span>
                          <button
                            type="button"
                            onClick={() => adjustQty(item.id, +1)}
                            disabled={item.qty >= item.originalQty}
                            className="size-7 rounded-full border flex items-center justify-center text-base font-medium hover:bg-muted transition-colors disabled:opacity-30"
                          >
                            +
                          </button>
                          <span className={cn("w-20 text-right text-sm tabular-nums", notCollected ? "text-muted-foreground/50 line-through" : "text-muted-foreground")}>
                            {fmt(item.unitPrice * item.qty)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {(hasAdjustment || hasZeroItems) && (
                  <div className="border-t pt-3 space-y-1.5">
                    {hasAdjustment && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Total commandé</span>
                        <span className="line-through">{fmt(originalTotal)}</span>
                      </div>
                    )}
                    {hasZeroItems && (
                      <p className="text-xs text-muted-foreground">
                        Le stock des articles non retiré{editItems.filter(i => i.qty === 0).length > 1 ? "s" : ""} sera restauré.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </Modal>
        )
      })()}

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={o => { if (!o) setCancelTarget(null) }}
        title="Annuler la commande ?"
        description={
          cancelTarget?.membre
            ? `Annuler la commande de ${cancelTarget.membre.firstName} ${cancelTarget.membre.lastName} ? Le stock des articles sera restauré. Cette action est irréversible.`
            : "Annuler cette commande ? Le stock des articles sera restauré. Cette action est irréversible."
        }
        confirmLabel="Annuler la commande"
        loading={updateCommandeStatus.isPending}
        onConfirm={() => {
          if (cancelTarget) updateCommandeStatus.mutate({ id: cancelTarget.id, status: "CANCELLED" })
          setCancelTarget(null)
        }}
      />

      <ConfirmDialog
        open={!!stripePayTarget}
        onOpenChange={o => { if (!o) setStripePayTarget(null) }}
        title="Marquer comme payée ?"
        description={`Cette commande Stripe (${stripePayTarget ? (stripePayTarget.totalAmount / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : ""}) sera marquée comme payée manuellement. À utiliser uniquement si le paiement Stripe a bien été reçu mais le webhook n'a pas déclenché.`}
        confirmLabel="Confirmer le paiement"
        loading={updateCommandeStatus.isPending}
        onConfirm={() => {
          if (stripePayTarget) updateCommandeStatus.mutate({ id: stripePayTarget.id, status: "PAID" })
          setStripePayTarget(null)
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}
        title="Supprimer le produit"
        description={`Supprimer "${deleteTarget?.name}" ? Cette action est irréversible.`}
        confirmLabel="Supprimer"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}
