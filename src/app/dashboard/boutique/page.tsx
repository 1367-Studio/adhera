"use client"

import { Suspense, useEffect, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { PlusIcon, ShoppingBagIcon, PackageIcon, ShoppingCartIcon, EyeIcon, ArchiveIcon, NotePencilIcon, MoneyIcon, FileArrowDownIcon, PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Modal } from "@/components/ui/modal"
import { DataTable, type Column } from "@/components/ui/data-table"
import { SelectField } from "@/components/ui/select-field"
import { cn } from "@/lib/utils"
import { BASE_PATH } from "@/lib/env"

type Translator = ReturnType<typeof useTranslations>

function getManualPaymentTypeOptions(t: Translator) {
  return [
    { value: "ESPECES",  label: t("paymentType.especes") },
    { value: "CHEQUE",   label: t("paymentType.cheque") },
    { value: "CB",       label: t("paymentType.cb") },
    { value: "VIREMENT", label: t("paymentType.virement") },
  ]
}

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
  id:                string
  status:            "PENDING" | "PAID" | "CANCELLED"
  paymentMethod:     "STRIPE" | "MANUAL"
  manualPaymentType: "ESPECES" | "CHEQUE" | "CB" | "VIREMENT" | null
  totalAmount:       number
  note:          string | null
  createdAt:     string
  membre:        { firstName: string; lastName: string; email: string } | null
  items:         CommandeItem[]
}

type EditableItem = { id: string; qty: number; originalQty: number; unitPrice: number; produitName: string; varianteLabel: string }

function getProduitStatusLabel(t: Translator) {
  return { DRAFT: t("produitStatus.draft"), ACTIVE: t("produitStatus.active"), ARCHIVED: t("produitStatus.archived") }
}
const STATUS_PRODUIT_VARIANT: Record<string, "secondary" | "default" | "outline"> = {
  DRAFT:    "secondary",
  ACTIVE:   "default",
  ARCHIVED: "outline",
}
function getCommandeStatusLabel(t: Translator) {
  return { PENDING: t("commandeStatus.pending"), PAID: t("commandeStatus.paid"), CANCELLED: t("commandeStatus.cancelled") }
}
const STATUS_COMMANDE_VARIANT: Record<string, "secondary" | "success" | "outline"> = {
  PENDING:   "secondary",
  PAID:      "success",
  CANCELLED: "outline",
}

type Tab = "produits" | "commandes"

export default function BoutiquePage() {
  return (
    <Suspense fallback={null}>
      <BoutiquePageInner />
    </Suspense>
  )
}

function BoutiquePageInner() {
  const router       = useRouter()
  const qc           = useQueryClient()
  const searchParams = useSearchParams()
  const highlightId  = searchParams.get("commandeId")
  const t            = useTranslations("boutique")
  const tCommon      = useTranslations("common")

  const MANUAL_PAYMENT_TYPE_OPTIONS = getManualPaymentTypeOptions(t)
  const STATUS_PRODUIT_LABEL        = getProduitStatusLabel(t)
  const STATUS_COMMANDE_LABEL       = getCommandeStatusLabel(t)
  const [tab, setTab]               = useState<Tab>(searchParams.get("tab") === "commandes" ? "commandes" : "produits")
  const [deleteTarget, setDeleteTarget] = useState<Produit | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>("ALL")
  const [payTarget, setPayTarget]         = useState<Commande | null>(null)
  const [editItems, setEditItems]         = useState<EditableItem[]>([])
  const [manualPaymentType, setManualPaymentType] = useState("")
  const [cancelTarget, setCancelTarget]   = useState<Commande | null>(null)
  const [stripePayTarget, setStripePayTarget] = useState<Commande | null>(null)
  const [correctTarget, setCorrectTarget] = useState<Commande | null>(null)
  const [correctedType, setCorrectedType] = useState("")

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

  // Deep-link from the dashboard's "Ventes récentes" card: land on the right tab and
  // briefly highlight the row so the admin doesn't have to hunt for it in the list.
  useEffect(() => {
    if (!highlightId || tab !== "commandes" || loadingCommandes) return
    const el = document.querySelector(`[data-row-id="${highlightId}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    el.classList.add("ring-2", "ring-primary")
    const t = setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2500)
    return () => clearTimeout(t)
  }, [highlightId, tab, loadingCommandes, commandeResult])

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/boutique/produits/${id}`, { method: "DELETE" }).then(async r => {
      if (!r.ok) throw new Error((await r.json()).error ?? tCommon("error"))
      return r.json()
    }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["boutique-produits"] }); toast.success(t("view.toasts.productDeleted")) },
    onError:    (err) => toast.error(err instanceof Error ? err.message : t("view.toasts.deleteError")),
  })

  const updateCommandeStatus = useMutation({
    mutationFn: ({ id, status, items, manualPaymentType }: { id: string; status: string; items?: { id: string; quantity: number }[]; manualPaymentType?: string }) =>
      fetch(`/api/boutique/commandes/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status, ...(items ? { items } : {}), ...(manualPaymentType ? { manualPaymentType } : {}) }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json()).error ?? tCommon("error"))
        return r.json()
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["boutique-commandes"] }); toast.success(t("view.toasts.orderUpdated")) },
    onError:   (e) => toast.error(e instanceof Error ? e.message : tCommon("error")),
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
    setManualPaymentType("")
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
    if (!payTarget || !manualPaymentType) return
    try {
      await updateCommandeStatus.mutateAsync({
        id:     payTarget.id,
        status: "PAID",
        items:  editItems.map(i => ({ id: i.id, quantity: i.qty })),
        manualPaymentType,
      })
      setPayTarget(null)
    } catch {
      // onError already shows toast; keep modal open so user can retry
    }
  }

  function openCorrectModal(c: Commande) {
    setCorrectedType(c.manualPaymentType ?? "")
    setCorrectTarget(c)
  }

  async function handleCorrectPaymentType() {
    if (!correctTarget || !correctedType) return
    try {
      await updateCommandeStatus.mutateAsync({
        id:     correctTarget.id,
        status: "PAID",
        manualPaymentType: correctedType,
      })
      setCorrectTarget(null)
    } catch {
      // onError already shows toast; keep modal open so user can retry
    }
  }

  const produitColumns: Column<Produit>[] = [
    {
      key:    "produit",
      header: t("view.produitColumns.produit"),
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
            <p className="text-xs text-muted-foreground">{t("view.variantsCount", { count: p.variantes.length })}</p>
          </div>
        </div>
      ),
    },
    {
      key:    "status",
      header: t("view.produitColumns.status"),
      cell: (p) => (
        <Badge variant={STATUS_PRODUIT_VARIANT[p.status]}>
          {STATUS_PRODUIT_LABEL[p.status]}
        </Badge>
      ),
    },
    {
      key:    "stock",
      header: t("view.produitColumns.stock"),
      cell: (p) => {
        const total = p.variantes.reduce((s, v) => s + v.stock, 0)
        return <span className={cn("text-sm tabular-nums", total === 0 ? "text-destructive" : "")}>{total}</span>
      },
    },
    {
      key:    "prix",
      header: t("view.produitColumns.prix"),
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
      header: t("view.produitColumns.ventes"),
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
            { label: t("view.actions.edit"),   icon: <NotePencilIcon className="size-3.5" />, onClick: () => router.push(`/dashboard/boutique/${p.id}`) },
            {
              label:       p._count.commandeItems > 0 ? t("view.actions.deleteAlreadyOrdered") : t("view.actions.delete"),
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
      header: t("view.commandeColumns.membre"),
      cell: (c) => c.membre
        ? <div><p className="font-medium">{c.membre.firstName} {c.membre.lastName}</p><p className="text-xs text-muted-foreground">{c.membre.email}</p></div>
        : <span className="text-muted-foreground italic">{t("view.guest")}</span>,
    },
    {
      key:    "items",
      header: t("view.commandeColumns.items"),
      cell: (c) => (
        <div className="text-sm space-y-0.5">
          {c.items.slice(0, 2).map((item, i) => (
            <p key={i} className="text-muted-foreground">
              {item.quantity}× {item.produit.name} – {item.variante.label}
            </p>
          ))}
          {c.items.length > 2 && <p className="text-muted-foreground">{t("view.othersCount", { count: c.items.length - 2 })}</p>}
        </div>
      ),
    },
    {
      key:    "total",
      header: t("view.commandeColumns.total"),
      className: "w-24",
      cell: (c) => (
        <span className="font-semibold tabular-nums">
          {(c.totalAmount / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
        </span>
      ),
    },
    {
      key:    "paiement",
      header: t("view.commandeColumns.paiement"),
      className: "w-24",
      cell: (c) => (
        <span className="text-xs text-muted-foreground">
          {c.paymentMethod === "STRIPE"
            ? t("paymentType.stripe")
            : MANUAL_PAYMENT_TYPE_OPTIONS.find(o => o.value === c.manualPaymentType)?.label ?? t("paymentType.manualFallback")}
        </span>
      ),
    },
    {
      key:    "status",
      header: t("view.commandeColumns.status"),
      className: "w-32",
      cell: (c) => (
        <Badge variant={STATUS_COMMANDE_VARIANT[c.status]}>
          {STATUS_COMMANDE_LABEL[c.status]}
        </Badge>
      ),
    },
    {
      key:    "date",
      header: t("view.commandeColumns.date"),
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
            { label: t("view.actions.markPaid"), icon: <EyeIcon className="size-3.5" />,    onClick: () => openPayModal(c) },
            { label: t("view.actions.cancelOrder"), icon: <ArchiveIcon className="size-3.5" />, onClick: () => setCancelTarget(c), destructive: true, separator: true },
          ]}
        />
      ) : c.status === "PAID" ? (
        <RowActions
          actions={[
            { label: t("view.actions.downloadReceipt"), icon: <FileArrowDownIcon className="size-3.5" />, onClick: () => window.open(`${BASE_PATH}/api/boutique/commandes/${c.id}/pdf`, "_blank") },
            ...(c.paymentMethod === "MANUAL" ? [
              { label: t("view.actions.editPaymentMethod"), icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => openCorrectModal(c) },
            ] : []),
          ]}
        />
      ) : null,
    },
  ]

  const commandes = commandeResult?.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("view.title")}
        description={t("view.description")}
        action={tab === "produits" ? (
          <Button size="sm" onClick={() => router.push("/dashboard/boutique/nouveau")}>
            <PlusIcon className="mr-1.5 size-4" />
            {t("view.newProduct")}
          </Button>
        ) : undefined}
      />

      {/* Tabs */}
      <div className="inline-flex rounded-lg border bg-muted/30 p-0.5 gap-0.5">
        {([
          { key: "produits",  label: t("view.tabs.produits"),  icon: PackageIcon     },
          { key: "commandes", label: t("view.tabs.commandes"), icon: ShoppingCartIcon },
        ] as const).map(tabOption => (
          <button
            key={tabOption.key}
            type="button"
            onClick={() => setTab(tabOption.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-all",
              tab === tabOption.key
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <tabOption.icon className="size-3.5" />
            {tabOption.label}
          </button>
        ))}
      </div>

      {tab === "produits" && (
        <DataTable
          columns={produitColumns}
          data={produits}
          loading={loadingProduits}
          keyExtractor={(p) => p.id}
          empty={t("view.noProduct")}
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
                  "rounded-md border px-3 h-8 inline-flex items-center text-xs font-medium transition-colors",
                  statusFilter === s
                    ? "bg-foreground text-background border-foreground"
                    : "text-muted-foreground hover:text-foreground hover:border-foreground/40",
                )}
              >
                {s === "ALL" ? t("view.statusFilterAll") : STATUS_COMMANDE_LABEL[s]}
              </button>
            ))}
          </div>
          <DataTable
            columns={commandeColumns}
            data={commandes}
            loading={loadingCommandes}
            keyExtractor={(c) => c.id}
            empty={t("view.noOrder")}
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
            title={t("payModal.title")}
            size="sm"
            footer={
              <>
                <Button variant="outline" onClick={() => setPayTarget(null)}>{tCommon("cancel")}</Button>
                <Button
                  loading={updateCommandeStatus.isPending}
                  disabled={adjustedTotal === 0 || !manualPaymentType}
                  onClick={handleEncaisser}
                >
                  <MoneyIcon className="mr-1.5 size-4" />
                  {t("payModal.confirmWithAmount", { amount: fmt(adjustedTotal) })}
                </Button>
              </>
            }
          >
            {payTarget && (
              <div className="space-y-4 py-1">
                {payTarget.membre && (
                  <p className="text-sm text-muted-foreground">
                    {t("payModal.orderOf")}{" "}
                    <span className="font-medium text-foreground">
                      {payTarget.membre.firstName} {payTarget.membre.lastName}
                    </span>
                  </p>
                )}
                <SelectField
                  label={t("paymentMethodLabel")}
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
                          <button
                            type="button"
                            onClick={() => adjustQty(item.id, -1)}
                            disabled={item.qty <= 0}
                            className="size-7 rounded-md border flex items-center justify-center text-base font-medium hover:bg-muted transition-colors disabled:opacity-30"
                          >
                            −
                          </button>
                          <span className="w-6 text-center text-sm font-semibold tabular-nums">{item.qty}</span>
                          <button
                            type="button"
                            onClick={() => adjustQty(item.id, +1)}
                            disabled={item.qty >= item.originalQty}
                            className="size-7 rounded-md border flex items-center justify-center text-base font-medium hover:bg-muted transition-colors disabled:opacity-30"
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
                        <span>{t("payModal.orderedTotal")}</span>
                        <span className="line-through">{fmt(originalTotal)}</span>
                      </div>
                    )}
                    {hasZeroItems && (
                      <p className="text-xs text-muted-foreground">
                        {t("payModal.restockNoticePlural", { count: editItems.filter(i => i.qty === 0).length })}
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
        title={t("view.cancelOrderTitle")}
        description={
          cancelTarget?.membre
            ? t("view.cancelOrderDescriptionWithName", { name: `${cancelTarget.membre.firstName} ${cancelTarget.membre.lastName}` })
            : t("view.cancelOrderDescription")
        }
        confirmLabel={t("view.cancelOrderConfirm")}
        loading={updateCommandeStatus.isPending}
        onConfirm={() => {
          if (cancelTarget) updateCommandeStatus.mutate({ id: cancelTarget.id, status: "CANCELLED" })
          setCancelTarget(null)
        }}
      />

      <ConfirmDialog
        open={!!stripePayTarget}
        onOpenChange={o => { if (!o) setStripePayTarget(null) }}
        title={t("stripeConfirm.title")}
        description={t("stripeConfirm.descriptionWithHint", { amount: stripePayTarget ? (stripePayTarget.totalAmount / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : "" })}
        confirmLabel={t("stripeConfirm.confirmLabel")}
        loading={updateCommandeStatus.isPending}
        onConfirm={() => {
          if (stripePayTarget) updateCommandeStatus.mutate({ id: stripePayTarget.id, status: "PAID" })
          setStripePayTarget(null)
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}
        title={t("view.deleteProduitTitle")}
        description={t("view.deleteProduitDescription", { name: deleteTarget?.name ?? "" })}
        confirmLabel={tCommon("delete")}
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />

      {/* Correct manual payment type on an already-PAID order */}
      <Modal
        open={!!correctTarget}
        onOpenChange={o => { if (!o) setCorrectTarget(null) }}
        title={t("correctPaymentModal.title")}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCorrectTarget(null)}>{tCommon("cancel")}</Button>
            <Button
              loading={updateCommandeStatus.isPending}
              disabled={!correctedType || correctedType === correctTarget?.manualPaymentType}
              onClick={handleCorrectPaymentType}
            >
              {tCommon("save")}
            </Button>
          </>
        }
      >
        <div className="py-1">
          <SelectField
            label={t("paymentMethodLabel")}
            required
            options={MANUAL_PAYMENT_TYPE_OPTIONS}
            value={correctedType}
            onValueChange={setCorrectedType}
          />
          <p className="text-xs text-muted-foreground mt-2">
            {t("correctPaymentModal.hint")}
          </p>
        </div>
      </Modal>
    </div>
  )
}
