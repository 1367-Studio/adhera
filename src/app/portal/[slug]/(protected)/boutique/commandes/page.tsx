"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { ArrowLeftIcon, ShoppingBagIcon, PackageIcon, PencilIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { apiErrorMessage } from "@/lib/api-error"
import { cn } from "@/lib/utils"

type CommandeItem = {
  id:        string
  quantity:  number
  unitPrice: number
  produit:   { name: string; imageUrl: string | null }
  variante:  { label: string }
}
type Commande = {
  id:            string
  status:        "PENDING" | "PAID" | "CANCELLED"
  paymentMethod: "STRIPE" | "MANUAL"
  totalAmount:   number
  note:          string | null
  createdAt:     string
  items:         CommandeItem[]
}
type EditItem = { id: string; produitName: string; varianteLabel: string; unitPrice: number; qty: number; originalQty: number }

const STATUS_LABEL: Record<string, string>   = { PENDING: "En attente", PAID: "Payée", CANCELLED: "Annulée" }
const STATUS_VARIANT: Record<string, "secondary" | "default" | "destructive"> = {
  PENDING:   "secondary",
  PAID:      "default",
  CANCELLED: "destructive",
}

export default function MesCommandesPage() {
  const { slug }       = useParams<{ slug: string }>()
  const router         = useRouter()
  const searchParams   = useSearchParams()
  const qc             = useQueryClient()
  const fmt            = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  const [editTarget, setEditTarget]     = useState<Commande | null>(null)
  const [editItems, setEditItems]       = useState<EditItem[]>([])
  const [cancelTarget, setCancelTarget] = useState<Commande | null>(null)

  useEffect(() => {
    if (searchParams.get("payment") === "success") {
      toast.success("Paiement confirmé ! Votre commande est enregistrée.")
      router.replace(`/portal/${slug}/boutique/commandes`)
    }
  }, [searchParams, router, slug])

  const { data: commandes = [], isLoading } = useQuery<Commande[]>({
    queryKey: ["portal-boutique-commandes", slug],
    queryFn:  () => fetch("/api/portal/boutique/commandes").then(r => r.json()),
    staleTime: 0,
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const res = await fetch(`/api/portal/boutique/commandes/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
      return res.json()
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["portal-boutique-commandes", slug] }),
  })

  function openEditModal(c: Commande) {
    setEditTarget(c)
    setEditItems(c.items.map(i => ({
      id:            i.id,
      produitName:   i.produit.name,
      varianteLabel: i.variante.label,
      unitPrice:     i.unitPrice,
      qty:           i.quantity,
      originalQty:   i.quantity,
    })))
  }

  function adjustQty(itemId: string, delta: number) {
    setEditItems(items => items.map(i =>
      i.id === itemId ? { ...i, qty: Math.min(i.originalQty, Math.max(0, i.qty + delta)) } : i,
    ))
  }

  async function handleSaveEdit() {
    if (!editTarget) return
    try {
      await updateMutation.mutateAsync({
        id:   editTarget.id,
        body: { items: editItems.map(i => ({ id: i.id, quantity: i.qty })) },
      })
      toast.success("Commande mise à jour")
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return
    try {
      await updateMutation.mutateAsync({ id: cancelTarget.id, body: { status: "CANCELLED" } })
      toast.success("Commande annulée")
      setCancelTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  const adjustedTotal = editItems.reduce((s, i) => s + i.unitPrice * i.qty, 0)
  const hasAdjustment = editTarget ? adjustedTotal !== editTarget.totalAmount : false

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center gap-3 py-4">
        <Button type="button" variant="ghost" size="icon" onClick={() => router.push(`/portal/${slug}/boutique`)}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="rounded-xl bg-primary/10 p-2.5 shrink-0">
          <PackageIcon className="size-6 text-primary" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Mes commandes</h1>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl border bg-muted animate-pulse" />
          ))}
        </div>
      ) : commandes.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center space-y-3">
          <ShoppingBagIcon className="size-8 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground text-sm">Aucune commande pour le moment.</p>
          <Button variant="outline" onClick={() => router.push(`/portal/${slug}/boutique`)}>
            Voir la boutique
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {commandes.map(c => (
            <div key={c.id} className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(c.createdAt), "d MMMM yyyy", { locale: fr })}
                  </p>
                  <p className="font-semibold text-primary tabular-nums">{fmt(c.totalAmount)}</p>
                </div>
                <Badge variant={STATUS_VARIANT[c.status]}>
                  {STATUS_LABEL[c.status]}
                </Badge>
              </div>

              <div className="space-y-1">
                {c.items.map((item, i) => (
                  <div key={`${c.id}-${item.variante.label}-${i}`} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="size-6 rounded bg-muted shrink-0 overflow-hidden">
                      {item.produit.imageUrl && (
                        <img src={item.produit.imageUrl} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <span>{item.quantity}× {item.produit.name} – {item.variante.label}</span>
                    <span className="ml-auto tabular-nums">{fmt(item.unitPrice * item.quantity)}</span>
                  </div>
                ))}
              </div>

              {c.note && (
                <p className="text-xs text-muted-foreground italic border-t pt-2">Note : {c.note}</p>
              )}

              {c.status === "PENDING" && (
                <div className="border-t pt-2 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    En attente de confirmation. L'administration vous contactera pour le retrait.
                  </p>
                  <div className="flex gap-2">
                    {c.paymentMethod === "MANUAL" && (
                      <Button size="sm" variant="outline" onClick={() => openEditModal(c)}>
                        <PencilIcon className="mr-1.5 size-3.5" />
                        Modifier
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setCancelTarget(c)}>
                      <XIcon className="mr-1.5 size-3.5" />
                      Annuler
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!editTarget}
        onOpenChange={o => { if (!o) setEditTarget(null) }}
        title="Modifier ma commande"
        description="Vous pouvez réduire ou retirer des articles. Pour en ajouter, passez une nouvelle commande."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Fermer</Button>
            <Button loading={updateMutation.isPending} disabled={adjustedTotal === 0} onClick={handleSaveEdit}>
              Enregistrer {fmt(adjustedTotal)}
            </Button>
          </>
        }
      >
        {editTarget && (
          <div className="space-y-4 py-1">
            <div className="space-y-3">
              {editItems.map(item => {
                const removed = item.qty === 0
                return (
                  <div key={item.id} className={cn("flex items-center gap-3", removed && "opacity-50")}>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-medium truncate", removed && "line-through")}>{item.produitName}</p>
                      <p className="text-xs text-muted-foreground">{item.varianteLabel}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" onClick={() => adjustQty(item.id, -1)} disabled={item.qty <= 0} className="size-7 rounded-full border flex items-center justify-center text-base font-medium hover:bg-muted transition-colors disabled:opacity-30">−</button>
                      <span className="w-6 text-center text-sm font-semibold tabular-nums">{item.qty}</span>
                      <button type="button" onClick={() => adjustQty(item.id, +1)} disabled={item.qty >= item.originalQty} className="size-7 rounded-full border flex items-center justify-center text-base font-medium hover:bg-muted transition-colors disabled:opacity-30">+</button>
                      <span className={cn("w-20 text-right text-sm tabular-nums", removed ? "text-muted-foreground/50 line-through" : "text-muted-foreground")}>{fmt(item.unitPrice * item.qty)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
            {hasAdjustment && (
              <div className="border-t pt-3 flex justify-between text-xs text-muted-foreground">
                <span>Total commandé</span>
                <span className="line-through">{fmt(editTarget.totalAmount)}</span>
              </div>
            )}
            {adjustedTotal === 0 && (
              <p className="text-xs text-muted-foreground">Pour retirer tous les articles, annulez plutôt la commande.</p>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={o => { if (!o) setCancelTarget(null) }}
        title="Annuler cette commande ?"
        description="Cette action est irréversible. Les articles seront remis en stock."
        confirmLabel="Annuler la commande"
        loading={updateMutation.isPending}
        onConfirm={handleCancel}
      />
    </div>
  )
}
