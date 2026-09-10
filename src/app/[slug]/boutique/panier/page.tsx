"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { useParams, useRouter, useSearchParams, usePathname } from "next/navigation"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { ArrowLeftIcon, ShoppingCartIcon, TrashIcon, MinusIcon, PlusIcon, CheckCircleIcon, CreditCardIcon, HandCoinsIcon, TruckIcon, StorefrontIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { useCart } from "@/lib/hooks/use-cart"

type CheckoutError = Error & { insufficientItems?: { varianteId: string; available: number }[] }
type ShippingOption = { code: string; carrierLabel: string; costCents: number; leadTimeHours: number | null }

function PanierContent() {
  const t        = useTranslations("portalMembre.boutique")
  const tPublic  = useTranslations("donationForms.public")
  const tCommon  = useTranslations("common")
  const tShip    = useTranslations("boutiqueShipping")
  const { slug } = useParams<{ slug: string }>()
  const router   = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { items, total, hydrated, updateQuantity, removeItem, clearCart } = useCart(slug)

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName]   = useState("")
  const [email, setEmail]         = useState("")
  const [phone, setPhone]         = useState("")
  const [website, setWebsite]     = useState("") // honeypot
  const [ordered, setOrdered]     = useState(false)
  const [paidOnline, setPaidOnline] = useState(false)
  const [trackingToken, setTrackingToken] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<"STRIPE" | "MANUAL">("STRIPE")

  const [deliveryMethod, setDeliveryMethod] = useState<"PICKUP" | "DELIVERY">("PICKUP")
  const [shippingAddress, setShippingAddress]       = useState("")
  const [shippingCity, setShippingCity]             = useState("")
  const [shippingPostalCode, setShippingPostalCode] = useState("")
  const [shippingCountry, setShippingCountry]       = useState("FR")
  const [shippingOptions, setShippingOptions]       = useState<ShippingOption[]>([])
  const [selectedShipping, setSelectedShipping]     = useState<ShippingOption | null>(null)
  const [ratesLoading, setRatesLoading]             = useState(false)
  const [ratesFetched, setRatesFetched]             = useState(false)

  // Drives whether "En ligne" is even offered — without this, a visitor could fill the
  // whole cart + guest form and only discover Stripe isn't configured after clicking
  // submit. Defaults to enabled while loading so the toggle doesn't flash MANUAL-only for
  // a split second on every page load.
  const { data: shopData } = useQuery<{ paymentEnabled: boolean }>({
    queryKey: ["public-boutique-shop", slug],
    queryFn:  () => fetch(`/api/public/${slug}/boutique`).then(r => r.json()),
  })
  const paymentEnabled = shopData?.paymentEnabled ?? true
  useEffect(() => {
    if (shopData && !shopData.paymentEnabled) setPaymentMethod("MANUAL")
  }, [shopData])

  // Delivery is only ever offered when every line in the cart supports it — a mixed cart
  // has no way to split shipping vs. pickup in this flow.
  const allShippable = items.length > 0 && items.every(i => i.shippable)
  useEffect(() => {
    if (!allShippable && deliveryMethod === "DELIVERY") setDeliveryMethod("PICKUP")
  }, [allShippable, deliveryMethod])

  // Debounced real-time quote — re-fires whenever the destination or the cart contents
  // change, and always invalidates whatever option was picked for a previous address.
  useEffect(() => {
    setSelectedShipping(null)
    setShippingOptions([])
    if (deliveryMethod !== "DELIVERY" || shippingPostalCode.trim().length < 3 || shippingCountry.trim().length !== 2) {
      setRatesFetched(false)
      return
    }
    setRatesLoading(true)
    setRatesFetched(false)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/public/${slug}/boutique/shipping-rate`, {
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
        if (options.length > 0) setSelectedShipping(options[0])
      } catch {
        setShippingOptions([])
      } finally {
        setRatesLoading(false)
        setRatesFetched(true)
      }
    }, 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryMethod, shippingPostalCode, shippingCountry, slug, items.length])

  const shownPaymentToast = useRef<string | null>(null)
  useEffect(() => {
    const p = searchParams.get("payment")
    if (!p || shownPaymentToast.current === p) return
    shownPaymentToast.current = p
    if (p === "success") {
      setOrdered(true)
      setPaidOnline(true)
      setTrackingToken(searchParams.get("token"))
    }
    if (p === "cancelled") toast.info(tPublic("toastCancelled"))
    router.replace(pathname, { scroll: false })
  }, [searchParams, tPublic, router, pathname])

  const fmt = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const deliveryReady = deliveryMethod === "PICKUP" || (
    shippingAddress.trim() && shippingCity.trim() && shippingPostalCode.trim() && shippingCountry.trim().length === 2 && selectedShipping
  )
  const canSubmit  = firstName.trim() && lastName.trim() && emailValid && items.length > 0 && deliveryReady

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        items:     items.map(i => ({ produitId: i.produitId, varianteId: i.varianteId, quantity: i.quantity })),
        firstName: firstName.trim(),
        lastName:  lastName.trim(),
        email:     email.trim(),
        phone:     phone.trim() || undefined,
        website,
        deliveryMethod,
        ...(deliveryMethod === "DELIVERY" ? {
          shippingAddress:    shippingAddress.trim(),
          shippingCity:       shippingCity.trim(),
          shippingPostalCode: shippingPostalCode.trim(),
          shippingCountry:    shippingCountry.trim().toUpperCase(),
          shippingOptionCode: selectedShipping?.code,
        } : {}),
      }
      const endpoint = paymentMethod === "STRIPE" ? "checkout" : "commande"
      const res = await fetch(`/api/public/${slug}/boutique/${endpoint}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      })
      const d = await res.json()
      if (!res.ok) {
        const err = new Error(typeof d.error === "string" ? d.error : tCommon("error")) as CheckoutError
        if (Array.isArray(d.insufficientItems)) err.insufficientItems = d.insufficientItems
        throw err
      }
      return {
        stripeUrl:     paymentMethod === "STRIPE" ? (d.url as string) : null,
        trackingToken: paymentMethod === "MANUAL" ? (d.trackingToken as string | null) : null,
      }
    },
    onSuccess: ({ stripeUrl, trackingToken: token }) => {
      clearCart()
      if (stripeUrl) {
        window.location.href = stripeUrl
      } else {
        setPaidOnline(false)
        setTrackingToken(token)
        setOrdered(true)
      }
    },
    onError: (e) => {
      const err = e as CheckoutError
      if (err.insufficientItems?.length) {
        // Live stock moved out from under this cart (someone else bought it in the
        // meantime) — clamp/remove the affected line(s) instead of leaving the buyer to
        // guess which item to fix from a generic error message.
        for (const item of err.insufficientItems) {
          if (item.available <= 0) removeItem(item.varianteId)
          else updateQuantity(item.varianteId, item.available)
        }
        toast.error(t("stockAdjustedNotice"))
      } else {
        toast.error(err.message || tCommon("error"))
      }
    },
  })

  if (ordered) {
    return (
      <div className="min-h-screen bg-background py-10 px-4">
        <div className="max-w-md mx-auto mt-8 rounded-lg border bg-card p-8 text-center space-y-4">
          <div className="size-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
            <CheckCircleIcon className="size-7 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold">{paidOnline ? t("paymentSuccessTitle") : t("orderPlacedTitle")}</h2>
            <p className="text-sm text-muted-foreground mt-1">{paidOnline ? t("paymentSuccessDescription") : t("orderPlacedDescription")}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            {trackingToken && (
              <Button variant="outline" onClick={() => router.push(`/${slug}/boutique/pedido/${trackingToken}`)}>
                {t("trackOrderButton")}
              </Button>
            )}
            <Button onClick={() => router.push(`/${slug}/boutique`)}>{t("continueShopping")}</Button>
          </div>
        </div>
      </div>
    )
  }

  if (!hydrated) {
    // Cart items only exist in localStorage — rendering the summary/empty-state before
    // it's read back would flash "empty cart" (or a €0,00 total) for a real cart.
    return <div className="min-h-screen bg-background" />
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-background py-10 px-4">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" size="icon" onClick={() => router.push(`/${slug}/boutique`)}>
              <ArrowLeftIcon className="size-4" />
            </Button>
            <h1 className="text-xl font-semibold tracking-tight">{t("myCart")}</h1>
          </div>
          <div className="rounded-lg border p-12 text-center space-y-3">
            <ShoppingCartIcon className="size-8 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground text-sm">{t("cartEmpty")}</p>
            <Button variant="outline" onClick={() => router.push(`/${slug}/boutique`)}>{t("viewShop")}</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" size="icon" onClick={() => router.push(`/${slug}/boutique`)}>
              <ArrowLeftIcon className="size-4" />
            </Button>
            <h1 className="text-xl font-semibold tracking-tight">{t("myCart")}</h1>
          </div>
          <LocaleSwitcher persistAccountLocale={false} />
        </div>

        <div className="grid lg:grid-cols-3 gap-5">
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
                  <p className="text-sm font-semibold text-primary">{fmt(item.price * item.quantity)}</p>
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
                      className={`flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs font-medium transition-colors ${
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

            {/* Honeypot — jamais visible pour un vrai visiteur */}
            <div className="absolute -left-[9999px]" aria-hidden>
              <label htmlFor="website">{tPublic("honeypotLabel")}</label>
              <input id="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label={tPublic("firstNameLabel")} placeholder={tPublic("firstNamePlaceholder")} required value={firstName} onChange={e => setFirstName(e.target.value)} />
              <FormField label={tPublic("lastNameLabel")} placeholder={tPublic("lastNamePlaceholder")} required value={lastName} onChange={e => setLastName(e.target.value)} />
            </div>
            <FormField type="email" label={tPublic("emailLabel")} placeholder={tPublic("emailPlaceholder")} required value={email} onChange={e => setEmail(e.target.value)} />
            <FormField type="tel" label={`${tPublic("phoneLabel")} (${t("optional")})`} placeholder={tPublic("phonePlaceholder")} value={phone} onChange={e => setPhone(e.target.value)} />

            {paymentEnabled ? (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("paymentMethod")}</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { v: "STRIPE", label: t("paymentStripe"), icon: CreditCardIcon },
                    { v: "MANUAL", label: t("paymentManual"), icon: HandCoinsIcon },
                  ] as const).map(opt => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setPaymentMethod(opt.v)}
                      className={`flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs font-medium transition-colors ${
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
                <p className="text-xs text-muted-foreground">
                  {paymentMethod === "STRIPE" ? t("paymentStripeHint") : t("paymentManualHint")}
                </p>
              </div>
            ) : (
              // Stripe isn't configured for this association — pay-on-pickup is the only
              // option, so there's nothing to choose between; showing a disabled toggle
              // would just invite a dead click.
              <p className="text-xs text-muted-foreground">{t("paymentManualHint")}</p>
            )}

            <Button
              className="w-full"
              size="lg"
              disabled={!canSubmit}
              loading={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {t("order")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PanierPage() {
  return (
    <Suspense fallback={null}>
      <PanierContent />
    </Suspense>
  )
}
