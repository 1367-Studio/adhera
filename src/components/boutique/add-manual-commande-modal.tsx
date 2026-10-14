"use client"

import { useEffect, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { SelectField } from "@/components/ui/select-field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { Command, CommandInput, CommandEmpty, CommandItem, CommandList } from "@/components/ui/command"
import { useCurrentUser } from "@/lib/user-context"

type Translator = ReturnType<typeof useTranslations>

type Membre      = { id: string; firstName: string; lastName: string; email: string }
type Variante     = { id: string; label: string; price: number; stock: number }
type Produit      = { id: string; name: string; status: string; variantes: Variante[] }
type ScopedOffer   = { varianteId: string; variante: Variante & { produit: { id: string; name: string; status: string } } }
type CatalogProduit = { id: string; name: string; variantes: Variante[] }

type Line = { key: string; produitId: string; varianteId: string; quantity: number }

function catalogFromProduits(produits: Produit[]): CatalogProduit[] {
  return produits
    .filter(p => p.status === "ACTIVE" && p.variantes.length > 0)
    .map(p => ({ id: p.id, name: p.name, variantes: p.variantes }))
}

function catalogFromOffers(offers: ScopedOffer[]): CatalogProduit[] {
  const byProduit = new Map<string, CatalogProduit>()
  for (const offer of offers) {
    if (offer.variante.produit.status !== "ACTIVE") continue
    const existing = byProduit.get(offer.variante.produit.id)
    const variante = { id: offer.variante.id, label: offer.variante.label, price: offer.variante.price, stock: offer.variante.stock }
    if (existing) existing.variantes.push(variante)
    else byProduit.set(offer.variante.produit.id, { id: offer.variante.produit.id, name: offer.variante.produit.name, variantes: [variante] })
  }
  return [...byProduit.values()]
}

function newLine(): Line {
  return { key: crypto.randomUUID(), produitId: "", varianteId: "", quantity: 1 }
}

const fmt = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

function getPaymentTypeOptions(t: Translator) {
  return [
    { value: "ESPECES",  label: t("paymentType.especes") },
    { value: "CHEQUE",   label: t("paymentType.cheque") },
    { value: "CB",       label: t("paymentType.cb") },
    { value: "VIREMENT", label: t("paymentType.virement") },
  ]
}

export function AddManualCommandeModal({ open, onOpenChange, onCreated }: {
  open:          boolean
  onOpenChange:  (open: boolean) => void
  onCreated:     () => void
}) {
  const t         = useTranslations("boutique")
  const tCommon   = useTranslations("common")
  const qc        = useQueryClient()
  const user      = useCurrentUser()
  const PAYMENT_TYPE_OPTIONS = getPaymentTypeOptions(t)

  const [buyerMode, setBuyerMode]       = useState<"membre" | "guest">("membre")
  const [memberQuery, setMemberQuery]   = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [selectedMembre, setSelectedMembre] = useState<Membre | null>(null)
  const [guestFirstName, setGuestFirstName] = useState("")
  const [guestLastName, setGuestLastName]   = useState("")
  const [guestEmail, setGuestEmail]         = useState("")
  const [scope, setScope]               = useState("STOREFRONT")
  const [lines, setLines]               = useState<Line[]>([newLine()])
  const [note, setNote]                 = useState("")
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [paymentStatus, setPaymentStatus] = useState<"PAID" | "PENDING">("PAID")
  const [manualPaymentType, setManualPaymentType] = useState("")
  const [sendBuyerEmail, setSendBuyerEmail]       = useState(true)
  const [notifyResponsible, setNotifyResponsible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(memberQuery), 250)
    return () => clearTimeout(timer)
  }, [memberQuery])
  const queryReady = debouncedQuery.trim().length >= 2

  useEffect(() => {
    if (!open) {
      setBuyerMode("membre"); setMemberQuery(""); setDebouncedQuery(""); setSelectedMembre(null)
      setGuestFirstName(""); setGuestLastName(""); setGuestEmail("")
      setScope("STOREFRONT"); setLines([newLine()]); setNote("")
      setPurchaseDate(new Date().toISOString().slice(0, 10))
      setPaymentStatus("PAID"); setManualPaymentType("")
      setSendBuyerEmail(true); setNotifyResponsible(true)
    }
  }, [open])

  const { data: candidates = [], isLoading: loadingCandidates } = useQuery<Membre[]>({
    queryKey: ["membres-active-for-boutique", debouncedQuery],
    queryFn:  () => fetch(`/api/membres?status=ACTIF&search=${encodeURIComponent(debouncedQuery.trim())}`).then(r => r.json()),
    enabled:  open && buyerMode === "membre" && !selectedMembre && queryReady,
  })

  const { data: produits = [] } = useQuery<Produit[]>({
    queryKey: ["boutique-produits"],
    queryFn:  () => fetch("/api/boutique/produits").then(r => r.json()),
    enabled:  open,
  })
  const { data: forms = [] } = useQuery<{ id: string; title: string }[]>({
    queryKey: ["membership-forms-for-boutique-scope"],
    queryFn:  () => fetch("/api/membership-forms").then(r => r.json()),
    enabled:  open,
  })
  const { data: evenementsResult } = useQuery<{ data: { id: string; title: string }[] }>({
    queryKey: ["evenements-for-boutique-scope"],
    queryFn:  () => fetch("/api/evenements").then(r => r.json()),
    enabled:  open,
  })
  const evenements = evenementsResult?.data ?? []

  const [scopeType, scopeId] = scope.includes(":") ? scope.split(":") : ["STOREFRONT", ""]
  const { data: scopedOffers } = useQuery<ScopedOffer[]>({
    queryKey: ["boutique-scope-offers", scope],
    queryFn:  () => fetch(scopeType === "form" ? `/api/membership-forms/${scopeId}/products` : `/api/evenements/${scopeId}/products`).then(r => r.json()),
    enabled:  open && scopeType !== "STOREFRONT" && !!scopeId,
  })

  const catalog = scopeType === "STOREFRONT" ? catalogFromProduits(produits) : catalogFromOffers(scopedOffers ?? [])

  // Changing scope invalidates any picked lines (a different catalog may not contain the
  // same variantes) — simplest correct behavior, resets to one empty line.
  function handleScopeChange(next: string) {
    setScope(next)
    setLines([newLine()])
  }

  const { data: settings } = useQuery<{ responsableId: string | null; responsable: { name: string } | null }>({
    queryKey: ["boutique-settings"],
    queryFn:  () => fetch("/api/boutique/settings").then(r => r.ok ? r.json() : { responsableId: null, responsable: null }),
    enabled:  open,
  })
  const hasResponsible = !!settings?.responsableId
  useEffect(() => {
    if (!settings) return
    setNotifyResponsible(!!settings.responsableId && settings.responsableId !== user.id)
  }, [settings, user.id])

  function updateLine(key: string, patch: Partial<Line>) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l))
  }
  function addLine() { setLines(prev => [...prev, newLine()]) }
  function removeLine(key: string) { setLines(prev => prev.length > 1 ? prev.filter(l => l.key !== key) : prev) }

  const validLines = lines.filter(l => l.produitId && l.varianteId && l.quantity > 0)
  const total = validLines.reduce((sum, l) => {
    const produit  = catalog.find(p => p.id === l.produitId)
    const variante = produit?.variantes.find(v => v.id === l.varianteId)
    return sum + (variante ? variante.price * l.quantity : 0)
  }, 0)

  const buyerEmail = buyerMode === "membre" ? selectedMembre?.email : guestEmail.trim()
  const buyerValid = buyerMode === "membre" ? !!selectedMembre : !!(guestFirstName.trim() && guestLastName.trim())

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...(buyerMode === "membre" ? { membreId: selectedMembre!.id } : {
          guestFirstName: guestFirstName.trim(), guestLastName: guestLastName.trim(),
          guestEmail: guestEmail.trim() || undefined,
        }),
        items: validLines.map(l => ({ produitId: l.produitId, varianteId: l.varianteId, quantity: l.quantity })),
        note: note.trim() || undefined,
        purchaseDate,
        paymentStatus,
        ...(paymentStatus === "PAID" ? { manualPaymentType } : {}),
        sendBuyerEmail: sendBuyerEmail && !!buyerEmail,
        notifyResponsible: notifyResponsible && hasResponsible,
      }
      const res = await fetch("/api/boutique/commandes", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(typeof body?.error === "string" ? body.error : tCommon("error"))
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["boutique-commandes"] })
      qc.invalidateQueries({ queryKey: ["boutique-produits"] })
      toast.success(t("manualCommandeModal.toasts.created"))
      onCreated()
      onOpenChange(false)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
  })

  const canSubmit = buyerValid && validLines.length > 0 && (paymentStatus === "PENDING" || !!manualPaymentType)

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("manualCommandeModal.title")}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tCommon("cancel")}</Button>
          <Button loading={createMutation.isPending} disabled={!canSubmit} onClick={() => createMutation.mutate()}>
            {t("manualCommandeModal.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-5 py-1">
        {/* Buyer */}
        <div className="space-y-2">
          <Label>{t("manualCommandeModal.buyerLabel")}</Label>
          <SegmentedControl
            size="sm"
            className="w-full"
            value={buyerMode}
            onChange={(v) => { setBuyerMode(v as "membre" | "guest"); setSelectedMembre(null) }}
            options={[
              { value: "membre", label: t("manualCommandeModal.existingContact") },
              { value: "guest",  label: t("manualCommandeModal.externalPerson") },
            ]}
          />
          {buyerMode === "membre" ? (
            selectedMembre ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span><span className="font-medium">{selectedMembre.firstName} {selectedMembre.lastName}</span> — <span className="text-muted-foreground">{selectedMembre.email}</span></span>
                <Button variant="ghost" size="sm" onClick={() => setSelectedMembre(null)}>{tCommon("edit")}</Button>
              </div>
            ) : (
              <Command className="rounded-lg! border" shouldFilter={false}>
                <CommandInput value={memberQuery} onValueChange={setMemberQuery} placeholder={t("manualCommandeModal.searchPlaceholder")} />
                <CommandList>
                  {!queryReady ? (
                    <CommandEmpty>{t("manualCommandeModal.typeToSearch")}</CommandEmpty>
                  ) : loadingCandidates ? (
                    <div className="p-3 space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-8 rounded-md bg-muted animate-pulse" />)}</div>
                  ) : (
                    <>
                      <CommandEmpty>{t("manualCommandeModal.noResults")}</CommandEmpty>
                      {candidates.map(m => (
                        <CommandItem key={m.id} value={`${m.lastName} ${m.firstName}`} onSelect={() => setSelectedMembre(m)}>
                          {m.lastName} {m.firstName} <span className="text-muted-foreground ml-1">— {m.email}</span>
                        </CommandItem>
                      ))}
                    </>
                  )}
                </CommandList>
              </Command>
            )
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder={t("manualCommandeModal.firstNamePlaceholder")} value={guestFirstName} onChange={e => setGuestFirstName(e.target.value)} />
              <Input placeholder={t("manualCommandeModal.lastNamePlaceholder")} value={guestLastName} onChange={e => setGuestLastName(e.target.value)} />
              <Input className="col-span-2" type="email" placeholder={t("manualCommandeModal.emailPlaceholder")} value={guestEmail} onChange={e => setGuestEmail(e.target.value)} />
            </div>
          )}
        </div>

        {/* Scope + products */}
        <div className="space-y-2">
          <SelectField
            label={t("manualCommandeModal.scopeLabel")}
            value={scope}
            onValueChange={handleScopeChange}
            options={[
              { value: "STOREFRONT", label: t("manualCommandeModal.scopeStorefront") },
              ...forms.map(f => ({ value: `form:${f.id}`, label: f.title })),
              ...evenements.map(e => ({ value: `event:${e.id}`, label: e.title })),
            ]}
          />

          <Label>{t("manualCommandeModal.productsLabel")}</Label>
          {catalog.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("manualCommandeModal.noProductsForScope")}</p>
          ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_70px_32px] gap-2 px-1">
              <p className="text-xs text-muted-foreground font-medium">{t("manualCommandeModal.productPlaceholder")}</p>
              <p className="text-xs text-muted-foreground font-medium">{t("manualCommandeModal.variantPlaceholder")}</p>
              <p className="text-xs text-muted-foreground font-medium">{t("manualCommandeModal.quantityColumn")}</p>
              <span />
            </div>
            {lines.map(line => {
              const produit  = catalog.find(p => p.id === line.produitId)
              const variante = produit?.variantes.find(v => v.id === line.varianteId)
              // A variante already picked on another line can't be picked again here — avoids
              // silently splitting one product into two rows instead of bumping the quantity.
              const usedElsewhere = new Set(lines.filter(l => l.key !== line.key).map(l => l.varianteId).filter(Boolean))
              return (
                <div key={line.key} className="grid grid-cols-[1fr_1fr_70px_32px] gap-2 items-start">
                  <Select
                    value={line.produitId}
                    onValueChange={(produitId) => {
                      if (!produitId) return
                      const p = catalog.find(cp => cp.id === produitId)
                      const autoVariante = p?.variantes.length === 1 && !usedElsewhere.has(p.variantes[0].id) ? p.variantes[0].id : ""
                      updateLine(line.key, { produitId, varianteId: autoVariante, quantity: 1 })
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>{produit?.name ?? t("manualCommandeModal.productPlaceholder")}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {catalog.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select
                    value={line.varianteId}
                    onValueChange={(varianteId) => { if (varianteId) updateLine(line.key, { varianteId, quantity: 1 }) }}
                    disabled={!produit}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>{variante ? `${variante.label} — ${fmt(variante.price)} (${variante.stock})` : t("manualCommandeModal.variantPlaceholder")}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(produit?.variantes ?? []).map(v => (
                        <SelectItem key={v.id} value={v.id} disabled={v.stock === 0 || usedElsewhere.has(v.id)}>
                          {v.label} — {fmt(v.price)} ({v.stock === 0 ? t("manualCommandeModal.outOfStock") : v.stock})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number" min={1} max={variante?.stock ?? 99}
                    value={line.quantity}
                    disabled={!variante}
                    onChange={e => updateLine(line.key, { quantity: Math.max(1, Math.min(variante?.stock ?? 99, parseInt(e.target.value, 10) || 1)) })}
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    disabled={lines.length === 1}
                    className="flex items-center justify-center size-9 rounded-md border text-muted-foreground hover:text-destructive hover:border-destructive/40 disabled:opacity-30 transition-colors"
                  >
                    <TrashIcon className="size-3.5" />
                  </button>
                </div>
              )
            })}
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addLine}>
              <PlusIcon className="size-3.5" />
              {t("manualCommandeModal.addProduct")}
            </Button>
          </div>
          )}

          {validLines.length > 0 && (
            <div className="flex justify-between border-t pt-2 text-sm font-semibold">
              <span>{t("manualCommandeModal.totalLabel")}</span>
              <span className="tabular-nums">{fmt(total)}</span>
            </div>
          )}
        </div>

        {/* Date + payment */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="purchase-date">{t("manualCommandeModal.dateLabel")}</Label>
            <Input id="purchase-date" type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("manualCommandeModal.paymentStatusLabel")}</Label>
            <SegmentedControl
              size="sm"
              className="w-full"
              value={paymentStatus}
              onChange={(v) => setPaymentStatus(v as "PAID" | "PENDING")}
              options={[
                { value: "PAID",    label: t("manualCommandeModal.paid") },
                { value: "PENDING", label: t("manualCommandeModal.pending") },
              ]}
            />
          </div>
        </div>

        {paymentStatus === "PAID" && (
          <SelectField
            label={t("paymentMethodLabel")}
            required
            options={PAYMENT_TYPE_OPTIONS}
            value={manualPaymentType}
            onValueChange={setManualPaymentType}
          />
        )}

        <div className="space-y-1.5">
          <Label htmlFor="manual-note">{t("manualCommandeModal.noteLabel")} <span className="text-muted-foreground font-normal">{t("form.optional")}</span></Label>
          <textarea
            id="manual-note"
            rows={2}
            value={note}
            onChange={e => setNote(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>

        <div className="space-y-2.5 border-t pt-3">
          {buyerEmail && (
            <CheckboxField
              label={paymentStatus === "PAID" ? t("manualCommandeModal.sendReceiptEmail") : t("manualCommandeModal.sendPendingEmail")}
              checked={sendBuyerEmail}
              onChange={e => setSendBuyerEmail(e.target.checked)}
            />
          )}
          {hasResponsible && (
            <CheckboxField
              label={t("manualCommandeModal.notifyResponsible", { name: settings?.responsable?.name ?? "" })}
              checked={notifyResponsible}
              onChange={e => setNotifyResponsible(e.target.checked)}
            />
          )}
        </div>
      </div>
    </Modal>
  )
}
