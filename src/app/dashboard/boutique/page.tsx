"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import {
  PlusIcon, ShoppingBagIcon, PackageIcon, ShoppingCartIcon,
  EyeIcon, ArchiveIcon, FileEditIcon,
} from "lucide-react"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
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

  const { data: produits = [], isLoading: loadingProduits } = useQuery<Produit[]>({
    queryKey: ["boutique-produits"],
    queryFn:  () => fetch("/api/boutique/produits").then(r => r.json()),
  })

  const commandeParams = new URLSearchParams({ limit: "50", ...(statusFilter !== "ALL" ? { status: statusFilter } : {}) })
  const { data: commandeResult, isLoading: loadingCommandes } = useQuery<{ data: Commande[]; total: number }>({
    queryKey: ["boutique-commandes", statusFilter],
    queryFn:  () => fetch(`/api/boutique/commandes?${commandeParams}`).then(r => r.json()),
    enabled:  tab === "commandes",
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/boutique/produits/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["boutique-produits"] }); toast.success("Produit supprimé") },
    onError:    () => toast.error("Erreur lors de la suppression"),
  })

  const updateCommandeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      fetch(`/api/boutique/commandes/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status }),
      }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["boutique-commandes"] }); toast.success("Commande mise à jour") },
    onError:   () => toast.error("Erreur"),
  })

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
            { label: "Modifier",   icon: <FileEditIcon className="size-3.5" />, onClick: () => router.push(`/dashboard/boutique/${p.id}`) },
            { label: "Supprimer",  icon: <ArchiveIcon  className="size-3.5" />, onClick: () => setDeleteTarget(p), destructive: true, separator: true },
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
            { label: "Marquer payée", icon: <EyeIcon className="size-3.5" />, onClick: () => updateCommandeStatus.mutate({ id: c.id, status: "PAID" }) },
            { label: "Annuler",       icon: <ArchiveIcon className="size-3.5" />, onClick: () => updateCommandeStatus.mutate({ id: c.id, status: "CANCELLED" }), destructive: true, separator: true },
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
