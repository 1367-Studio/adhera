"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { ArrowLeftIcon, ShoppingCartIcon, TrashIcon, MinusIcon, PlusIcon, CheckCircleIcon, CreditCardIcon, HandCoinsIcon, TruckIcon, StorefrontIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { useCart } from "@/lib/hooks/use-cart"

type ShippingOption = { code: string; carrierLabel: string; costCents: number; leadTimeHours: number | null }

export default function PanierPage() {
  const t        = useTranslations("portalMembre.boutique")
  const tCommon  = useTranslations("common")
  const tShip    = useTranslations("boutiqueShipping")
  const { slug } = useParams<{ slug: string }>()
  const router   = useRouter()
  const { items, total, updateQuantity, removeItem, clearCart } = useCart(slug)
  const [note, setNote]           = useState("")
  const [paymentMethod, setPaymentMethod] = useState<"MANUAL" | "STRIPE">("MANUAL")
  const [ordered, setOrdered]     = useState(false)

  const [deliveryMethod, setDeliveryMethod] = useState<"PICKUP" | "DELIVERY">("PICKUP")
  const [shippingAddress, setShippingAddress]       = useState("")
  const [shippingCity, setShippingCity]             = useState("")
  const [shippingPostalCode, setShippingPostalCode] = useState("")
  const [shippingCountry, setShippingCountry]       = useState("FR")
  const [shippingOptions, setShippingOptions]       = useState<ShippingOption[]>([])
  const [selectedShipping, setSelectedShipping]     = useState<ShippingOption | null>(null)
  const [ratesLoading, setRatesLoading]             = useState(false)
  const [ratesFetched, setRatesFetched]             = useState(false)

  const allShippable = items.length > 0 && items.every(i => i.shippable)
  useEffect(() => {
    if (!allShippable && deliveryMethod === "DELIVERY") setDeliveryMethod("PICKUP")
  }, [allShippable, deliveryMethod])

  // Identifies the cart's weight, not just which lines are present — a bare items.length
  // dependency would miss a quantity bump on an already-added line (the +/- steppers below),
  // leaving a stale, now-underweight quote on screen.
  const itemsKey = items.map(i => `${i.varianteId}:${i.quantity}`).join(",")

  useEffect(() => {
    setSelectedShipping(null)
    setShippingOptions([])
    if (deliveryMethod !== "DELIVERY" || shippingPostalCode.trim().length < 3 || shippingCountry.trim().length !== 2) {
      setRatesFetched(false)
      return
    }
    setRatesLoading(true)
    setRatesFetched(false)
    const timer = setTimeout(() => fetchShippingRates(), 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryMethod, shippingPostalCode, shippingCountry, itemsKey])

  async function fetchShippingRates() {
    setRatesLoading(true)
    try {
      const res = await fetch(`/api/portal/boutique/shipping-rate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          items:          items.map(i => ({ varianteId: i.varianteId, quantity: i.quantity })),
          destPostalCode: shippingPostalCode.trim(),
          destCountry:    shippingCountry.trim().toUpperCase(),
        }),
      })
      const d = await res.json()
      const options: ShippingOption[] = res.ok ? (d.options ?? []) : []
      setShippingOptions(options)
      setSelectedShipping(options.length > 0 ? options[0] : null)
    } catch {
      setShippingOptions([])
      setSelectedShipping(null)
    } finally {
      setRatesLoading(false)
      setRatesFetched(true)
    }
  }

  const deliveryReady = deliveryMethod === "PICKUP" || (
    shippingAddress.trim() && shippingCity.trim() && shippingPostalCode.trim() && shippingCountry.trim().length === 2 && selectedShipping
  )

  const fmt = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        items: items.map(i => ({ produitId: i.produitId, varianteId: i.varianteId, quantity: i.quantity })),
        note:  note.trim() || null,
        deliveryMethod,
        ...(deliveryMethod === "DELIVERY" ? {
          shippingAddress:         shippingAddress.trim(),
          shippingCity:            shippingCity.trim(),
          shippingPostalCode:      shippingPostalCode.trim(),
          shippingCountry:         shippingCountry.trim().toUpperCase(),
          shippingOptionCode:      selectedShipping?.code,
          shippingOptionCostCents: selectedShipping?.costCents,
        } : {}),
      }

      if (paymentMethod === "STRIPE") {
        const res = await fetch("/api/portal/boutique/checkout", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(payload),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(typeof d.error === "string" ? d.error : t("toasts.paymentError"))
        return { stripeUrl: d.url as string }
      }

      const res = await fetch("/api/portal/boutique/commandes", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...payload, paymentMethod: "MANUAL" }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(typeof d.error === "string" ? d.error : t("toasts.orderError"))
      }
      return { stripeUrl: null }
    },
    onSuccess: ({ stripeUrl }) => {
      clearCart()
      if (stripeUrl) {
        window.location.href = stripeUrl
      } else {
        setOrdered(true)
      }
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : tCommon("error"))
      // Most likely cause: the quoted price drifted (markup change, carrier repricing)
      // between fetch and submit — resolveShippingCost rejects a mismatch rather than
      // silently charging the new price. Re-quote immediately so the buyer sees the
      // current price without having to nudge the address fields to force a refetch.
      if (deliveryMethod === "DELIVERY") fetchShippingRates()
    },
  })

  if (ordered) {
    return (
      <div className="space-y-5 pb-10">
        <div className="max-w-lg mx-auto mt-8 rounded-lg border bg-card p-8 text-center space-y-4">
          <div className="size-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
            <CheckCircleIcon className="size-7 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold">{t("orderPlacedTitle")}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t("orderPlacedDescription")}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Button variant="outline" onClick={() => router.push(`/portal/${slug}/boutique/commandes`)}>
              {t("myOrdersButton")}
            </Button>
            <Button onClick={() => router.push(`/portal/${slug}/boutique`)}>
              {t("continueShopping")}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="space-y-5 pb-10">
        <div className="flex items-center gap-3 py-4">
          <Button type="button" variant="ghost" size="icon" onClick={() => router.push(`/portal/${slug}/boutique`)}>
            <ArrowLeftIcon className="size-4" />
          </Button>
          <div className="rounded-lg bg-primary/10 dark:bg-primary/20 p-2.5 shrink-0">
            <ShoppingCartIcon className="size-6 text-primary" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{t("myCart")}</h1>
        </div>
        <div className="rounded-lg border bg-card p-12 text-center space-y-3">
          <ShoppingCartIcon className="size-8 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground text-sm">{t("cartEmpty")}</p>
          <Button variant="outline" onClick={() => router.push(`/portal/${slug}/boutique`)}>
            {t("viewShop")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center gap-3 py-4">
        <Button type="button" variant="ghost" size="icon" onClick={() => router.push(`/portal/${slug}/boutique`)}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="rounded-lg bg-primary/10 dark:bg-primary/20 p-2.5 shrink-0">
          <ShoppingCartIcon className="size-6 text-primary" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{t("myCart")}</h1>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Items */}
        <div className="lg:col-span-2 space-y-3">
          {items.map(item => (
            <div key={item.varianteId} className="rounded-lg border bg-card p-4 flex gap-4">
              <div className="size-16 rounded-lg overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                {item.imageUrl
                  ? <img src={item.imageUrl} alt={item.produitName} className="w-full h-full object-cover" />
                  : <ShoppingCartIcon className="size-5 text-muted-foreground/40" />
                }
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="font-medium truncate">{item.produitName}</p>
                <p className="text-sm text-muted-foreground">{item.varianteLabel}</p>
                <p className="text-sm font-semibold text-primary">
                  {fmt(item.price * item.quantity)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => removeItem(item.varianteId)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <TrashIcon className="size-4" />
                </button>
                <div className="inline-flex items-center rounded-lg border gap-0.5 p-0.5">
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.varianteId, item.quantity - 1)}
                    className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <MinusIcon className="size-3" />
                  </button>
                  <span className="w-6 text-center text-xs font-medium tabular-nums">{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.varianteId, item.quantity + 1)}
                    disabled={item.quantity >= item.stock}
                    className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <PlusIcon className="size-3" />
                  </button>
                </div>
                {item.quantity >= item.stock && (
                  <p className="text-xs text-muted-foreground">{t("maxStockReached")}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="rounded-lg border bg-card p-5 space-y-4 h-fit">
          <h2 className="font-semibold">{t("summary")}</h2>

          <div className="space-y-2 text-sm">
            {items.map(item => (
              <div key={item.varianteId} className="flex justify-between text-muted-foreground">
                <span className="truncate mr-2">{item.produitName} ({item.quantity}×)</span>
                <span className="shrink-0 tabular-nums">{fmt(item.price * item.quantity)}</span>
              </div>
            ))}
          </div>

          {allShippable && (
            <div className="space-y-1.5 border-t pt-3">
              <label className="text-xs font-medium text-muted-foreground">{tShip("deliveryMethodLabel")}</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { v: "PICKUP",   label: tShip("pickupOption"),   icon: StorefrontIcon },
                  { v: "DELIVERY", label: tShip("deliveryOption"), icon: TruckIcon },
                ] as const).map(opt => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setDeliveryMethod(opt.v)}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-colors ${
                      deliveryMethod === opt.v
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-input text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    <opt.icon className="size-4" />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!allShippable && items.some(i => i.shippable) && (
            <p className="text-xs text-muted-foreground border-t pt-3">{tShip("mixedCartPickupOnlyHint")}</p>
          )}

          {deliveryMethod === "DELIVERY" && (
            <div className="space-y-3">
              <FormField label={tShip("addressLabel")} placeholder={tShip("addressPlaceholder")} required value={shippingAddress} onChange={e => setShippingAddress(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <FormField label={tShip("postalCodeLabel")} required value={shippingPostalCode} onChange={e => setShippingPostalCode(e.target.value)} />
                <FormField label={tShip("cityLabel")} required value={shippingCity} onChange={e => setShippingCity(e.target.value)} />
              </div>
              <FormField label={tShip("countryLabel")} required maxLength={2} value={shippingCountry} onChange={e => setShippingCountry(e.target.value.toUpperCase())} />

              {ratesLoading && <p className="text-xs text-muted-foreground">{tShip("loadingRates")}</p>}
              {!ratesLoading && ratesFetched && shippingOptions.length === 0 && (
                <p className="text-xs text-muted-foreground">{tShip("noShippingOptions")}</p>
              )}
              {!ratesLoading && shippingOptions.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{tShip("shippingOptionsLabel")}</label>
                  <div className="space-y-1.5">
                    {shippingOptions.map(opt => (
                      <button
                        key={opt.code}
                        type="button"
                        onClick={() => setSelectedShipping(opt)}
                        className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm text-left transition-colors ${
                          selectedShipping?.code === opt.code
                            ? "border-primary bg-primary/5"
                            : "border-input hover:border-primary/40"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{opt.carrierLabel}</span>
                          {opt.leadTimeHours != null && (
                            <span className="block text-xs text-muted-foreground">{tShip("leadTimeApprox", { days: Math.ceil(opt.leadTimeHours / 24) })}</span>
                          )}
                        </span>
                        <span className="shrink-0 tabular-nums font-medium">{fmt(opt.costCents)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedShipping && deliveryMethod === "DELIVERY" && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{tShip("shippingCostLabel")}</span>
              <span className="tabular-nums">{fmt(selectedShipping.costCents)}</span>
            </div>
          )}

          <div className="border-t pt-3 flex justify-between font-semibold">
            <span>{t("total")}</span>
            <span className="tabular-nums text-primary">{fmt(total + (deliveryMethod === "DELIVERY" ? (selectedShipping?.costCents ?? 0) : 0))}</span>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("paymentMethod")}</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: "MANUAL", label: t("paymentManual"),   icon: HandCoinsIcon  },
                { v: "STRIPE", label: t("paymentStripe"),     icon: CreditCardIcon },
              ] as const).map(opt => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setPaymentMethod(opt.v)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-colors ${
                    paymentMethod === opt.v
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-input text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  <opt.icon className="size-4" />
                  {opt.label}
                </button>
              ))}
            </div>
            {paymentMethod === "MANUAL" && (
              <p className="text-xs text-muted-foreground">{t("paymentManualHint")}</p>
            )}
            {paymentMethod === "STRIPE" && (
              <p className="text-xs text-muted-foreground">{t("paymentStripeHint")}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("note")} <span className="font-normal">{t("optional")}</span></label>
            <textarea
              rows={2}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>

          <Button
            className="w-full"
            size="lg"
            disabled={!deliveryReady}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t("order")}
          </Button>
        </div>
      </div>
    </div>
  )
}
