"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { PlusIcon, TrashIcon, ShoppingBagIcon, PencilSimpleIcon, ShoppingCartIcon, EyeIcon, ArchiveIcon, MoneyIcon, FileArrowDownIcon } from "@phosphor-icons/react/dist/ssr";
import { ImageUpload } from "@/components/ui/image-upload"
import { CurrencyInput } from "@/components/ui/currency-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { DataTable, type Column } from "@/components/ui/data-table"
import { RowActions } from "@/components/ui/row-actions"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { SelectField } from "@/components/ui/select-field"
import { useFinanceCategories } from "@/hooks/use-finance-categories"
import { BackLink } from "@/components/ui/back-link"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"
import { cn } from "@/lib/utils"
import { BASE_PATH } from "@/lib/env"

const MANUAL_PAYMENT_TYPE_OPTIONS = [
  { value: "ESPECES",  label: "Espèces" },
  { value: "CHEQUE",   label: "Chèque" },
  { value: "CB",       label: "Carte bancaire" },
  { value: "VIREMENT", label: "Virement" },
]

type VarianteRow = { _key: string; id?: string; label: string; price: number; stock: string }
type Variante    = { id: string; label: string; price: number; stock: number }
type Produit     = {
  id: string; name: string; description: string | null; imageUrl: string | null
  status: "DRAFT" | "ACTIVE" | "ARCHIVED"; categoryId: string | null; variantes: Variante[]
}

type CommandeItem = { id: string; quantity: number; unitPrice: number; produit: { id: string; name: string }; variante: { label: string } }
type EditItem     = { id: string; qty: number; originalQty: number; unitPrice: number; produitName: string; varianteLabel: string }
type Commande = {
  id:                string
  status:            "PENDING" | "PAID" | "CANCELLED"
  paymentMethod:     "STRIPE" | "MANUAL"
  manualPaymentType: "ESPECES" | "CHEQUE" | "CB" | "VIREMENT" | null
  totalAmount:       number
  createdAt:     string
  membre:        { firstName: string; lastName: string; email: string } | null
  items:         CommandeItem[]
}

const STATUS_PRODUIT_LABEL  = { DRAFT: "Brouillon", ACTIVE: "En ligne", ARCHIVED: "Archivé" }
const STATUS_PRODUIT_VARIANT: Record<string, "secondary" | "default" | "outline"> = {
  DRAFT: "secondary", ACTIVE: "default", ARCHIVED: "outline",
}
const STATUS_COMMANDE_LABEL   = { PENDING: "En attente", PAID: "Payée", CANCELLED: "Annulée" }
const STATUS_COMMANDE_VARIANT: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  PENDING: "secondary", PAID: "default", CANCELLED: "destructive",
}

function toRow(v: Variante): VarianteRow {
  return { _key: v.id, id: v.id, label: v.label, price: v.price / 100, stock: String(v.stock) }
}
function newRow(): VarianteRow {
  return { _key: crypto.randomUUID(), label: "", price: 0, stock: "0" }
}

export default function EditProduitPage() {
  const { id }  = useParams<{ id: string }>()
  const qc      = useQueryClient()

  const [activeTab, setActiveTab]       = useState("edit")
  const [payTarget, setPayTarget]       = useState<Commande | null>(null)
  const [stripePayTarget, setStripePayTarget] = useState<Commande | null>(null)
  const [editItems, setEditItems]       = useState<EditItem[]>([])
  const [manualPaymentType, setManualPaymentType] = useState("")
  const [correctTarget, setCorrectTarget] = useState<Commande | null>(null)
  const [correctedType, setCorrectedType] = useState("")
  const [name, setName]             = useState("")
  const [description, setDescription] = useState("")
  const [imageUrl, setImageUrl]     = useState("")
  const [status, setStatus]         = useState<"DRAFT" | "ACTIVE" | "ARCHIVED">("DRAFT")
  const [categoryId, setCategoryId] = useState("")
  const [variantes, setVariantes]   = useState<VarianteRow[]>([])

  const { data: categories = [] } = useFinanceCategories("INCOME")
  const categoryOptions = [
    { value: "", label: "Aucune catégorie" },
    ...categories.map((c: { id: string; name: string }) => ({ value: c.id, label: c.name })),
  ]

  const { data: produit, isLoading } = useQuery<Produit>({
    queryKey:  ["boutique-produit", id],
    queryFn:   () => fetch(`/api/boutique/produits/${id}`).then(async r => {
      if (!r.ok) throw new Error("Introuvable")
      return r.json()
    }),
    staleTime: 0,
  })

  const { data: commandeResult } = useQuery<{ data: Commande[] }>({
    queryKey:  ["boutique-commandes-produit", id],
    queryFn:   () => fetch("/api/boutique/commandes").then(r => r.json()),
    enabled:   activeTab === "commandes",
    staleTime: 0,
    select:   (res) => ({
      data: res.data.filter((c: Commande) =>
        c.items.some((item: CommandeItem) => item.produit.id === id)
      ),
    }),
  })

  useEffect(() => {
    if (!produit) return
    setName(produit.name)
    setDescription(produit.description ?? "")
    setImageUrl(produit.imageUrl ?? "")
    setStatus(produit.status)
    setCategoryId(produit.categoryId ?? "")
    setVariantes(produit.variantes.map(toRow))
  }, [produit])

  function addVariante() { setVariantes(prev => [...prev, newRow()]) }
  function removeVariante(key: string) { setVariantes(prev => prev.filter(v => v._key !== key)) }
  function updateVariante<K extends keyof Omit<VarianteRow, "_key">>(key: string, field: K, value: VarianteRow[K]) {
    setVariantes(prev => prev.map(v => v._key === key ? { ...v, [field]: value } : v))
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsedVariantes = variantes.map(v => ({
        ...(v.id ? { id: v.id } : {}),
        label: v.label.trim(),
        price: Math.round(v.price * 100),
        stock: parseInt(v.stock, 10) || 0,
      }))
      const res = await fetch(`/api/boutique/produits/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name: name.trim(), description: description.trim() || null,
          imageUrl: imageUrl.trim() || null, status, categoryId: categoryId || null,
          variantes: parsedVariantes,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(typeof d.error === "string" ? d.error : "Erreur lors de la sauvegarde")
      }
      return res.json()
    },
    onSuccess: (data: Produit) => {
      toast.success("Produit mis à jour")
      setVariantes(data.variantes.map(toRow))
      qc.invalidateQueries({ queryKey: ["boutique-produits"] })
      qc.invalidateQueries({ queryKey: ["boutique-produit", id] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  })

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: "DRAFT" | "ACTIVE" | "ARCHIVED") => {
      const res = await fetch(`/api/boutique/produits/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error("Erreur")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["boutique-produit", id] })
      qc.invalidateQueries({ queryKey: ["boutique-produits"] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  })

  const updateCommandeStatus = useMutation({
    mutationFn: ({ commandeId, status, items, manualPaymentType }: { commandeId: string; status: string; items?: { id: string; quantity: number }[]; manualPaymentType?: string }) =>
      fetch(`/api/boutique/commandes/${commandeId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status, ...(items ? { items } : {}), ...(manualPaymentType ? { manualPaymentType } : {}) }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Erreur")
        return r.json()
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["boutique-commandes-produit", id] })
      toast.success("Commande mise à jour")
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  })

  function openPayModal(c: Commande) {
    if (c.paymentMethod === "STRIPE") { setStripePayTarget(c); return }
    setEditItems(c.items.map(i => ({
      id:            i.id,
      qty:           i.quantity,
      originalQty:   i.quantity,
      unitPrice:     i.unitPrice,
      produitName:   i.produit.name,
      varianteLabel: i.variante.label,
    })))
    setManualPaymentType("")
    setPayTarget(c)
  }

  function openCorrectModal(c: Commande) {
    setCorrectedType(c.manualPaymentType ?? "")
    setCorrectTarget(c)
  }

  async function handleCorrectPaymentType() {
    if (!correctTarget || !correctedType) return
    try {
      await updateCommandeStatus.mutateAsync({
        commandeId: correctTarget.id,
        status:     "PAID",
        manualPaymentType: correctedType,
      })
      setCorrectTarget(null)
    } catch {
      // onError already shows toast; keep modal open so user can retry
    }
  }

  function adjustQty(itemId: string, delta: number) {
    setEditItems(prev => prev.map(i =>
      i.id === itemId ? { ...i, qty: Math.min(i.originalQty, Math.max(0, i.qty + delta)) } : i
    ))
  }

  async function handleEncaisser() {
    if (!payTarget || !manualPaymentType) return
    try {
      await updateCommandeStatus.mutateAsync({
        commandeId: payTarget.id,
        status:     "PAID",
        items:      editItems.map(i => ({ id: i.id, quantity: i.qty })),
        manualPaymentType,
      })
      setPayTarget(null)
    } catch { /* onError shows toast */ }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { toast.error("Le nom est obligatoire"); return }
    if (variantes.length === 0) { toast.error("Au moins une variante est requise"); return }
    for (const v of variantes) {
      if (!v.label.trim()) { toast.error("Chaque variante doit avoir un libellé"); return }
    }
    saveMutation.mutate()
  }

  if (isLoading) {
    return <DetailLoadingSkeleton />
  }

  if (!produit) {
    return (
      <DetailNotFound
        message="Ce produit est introuvable ou a été supprimé."
        backHref="/dashboard/boutique"
        backLabel="Retour à la liste"
      />
    )
  }

  const totalStock = produit.variantes.reduce((s, v) => s + v.stock, 0)

  const commandeColumns: Column<Commande>[] = [
    {
      key:  "membre",
      header: "Membre",
      cell: (c) => c.membre
        ? <div><p className="font-medium">{c.membre.firstName} {c.membre.lastName}</p><p className="text-xs text-muted-foreground">{c.membre.email}</p></div>
        : <span className="text-muted-foreground italic">Invité</span>,
    },
    {
      key:    "variante",
      header: "Variante",
      cell: (c) => (
        <div className="text-sm space-y-0.5">
          {c.items.map((item, i) => (
            <p key={i} className="text-muted-foreground">{item.quantity}× {item.variante.label}</p>
          ))}
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
      key:    "status",
      header: "Statut",
      className: "w-32",
      cell: (c) => (
        <Badge variant={STATUS_COMMANDE_VARIANT[c.status]}>
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
            { label: "Marquer payée", icon: <MoneyIcon className="size-3.5" />, onClick: () => openPayModal(c) },
          ]}
        />
      ) : c.status === "PAID" ? (
        <RowActions
          actions={[
            { label: "Télécharger le reçu", icon: <FileArrowDownIcon className="size-3.5" />, onClick: () => window.open(`${BASE_PATH}/api/boutique/commandes/${c.id}/pdf`, "_blank") },
            ...(c.paymentMethod === "MANUAL" ? [
              { label: "Modifier le moyen de paiement", icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => openCorrectModal(c) },
            ] : []),
          ]}
        />
      ) : null,
    },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 py-4">
        <BackLink href="/dashboard/boutique" iconOnly>Boutique</BackLink>
        <div className="rounded-xl bg-primary/10 dark:bg-primary/20 p-2.5 shrink-0">
          <ShoppingBagIcon className="size-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight truncate">{produit.name}</h1>
            <Badge variant={STATUS_PRODUIT_VARIANT[produit.status]}>
              {STATUS_PRODUIT_LABEL[produit.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {produit.variantes.length} variante{produit.variantes.length !== 1 ? "s" : ""} · {totalStock} en stock
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {produit.status === "DRAFT" && (
            <Button
              size="sm"
              onClick={() => updateStatusMutation.mutate("ACTIVE")}
              loading={updateStatusMutation.isPending}
            >
              <EyeIcon className="mr-1.5 size-4" />
              Mettre en ligne
            </Button>
          )}
          {produit.status === "ACTIVE" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => updateStatusMutation.mutate("ARCHIVED")}
              loading={updateStatusMutation.isPending}
            >
              <ArchiveIcon className="mr-1.5 size-4" />
              Archiver
            </Button>
          )}
          {produit.status === "ARCHIVED" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => updateStatusMutation.mutate("DRAFT")}
              loading={updateStatusMutation.isPending}
            >
              <PencilSimpleIcon className="mr-1.5 size-4" />
              Réactiver
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="edit">
            <PencilSimpleIcon className="size-3.5" />
            Produit
          </TabsTrigger>
          <TabsTrigger value="commandes">
            <ShoppingCartIcon className="size-3.5" />
            Commandes
          </TabsTrigger>
        </TabsList>

        {/* Edit tab */}
        <TabsContent value="edit">
          <form onSubmit={handleSave} className="pt-4 pb-10">
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="grid grid-cols-1 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x">

                {/* Left */}
                <div className="lg:col-span-2 p-5 space-y-4">
                  <h2 className="text-sm font-semibold">Informations</h2>

                  <div className="space-y-1.5">
                    <Label htmlFor="name">Nom <span className="text-destructive ml-0.5">*</span></Label>
                    <Input id="name" value={name} onChange={e => setName(e.target.value)} />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="desc">Description <span className="text-muted-foreground font-normal">(optionnel)</span></Label>
                    <textarea
                      id="desc"
                      rows={3}
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Image du produit <span className="text-muted-foreground font-normal">(optionnel)</span></Label>
                    <ImageUpload
                      value={imageUrl}
                      onChange={setImageUrl}
                      prefix="adhera/boutique"
                      aspectRatio="square"
                      className="w-4/5 mx-auto"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Visibilité</Label>
                    <div className="inline-flex rounded-lg border bg-muted/30 p-0.5 gap-0.5 w-full">
                      {([
                        { v: "DRAFT",    l: "Brouillon" },
                        { v: "ACTIVE",   l: "En ligne"  },
                        { v: "ARCHIVED", l: "Archivé"   },
                      ] as const).map(opt => (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() => setStatus(opt.v)}
                          className={cn(
                            "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all",
                            status === opt.v
                              ? "bg-background shadow-sm text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {opt.l}
                        </button>
                      ))}
                    </div>
                  </div>

                  <SelectField
                    label="Catégorie comptable"
                    options={categoryOptions}
                    value={categoryId}
                    onValueChange={setCategoryId}
                    placeholder="Aucune catégorie"
                  />
                </div>

                {/* Right — variantes */}
                <div className="lg:col-span-3 p-5 space-y-4">
                  <h2 className="text-sm font-semibold">
                    Variantes <span className="text-destructive ml-0.5">*</span>
                    <span className="text-muted-foreground font-normal ml-1.5">(taille, couleur, etc.)</span>
                  </h2>

                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_140px_80px_32px] gap-2 px-1">
                      <p className="text-xs text-muted-foreground font-medium">Libellé</p>
                      <p className="text-xs text-muted-foreground font-medium">Prix</p>
                      <p className="text-xs text-muted-foreground font-medium">Stock</p>
                      <span />
                    </div>

                    {variantes.map(v => (
                      <div key={v._key} className="grid grid-cols-[1fr_140px_80px_32px] gap-2 items-center">
                        <Input
                          className="h-9"
                          placeholder="Ex. Taille M / Bleu"
                          value={v.label}
                          onChange={e => updateVariante(v._key, "label", e.target.value)}
                        />
                        <CurrencyInput
                          value={v.price}
                          onChange={euros => updateVariante(v._key, "price", euros)}
                        />
                        <Input
                          className="h-9"
                          type="number" min="0" placeholder="0"
                          value={v.stock}
                          onChange={e => updateVariante(v._key, "stock", e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => removeVariante(v._key)}
                          disabled={variantes.length === 1}
                          className="flex items-center justify-center size-8 rounded-lg border text-muted-foreground hover:text-destructive hover:border-destructive/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <TrashIcon className="size-3.5" />
                        </button>
                      </div>
                    ))}

                    <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addVariante}>
                      <PlusIcon className="size-3.5" />
                      Ajouter une variante
                    </Button>
                  </div>
                </div>
              </div>

              <div className="border-t px-5 py-3 bg-muted/20 flex justify-end">
                <Button type="submit" loading={saveMutation.isPending}>Enregistrer</Button>
              </div>
            </div>
          </form>
        </TabsContent>

        {/* Commandes tab */}
        <TabsContent value="commandes">
          <div className="pt-4">
            <DataTable
              columns={commandeColumns}
              data={commandeResult?.data ?? []}
              loading={false}
              keyExtractor={(c) => c.id}
              empty="Aucune commande pour ce produit"
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* Pay modal — MANUAL */}
      {(() => {
        const fmt = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
        const adjustedTotal = editItems.reduce((s, i) => s + i.unitPrice * i.qty, 0)
        const hasAdjustment = adjustedTotal !== (payTarget?.totalAmount ?? 0)
        const hasZeroItems  = editItems.some(i => i.qty === 0)
        return (
          <Modal
            open={!!payTarget}
            onOpenChange={o => { if (!o) setPayTarget(null) }}
            title="Encaisser la commande"
            size="sm"
            footer={
              <>
                <Button variant="outline" onClick={() => setPayTarget(null)}>Annuler</Button>
                <Button loading={updateCommandeStatus.isPending} disabled={adjustedTotal === 0 || !manualPaymentType} onClick={handleEncaisser}>
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
                    Commande de <span className="font-medium text-foreground">{payTarget.membre.firstName} {payTarget.membre.lastName}</span>
                  </p>
                )}
                <SelectField
                  label="Moyen de paiement"
                  required
                  options={MANUAL_PAYMENT_TYPE_OPTIONS}
                  value={manualPaymentType}
                  onValueChange={setManualPaymentType}
                />
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
                          <button type="button" onClick={() => adjustQty(item.id, -1)} disabled={item.qty <= 0} className="size-7 rounded-full border flex items-center justify-center text-base font-medium hover:bg-muted transition-colors disabled:opacity-30">−</button>
                          <span className="w-6 text-center text-sm font-semibold tabular-nums">{item.qty}</span>
                          <button type="button" onClick={() => adjustQty(item.id, +1)} disabled={item.qty >= item.originalQty} className="size-7 rounded-full border flex items-center justify-center text-base font-medium hover:bg-muted transition-colors disabled:opacity-30">+</button>
                          <span className={cn("w-20 text-right text-sm tabular-nums", notCollected ? "text-muted-foreground/50 line-through" : "text-muted-foreground")}>{fmt(item.unitPrice * item.qty)}</span>
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
                        <span className="line-through">{fmt(payTarget.totalAmount)}</span>
                      </div>
                    )}
                    {hasZeroItems && (
                      <p className="text-xs text-muted-foreground">Le stock des articles non retirés sera restauré.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </Modal>
        )
      })()}

      {/* Pay confirm — STRIPE */}
      <ConfirmDialog
        open={!!stripePayTarget}
        onOpenChange={o => { if (!o) setStripePayTarget(null) }}
        title="Marquer comme payée ?"
        description={`Cette commande Stripe (${stripePayTarget ? (stripePayTarget.totalAmount / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : ""}) sera marquée comme payée manuellement.`}
        confirmLabel="Confirmer le paiement"
        loading={updateCommandeStatus.isPending}
        onConfirm={() => {
          if (stripePayTarget) updateCommandeStatus.mutate({ commandeId: stripePayTarget.id, status: "PAID" })
          setStripePayTarget(null)
        }}
      />

      {/* Correct manual payment type on an already-PAID order */}
      <Modal
        open={!!correctTarget}
        onOpenChange={o => { if (!o) setCorrectTarget(null) }}
        title="Modifier le moyen de paiement"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCorrectTarget(null)}>Annuler</Button>
            <Button
              loading={updateCommandeStatus.isPending}
              disabled={!correctedType || correctedType === correctTarget?.manualPaymentType}
              onClick={handleCorrectPaymentType}
            >
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="py-1">
          <SelectField
            label="Moyen de paiement"
            required
            options={MANUAL_PAYMENT_TYPE_OPTIONS}
            value={correctedType}
            onValueChange={setCorrectedType}
          />
          <p className="text-xs text-muted-foreground mt-2">
            Cela ne modifie pas le montant déjà comptabilisé dans Finances — corrigez-le là-bas si besoin.
          </p>
        </div>
      </Modal>
    </div>
  )
}
