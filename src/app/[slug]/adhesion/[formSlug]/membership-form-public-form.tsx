"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { toast } from "sonner"
import { useTranslations, useLocale } from "next-intl"
import { IdentificationCardIcon, PlusIcon, MinusIcon, TrashIcon, FileIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { ImageUpload } from "@/components/ui/image-upload"
import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { RichTextView } from "@/components/ui/rich-text-view"
import { spokenLanguageOptions } from "@/lib/languages"
import { InAppBrowserBanner } from "@/components/ui/in-app-browser-banner"
import { useInAppBrowserEscape } from "@/hooks/use-in-app-browser-escape"
import { cn } from "@/lib/utils"

type FieldRequirement = "HIDDEN" | "OPTIONAL" | "REQUIRED"
type CustomField = { id: string; type: "TEXT" | "NUMBER"; label: string; required: boolean }
type ItemType = "MEMBERSHIP" | "ADDON" | "DONATION"
type Tier = {
  id: string; label: string; itemType: ItemType; kind: "ONE_OFF" | "RECURRING"; free: boolean; freeAmount: boolean
  amount: string | null
  // null = adhésion sur l'année civile ; un nombre = validité personnalisée (voir
  // MembershipTier.durationMonths). Rare en dehors de MEMBERSHIP, mais le type le permet.
  durationMonths: number | null
  // Alternative à durationMonths — date de fin absolue (ISO), identique pour tout le monde
  // peu importe la date de paiement (voir MembershipTier.fixedPeriodEnd).
  fixedPeriodEnd: string | null
  // "Payer en plusieurs fois" — voir MembershipTier.installmentsAllowed. Only ever set on a
  // ONE_OFF fixed-amount tier (see tiers/route.ts).
  installmentsAllowed: boolean
  installmentsCount: number | null
  receiptMode: "NONE" | "FULL" | "PARTIAL"
  deductibleAmount: string | null
}
type ValidationMode = "IMMEDIATE" | "REQUEST"

// Produit Boutique proposé en fin de formulaire — voir MembershipFormProduct. price/stock
// sont lus en direct depuis le BoutiqueVariante au moment du GET, price en centimes
// (contrairement aux montants de tier/addon, en euros décimaux — converti explicitement
// partout où il rejoint `amount`).
type OfferedProduct = {
  id: string; varianteId: string; variantLabel: string; price: number; stock: number
  productId: string; productName: string; productImageUrl: string | null
}

type FormInfo = {
  associationName: string
  id: string
  title: string
  imageUrl: string | null
  description: string | null
  conditions: string | null
  attachments?: { url: string; filename: string; size: number }[] | null
  requireCguvSignature: boolean
  validationMode: ValidationMode
  fieldAddress: FieldRequirement
  fieldBirthDate: FieldRequirement
  fieldPhone: FieldRequirement
  fieldMobile: FieldRequirement
  fieldGender: FieldRequirement
  fieldPhoto: FieldRequirement
  fieldLanguage: FieldRequirement
  confirmationMessage: string | null
  offlineInstructions: string | null
  allowCash: boolean
  allowCheque: boolean
  allowTransfer: boolean
  notOpenYet: boolean
  closed: boolean
  paymentEnabled: boolean
  tiers: Tier[]
  customFields: CustomField[]
  products: OfferedProduct[]
}

type PaymentMethod = "STRIPE" | "ESPECES" | "CHEQUE" | "VIREMENT"
type SubmitOutcome = "url" | "immediate" | "offline" | "pending" | null

const MIN_AMOUNT = 1
// Mirrors checkout/route.ts's own MAX_REGISTRANTS — bounds both the Stripe line_items array
// and how many rows a single submission can create.
const MAX_REGISTRANTS = 10

// One extra "Adhérent" block added via "Ajouter un autre adhérent" — the person who filled
// out the form (name/email/password/standard fields above) is always registrant 0 and keeps
// using the existing top-level state; this only covers registrants 1..N-1. No addons/
// donation embarquée and no RECURRING tier here — see checkout/route.ts's own scoping note.
type RegistrantDraft = {
  key: string
  tierId: string
  freeAmount: number
  firstName: string
  lastName:  string
  birthDate: string
  phone:     string
  mobile:    string
  sexe:      "" | "HOMME" | "FEMME"
  spokenLanguage: string
  address:   string
  photoUrl:  string
  answers:   Record<string, string>
}

let nextRegistrantId = 0

type Props = { slug: string; formSlug: string }

export function MembershipFormPublicForm(props: Props) {
  return (
    <Suspense fallback={null}>
      <MembershipFormPublicFormInner {...props} />
    </Suspense>
  )
}

function MembershipFormPublicFormInner({ slug, formSlug }: Props) {
  const t   = useTranslations("membershipForms.public")
  const loc = useLocale()
  const searchParams = useSearchParams()
  const isPreview    = searchParams.get("preview") === "1"
  const router        = useRouter()
  const pathname       = usePathname()
  const showInAppBrowserBanner = useInAppBrowserEscape()

  const [form, setForm]         = useState<FormInfo | null | undefined>(undefined) // undefined = loading, null = not found
  const [loading, setLoading]   = useState(false)
  const [outcome, setOutcome]   = useState<SubmitOutcome>(null)

  const [tierId, setTierId]         = useState("")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("STRIPE")
  const [freeAmount, setFreeAmount] = useState(0)
  const [payInInstallments, setPayInInstallments] = useState(false)
  // ADDON/DONATION tiers picked alongside the (mandatory) membership tier — a set of
  // checkbox selections, each with its own free-amount input when the tier calls for one.
  const [selectedExtraIds, setSelectedExtraIds] = useState<Set<string>>(new Set())
  const [extraAmounts, setExtraAmounts] = useState<Record<string, number>>({})
  // Produits Boutique choisis en fin de formulaire — keyed par varianteId, absent/0 = pas
  // sélectionné. Un simple compteur suffit ici (pas de "montant libre" comme pour les
  // extras), contrairement à selectedExtraIds/extraAmounts.
  const [productQuantities, setProductQuantities] = useState<Record<string, number>>({})
  const [firstName, setFirstName]   = useState("")
  const [lastName, setLastName]     = useState("")
  const [email, setEmail]           = useState("")
  const [password, setPassword]     = useState("")
  const [address, setAddress]       = useState("")
  const [birthDate, setBirthDate]   = useState("")
  const [phone, setPhone]           = useState("")
  const [mobile, setMobile]         = useState("")
  const [photoUrl, setPhotoUrl]     = useState("")
  // Mirrors Membre.sexe's own two values (see membre-form.tsx's sexeOptions) — there's no
  // "autre"/non-binary value in that enum today.
  const [sexe, setSexe]             = useState<"" | "HOMME" | "FEMME">("")
  const [spokenLanguage, setSpokenLanguage] = useState("")
  const languageOptions = spokenLanguageOptions()
  const [conditionsAgreed, setConditionsAgreed] = useState(false)
  const [answers, setAnswers]       = useState<Record<string, string>>({})
  const [website, setWebsite]       = useState("") // honeypot
  const [extraRegistrants, setExtraRegistrants] = useState<RegistrantDraft[]>([])

  useEffect(() => {
    fetch(`/api/public/${slug}/adhesion/${formSlug}${isPreview ? "?preview=1" : ""}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: FormInfo | null) => {
        setForm(data)
        const firstMembership = data?.tiers.find(t => t.itemType === "MEMBERSHIP")
        if (firstMembership) setTierId(firstMembership.id)
      })
      .catch(() => setForm(null))
  }, [slug, formSlug, isPreview])

  // Re-fetched (not just re-shown) after a rejected submit — a "stock insuffisant" 422 means
  // the numbers already on screen are stale, and without this the visitor would just retry
  // with the same now-wrong quantity and get the same error again. Doesn't touch tierId (an
  // in-progress selection shouldn't be reset) or re-run on mount, unlike the effect above.
  function refreshProductsStock() {
    fetch(`/api/public/${slug}/adhesion/${formSlug}${isPreview ? "?preview=1" : ""}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: FormInfo | null) => {
        if (!data) return
        setForm(data)
        setProductQuantities(prev => {
          const next: Record<string, number> = {}
          for (const p of data.products) {
            const q = prev[p.varianteId]
            if (q) next[p.varianteId] = Math.min(q, p.stock)
          }
          return next
        })
      })
      .catch(() => {})
  }

  const shownPaymentToast = useRef<string | null>(null)
  useEffect(() => {
    const p = searchParams.get("payment")
    if (!p || shownPaymentToast.current === p) return
    shownPaymentToast.current = p
    if (p === "success") setOutcome("url")
    if (p === "cancelled") toast.info(t("toastCancelled"))
    router.replace(pathname, { scroll: false })
  }, [searchParams, t, router, pathname])

  const membershipTiers = form?.tiers.filter(t => t.itemType === "MEMBERSHIP") ?? []
  const extraTiers      = form?.tiers.filter(t => t.itemType !== "MEMBERSHIP") ?? []
  const selectedTier = membershipTiers.find(x => x.id === tierId) ?? null
  // A RECURRING tier bills every durationMonths months, not always yearly (see
  // MembershipTier.durationMonths) — 12 (or unset) still reads as "par an" rather than the
  // technically-equivalent-but-odd "tous les 12 mois".
  const recurringSuffix = (tier: Tier) =>
    tier.durationMonths && tier.durationMonths !== 12 ? t("perNMonths", { months: tier.durationMonths }) : t("perYear")
  // A ONE_OFF tier with a custom duration is still a single payment, but its validity isn't
  // "until year-end" the way a visitor would otherwise reasonably assume — this is the only
  // place that ever gets communicated to them. fixedPeriodEnd is the alternative to
  // durationMonths (mutually exclusive, see tiers/route.ts) — same end date for everyone.
  const oneOffDurationSuffix = (tier: Tier) => {
    if (tier.kind !== "ONE_OFF") return null
    if (tier.fixedPeriodEnd) return t("validUntilDate", { date: new Date(tier.fixedPeriodEnd).toLocaleDateString(loc) })
    if (tier.durationMonths) return t("validForMonths", { months: tier.durationMonths })
    return null
  }
  const membershipAmount = !selectedTier ? 0 : selectedTier.free ? 0 : selectedTier.freeAmount ? freeAmount : Number(selectedTier.amount ?? 0)
  // A montant-libre extra with no minimum configured by staff still needs a real floor —
  // otherwise the field defaults to €0 and nothing stops a visitor from submitting it as-is.
  const tierMinimum = (x: Tier) => (x.amount != null ? Number(x.amount) : MIN_AMOUNT)
  const selectedExtras = extraTiers.filter(x => selectedExtraIds.has(x.id))
  const extrasAmount = selectedExtras.reduce((sum, x) => sum + (x.freeAmount ? (extraAmounts[x.id] ?? tierMinimum(x)) : Number(x.amount ?? 0)), 0)
  const extraBelowMinimum = selectedExtras.find(x => x.freeAmount && (extraAmounts[x.id] ?? tierMinimum(x)) < tierMinimum(x))

  // ─── Inscription groupée (N ≥ 2 "Adhérent") ─────────────────────────────────────
  // No addons/donation embarquée and no RECURRING tier in this mode — see checkout/route.ts's
  // own scoping note (a Stripe Subscription can't be split across N people). Registrant 0 is
  // always the person filling out the form, reusing every state variable above; this only
  // covers the extra blocks added via "Ajouter un autre adhérent".
  const oneOffMembershipTiers = membershipTiers.filter(x => x.kind === "ONE_OFF")
  const isMulti = extraRegistrants.length > 0
  const registrantTier = (r: RegistrantDraft) => oneOffMembershipTiers.find(x => x.id === r.tierId) ?? null
  const registrantAmount = (r: RegistrantDraft) => {
    const rt = registrantTier(r)
    if (!rt) return 0
    return rt.free ? 0 : rt.freeAmount ? r.freeAmount : Number(rt.amount ?? 0)
  }
  const extraRegistrantsAmount = extraRegistrants.reduce((sum, r) => sum + registrantAmount(r), 0)

  // Produits Boutique — disponibles aussi en mode multi-inscrit, toujours attribués en entier
  // au registrant 0 (seule personne du groupe avec un email/login réel — voir
  // consumeMembershipCheckoutDraft) plutôt que répartis entre les N personnes. Jamais avec un
  // tarif récurrent ou un paiement échelonné (le stock est décompté une seule fois, au moment
  // du paiement unique — voir checkout/route.ts). En mode multi, tous les tarifs sont déjà
  // ONE_OFF (RECURRING y est exclu plus haut), donc seul selectedTier (registrant 0) compte ici.
  const canBuyProducts = !!selectedTier && selectedTier.kind === "ONE_OFF" && !payInInstallments
  const offeredProducts = form?.products ?? []
  // price est en centimes (BoutiqueVariante.price) — converti ici, une seule fois, avant de
  // rejoindre membershipAmount/extrasAmount qui sont en euros décimaux.
  const productsAmount = canBuyProducts
    ? offeredProducts.reduce((sum, p) => sum + (productQuantities[p.varianteId] ?? 0) * p.price, 0) / 100
    : 0
  const hasProductsSelected = Object.values(productQuantities).some(q => q > 0)
  const registrantBelowMinimum = extraRegistrants.find(r => {
    const rt = registrantTier(r)
    return !!rt && !rt.free && rt.freeAmount && registrantAmount(r) < tierMinimum(rt)
  })
  const canAddRegistrant = !isMulti
    ? !!selectedTier && selectedTier.kind === "ONE_OFF" && oneOffMembershipTiers.length > 0
    : extraRegistrants.length + 1 < MAX_REGISTRANTS

  const amount = isMulti ? membershipAmount + extraRegistrantsAmount + productsAmount : membershipAmount + extrasAmount + productsAmount
  // A paid membership tier is always immediate as soon as payment is confirmed; so is any
  // paid extra/registrant riding along with an otherwise-free membership (there's nothing
  // sensible to "hold for approval" once money changed hands) — mirrors willBeImmediate in
  // checkout/route.ts (both the single- and multi-registrant branches).
  const willBeImmediate = !!selectedTier && (amount > 0 || form?.validationMode === "IMMEDIATE")

  // Offline methods only make sense for a one-off charge — a cheque doesn't arrive on its own
  // every year. A free membership tier is always stored as kind ONE_OFF (see
  // membership-tiers-editor.tsx), so this already covers "free tier + paid extras" too without
  // special-casing it. Never available in multi-registrant mode (Stripe-only, see
  // checkout/route.ts).
  const offlineMethods = (["ESPECES", "CHEQUE", "VIREMENT"] as const).filter(m =>
    m === "ESPECES" ? form?.allowCash : m === "CHEQUE" ? form?.allowCheque : form?.allowTransfer,
  )
  const needsPayment = amount > 0
  // Only the membership price itself can be split — an addon/donation riding alongside would
  // otherwise have to be either folded into the recurring installment price (changing what
  // each future automatic charge is for) or invoiced separately, neither of which the visitor
  // has any way to see coming. Simplest to just not offer both at once, same restriction
  // showOfflineChoice already applies for the same underlying reason.
  // Un produit Boutique n'est décompté du stock que via le webhook Stripe (voir
  // checkout/route.ts + membership-form-products.ts) — un paiement hors-ligne (espèces,
  // chèque, virement) ne passe jamais par ce webhook, donc un produit choisi doit forcer le
  // paiement en ligne, même raisonnement que les extras avec extrasAmount === 0 ci-dessous.
  const canPayInInstallments = !isMulti && !!selectedTier && selectedTier.installmentsAllowed && extrasAmount === 0 && !hasProductsSelected
  const showOfflineChoice = !isMulti && !!selectedTier && needsPayment && selectedTier.kind === "ONE_OFF" && offlineMethods.length > 0 && extrasAmount === 0 && !hasProductsSelected && !payInInstallments
  const hasAnyPaymentMethod = !selectedTier || !needsPayment
    || (isMulti ? !!form?.paymentEnabled : !!(form?.paymentEnabled || (selectedTier.kind === "ONE_OFF" && offlineMethods.length > 0)))

  useEffect(() => {
    if (!canPayInInstallments && payInInstallments) setPayInInstallments(false)
  }, [canPayInInstallments, payInInstallments])

  // Clears any chosen product the moment the section itself would stop rendering (switching
  // to a RECURRING tier or toggling "plusieurs fois") — otherwise a stale selection could
  // silently resurrect if the visitor switches back, same convention as addRegistrant()
  // clearing selectedExtraIds/extraAmounts below.
  useEffect(() => {
    if (!canBuyProducts && hasProductsSelected) setProductQuantities({})
  }, [canBuyProducts, hasProductsSelected])

  // Extras hide the offline radio group (see showOfflineChoice) — if a visitor had already
  // picked an offline method and then checks an extra (or adds another adhérent), fall back
  // to Stripe rather than silently submitting a payment method the UI no longer shows as
  // selected. Same for opting into "plusieurs fois", which is Stripe-only.
  useEffect(() => {
    if ((!showOfflineChoice || payInInstallments) && paymentMethod !== "STRIPE") setPaymentMethod("STRIPE")
  }, [showOfflineChoice, paymentMethod, payInInstallments])

  function addRegistrant() {
    const defaultTier = oneOffMembershipTiers[0]
    // Addons/donations ne sont pas offerts en mode multi-inscrit (impossible à répartir entre
    // N personnes) — cleared so a stale selection from before "Ajouter un autre adhérent" can't
    // silently resurrect if extras are removed. Les produits Boutique restent disponibles en
    // mode multi (toujours attribués au registrant 0), donc productQuantities n'est pas vidé ici.
    setSelectedExtraIds(new Set())
    setExtraAmounts({})
    setExtraRegistrants(prev => [...prev, {
      key: `reg-${nextRegistrantId++}`, tierId: defaultTier?.id ?? "", freeAmount: 0,
      firstName: "", lastName: "", birthDate: "", phone: "", mobile: "", sexe: "", spokenLanguage: "", address: "", photoUrl: "", answers: {},
    }])
  }
  function removeRegistrant(key: string) {
    setExtraRegistrants(prev => prev.filter(r => r.key !== key))
  }
  function updateRegistrant(key: string, patch: Partial<RegistrantDraft>) {
    setExtraRegistrants(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r))
  }

  const emailValid = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
  const belowMinimum = needsPayment && paymentMethod === "STRIPE" && amount < MIN_AMOUNT
  const registrantValid = (r: RegistrantDraft) => {
    const rt = registrantTier(r)
    return !!form && !!rt &&
      !!r.firstName.trim() && !!r.lastName.trim() &&
      (form.fieldAddress   !== "REQUIRED" || r.address.trim()) &&
      (form.fieldBirthDate !== "REQUIRED" || r.birthDate.trim()) &&
      (form.fieldPhone     !== "REQUIRED" || r.phone.trim()) &&
      (form.fieldMobile    !== "REQUIRED" || r.mobile.trim()) &&
      (form.fieldGender    !== "REQUIRED" || !!r.sexe) &&
      (form.fieldLanguage  !== "REQUIRED" || !!r.spokenLanguage) &&
      (form.fieldPhoto     !== "REQUIRED" || r.photoUrl) &&
      form.customFields.every(f => !f.required || (r.answers[f.id] ?? "").trim() !== "")
  }
  const canSubmit =
    !loading && !isPreview &&
    !!form && !form.notOpenYet && !form.closed &&
    !!selectedTier &&
    (!isMulti || (!registrantBelowMinimum && extraRegistrants.every(registrantValid))) &&
    (!needsPayment || (
      !belowMinimum && !extraBelowMinimum &&
      (paymentMethod === "STRIPE" ? form.paymentEnabled : selectedTier.kind === "ONE_OFF")
    )) &&
    firstName.trim() && lastName.trim() && emailValid(email) &&
    (!willBeImmediate || password.length >= 8) &&
    (form.fieldAddress   !== "REQUIRED" || address.trim()) &&
    (form.fieldBirthDate !== "REQUIRED" || birthDate.trim()) &&
    (form.fieldPhone     !== "REQUIRED" || phone.trim()) &&
    (form.fieldMobile    !== "REQUIRED" || mobile.trim()) &&
    (form.fieldGender    !== "REQUIRED" || sexe) &&
    (form.fieldLanguage  !== "REQUIRED" || !!spokenLanguage) &&
    (form.fieldPhoto     !== "REQUIRED" || photoUrl) &&
    (!form.requireCguvSignature || conditionsAgreed) &&
    form.customFields.every(f => !f.required || (answers[f.id] ?? "").trim() !== "")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !form || !selectedTier) return

    setLoading(true)
    try {
      const payload = isMulti
        ? {
            registrants: [
              {
                tierId,
                amount: !selectedTier.free && selectedTier.freeAmount ? membershipAmount : undefined,
                firstName: firstName.trim(), lastName: lastName.trim(),
                birthDate: birthDate.trim() || undefined, phone: phone.trim() || undefined, mobile: mobile.trim() || undefined,
                sexe: sexe || undefined, spokenLanguage: spokenLanguage || undefined, address: address.trim() || undefined, photoUrl: photoUrl || undefined, answers,
              },
              ...extraRegistrants.map(r => {
                const rt = registrantTier(r)
                return {
                  tierId: r.tierId,
                  amount: rt && !rt.free && rt.freeAmount ? r.freeAmount : undefined,
                  firstName: r.firstName.trim(), lastName: r.lastName.trim(),
                  birthDate: r.birthDate.trim() || undefined, phone: r.phone.trim() || undefined, mobile: r.mobile.trim() || undefined,
                  sexe: r.sexe || undefined, spokenLanguage: r.spokenLanguage || undefined, address: r.address.trim() || undefined,
                  photoUrl: r.photoUrl || undefined, answers: r.answers,
                }
              }),
            ],
            email:    email.trim(),
            password: willBeImmediate ? password : undefined,
            website,
            conditionsAgreed,
            locale:   loc,
            // Jamais rattaché à un registrant précis — toujours attribué en entier au
            // registrant 0 une fois consommé (voir consumeMembershipCheckoutDraft).
            products: Object.entries(productQuantities)
              .filter(([, quantity]) => quantity > 0)
              .map(([varianteId, quantity]) => ({ varianteId, quantity })),
          }
        : {
            tierId,
            paymentMethod: needsPayment ? paymentMethod : undefined,
            amount: !selectedTier.free && selectedTier.freeAmount ? membershipAmount : undefined,
            payInInstallments: canPayInInstallments && payInInstallments ? true : undefined,
            locale: loc,
            addons: selectedExtras.map(x => ({ tierId: x.id, amount: x.freeAmount ? (extraAmounts[x.id] ?? 0) : undefined })),
            products: Object.entries(productQuantities)
              .filter(([, quantity]) => quantity > 0)
              .map(([varianteId, quantity]) => ({ varianteId, quantity })),
            firstName: firstName.trim(),
            lastName:  lastName.trim(),
            email:     email.trim(),
            password:  willBeImmediate ? password : undefined,
            address:   address.trim() || undefined,
            birthDate: birthDate.trim() || undefined,
            phone:     phone.trim() || undefined,
            mobile:    mobile.trim() || undefined,
            sexe:      sexe || undefined,
            spokenLanguage: spokenLanguage || undefined,
            photoUrl:  photoUrl || undefined,
            answers,
            website,
            conditionsAgreed,
          }

      const res = await fetch(`/api/public/${slug}/adhesion/${formSlug}/checkout`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? t("genericError"))
        // Covers "stock insuffisant" among other re-validated-server-side rejections — the
        // form's own numbers (product stock, but also tier/addon state) could be stale by
        // now, so a bare retry would otherwise just repeat the same error.
        refreshProductsStock()
        return
      }
      if (data.url) { window.location.href = data.url; return }
      if (data.offline) { setOutcome("offline"); return }
      if (data.immediate) { setOutcome("immediate"); return }
      if (data.pending) { setOutcome("pending"); return }
    } catch {
      toast.error(t("errorNetwork"))
    } finally {
      setLoading(false)
    }
  }

  if (form === undefined) {
    return (
      <>
        {showInAppBrowserBanner && <InAppBrowserBanner>{t("inAppBrowserWarning")}</InAppBrowserBanner>}
        <div className="dashboard-canvas public-canvas min-h-screen p-3">
          <div className="min-h-[calc(100vh-1.5rem)] rounded-[10px] bg-public-panel flex items-center justify-center" />
        </div>
      </>
    )
  }

  if (form === null) {
    return (
      <>
        {showInAppBrowserBanner && <InAppBrowserBanner>{t("inAppBrowserWarning")}</InAppBrowserBanner>}
        <div className="dashboard-canvas public-canvas min-h-screen p-3">
          <div className="min-h-[calc(100vh-1.5rem)] rounded-[10px] bg-public-panel flex flex-col items-center justify-center text-center px-4 gap-4">
            <p className="text-muted-foreground">{t("notFound")}</p>
            <LocaleSwitcher />
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      {showInAppBrowserBanner && <InAppBrowserBanner>{t("inAppBrowserWarning")}</InAppBrowserBanner>}
      <div className="dashboard-canvas public-canvas min-h-screen p-3">
        <div className="min-h-[calc(100vh-1.5rem)] rounded-[10px] bg-public-panel flex items-start justify-center py-12 px-4">
          <div className="w-full max-w-md space-y-6">
            <div className="flex justify-end">
              <LocaleSwitcher />
            </div>

            {isPreview && (
              <p className="rounded-md border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
                {t("previewNotice")}
              </p>
            )}

            {form.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.imageUrl} alt={form.title} className="w-full max-h-64 object-cover rounded-lg" />
            )}

            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center size-12 rounded-full bg-primary/10 dark:bg-primary/20 mb-2">
                <IdentificationCardIcon className="size-6 text-primary" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">{form.title}</h1>
              <p className="text-muted-foreground text-sm">{form.associationName}</p>
            </div>

            {form.description && (
              <div className="rounded-lg border bg-card p-4 text-sm">
                <RichTextView content={form.description} className="text-foreground/90" />
              </div>
            )}

            {outcome ? (
              <div className="rounded-lg border bg-card p-6 text-center text-sm space-y-1">
                <p className="font-medium">
                  {outcome === "pending" ? t("submittedRequestTitle") : t("submittedTitle")}
                </p>
                <p className="text-muted-foreground">
                  {outcome === "pending"
                    ? (form.confirmationMessage || t("submittedRequestBody"))
                    : (form.confirmationMessage || t("submittedWithPayment"))}
                </p>
                {outcome === "offline" && form.offlineInstructions && (
                  <p className="text-muted-foreground pt-2 border-t mt-3">{form.offlineInstructions}</p>
                )}
              </div>
            ) : form.notOpenYet ? (
              <p className="text-center text-sm text-muted-foreground">{t("notOpenYet")}</p>
            ) : form.closed ? (
              <p className="text-center text-sm text-muted-foreground">{t("closed")}</p>
            ) : membershipTiers.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">{t("noTiers")}</p>
            ) : !hasAnyPaymentMethod ? (
              <p className="text-center text-sm text-muted-foreground">{t("paymentUnavailable")}</p>
            ) : (
              <form onSubmit={handleSubmit} className="rounded-lg border bg-card p-4 space-y-4">
                {/* Honeypot — jamais visible pour un vrai visiteur */}
                <div className="absolute -left-[9999px]" aria-hidden>
                  <label htmlFor="website">{t("honeypotLabel")}</label>
                  <input id="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
                </div>

                <div className="space-y-2">
                  {isMulti && <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("registrantLabel", { number: 1 })}</p>}
                  <p className="text-sm font-medium">{t("amountLabel")}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {membershipTiers.map(tier => {
                      // Une adhésion groupée ne peut pas s'appuyer sur un tarif récurrent — un
                      // Stripe Subscription est lié à un seul Membre, impossible à répartir
                      // entre N personnes (voir checkout/route.ts).
                      const disabled = isMulti && tier.kind === "RECURRING"
                      return (
                      <button
                        key={tier.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => { setTierId(tier.id); if (tier.free || tier.kind === "RECURRING") setPaymentMethod("STRIPE") }}
                        className={cn(
                          "rounded-md border px-3 py-2 text-sm font-medium transition-colors text-left",
                          disabled ? "opacity-40 cursor-not-allowed" :
                          tierId === tier.id ? "border-primary bg-primary/5 text-primary" : "hover:border-foreground/40",
                        )}
                      >
                        <div>{tier.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {tier.free ? t("freeLabel") : !tier.freeAmount && Number(tier.amount).toLocaleString(loc, { style: "currency", currency: "EUR" })}
                          {tier.kind === "RECURRING" && ` ${recurringSuffix(tier)}`}
                        </div>
                        {oneOffDurationSuffix(tier) && (
                          <div className="text-xs text-muted-foreground">{oneOffDurationSuffix(tier)}</div>
                        )}
                      </button>
                      )
                    })}
                  </div>
                  {selectedTier && !selectedTier.free && selectedTier.freeAmount && (
                    <CurrencyField label={t("freeAmountLabel")} value={freeAmount} onChange={setFreeAmount} />
                  )}
                  {selectedTier?.receiptMode === "PARTIAL" && selectedTier.deductibleAmount && (
                    <p className="text-xs text-muted-foreground">
                      {t("partialReceiptNotice", {
                        amount: Number(selectedTier.deductibleAmount).toLocaleString(loc, { style: "currency", currency: "EUR" }),
                      })}
                    </p>
                  )}
                  {canPayInInstallments && selectedTier && (
                    <CheckboxField
                      label={t("payInInstallmentsLabel", {
                        count: selectedTier.installmentsCount ?? 0,
                        amount: (Number(selectedTier.amount) / (selectedTier.installmentsCount ?? 1)).toLocaleString(loc, { style: "currency", currency: "EUR" }),
                      })}
                      checked={payInInstallments}
                      onChange={e => setPayInInstallments(e.target.checked)}
                    />
                  )}
                </div>

                {extraRegistrants.map((r, idx) => {
                  const rt = registrantTier(r)
                  return (
                    <div key={r.key} className="space-y-3 rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{t("registrantLabel", { number: idx + 2 })}</p>
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeRegistrant(r.key)} aria-label={t("removeRegistrant")}>
                          <TrashIcon className="size-4" />
                        </Button>
                      </div>
                      <SelectField
                        label={t("amountLabel")}
                        options={oneOffMembershipTiers.map(x => ({
                          value: x.id,
                          label: x.free
                            ? `${x.label} — ${t("freeLabel")}`
                            : x.freeAmount ? x.label : `${x.label} — ${Number(x.amount).toLocaleString(loc, { style: "currency", currency: "EUR" })}`,
                        }))}
                        value={r.tierId}
                        onValueChange={v => updateRegistrant(r.key, { tierId: v })}
                      />
                      {rt && !rt.free && rt.freeAmount && (
                        <>
                          <CurrencyField label={t("freeAmountLabel")} value={r.freeAmount} onChange={v => updateRegistrant(r.key, { freeAmount: v })} />
                          {registrantAmount(r) < tierMinimum(rt) && (
                            <p className="text-xs text-destructive">
                              {t("belowMinimumAmount", { amount: tierMinimum(rt).toLocaleString(loc, { style: "currency", currency: "EUR" }) })}
                            </p>
                          )}
                        </>
                      )}
                      {rt?.receiptMode === "PARTIAL" && rt.deductibleAmount && (
                        <p className="text-xs text-muted-foreground">
                          {t("partialReceiptNotice", {
                            amount: Number(rt.deductibleAmount).toLocaleString(loc, { style: "currency", currency: "EUR" }),
                          })}
                        </p>
                      )}
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <FormField label={t("firstNameLabel")} required value={r.firstName} onChange={e => updateRegistrant(r.key, { firstName: e.target.value })} />
                        <FormField label={t("lastNameLabel")} required value={r.lastName} onChange={e => updateRegistrant(r.key, { lastName: e.target.value })} />
                      </div>
                      {form.fieldPhoto !== "HIDDEN" && (
                        <div className="flex justify-center">
                          <ImageUpload
                            value={r.photoUrl}
                            onChange={v => updateRegistrant(r.key, { photoUrl: v })}
                            aspectRatio="square"
                            className="w-32"
                            compact
                            uploadUrl={`/api/public/${slug}/adhesion/${formSlug}/photo`}
                          />
                        </div>
                      )}
                      {form.fieldAddress !== "HIDDEN" && (
                        <FormField label={t("addressLabel")} required={form.fieldAddress === "REQUIRED"} value={r.address} onChange={e => updateRegistrant(r.key, { address: e.target.value })} />
                      )}
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {form.fieldBirthDate !== "HIDDEN" && (
                          <FormField label={t("birthDateLabel")} type="date" required={form.fieldBirthDate === "REQUIRED"} value={r.birthDate} onChange={e => updateRegistrant(r.key, { birthDate: e.target.value })} />
                        )}
                        {form.fieldGender !== "HIDDEN" && (
                          <SelectField
                            label={t("genderLabel")}
                            required={form.fieldGender === "REQUIRED"}
                            options={[
                              { value: "",       label: t("genderNone") },
                              { value: "HOMME",  label: t("genderHomme") },
                              { value: "FEMME",  label: t("genderFemme") },
                            ]}
                            value={r.sexe}
                            onValueChange={v => updateRegistrant(r.key, { sexe: v as "" | "HOMME" | "FEMME" })}
                          />
                        )}
                        {form.fieldLanguage !== "HIDDEN" && (
                          <SelectField
                            label={t("languageLabel")}
                            required={form.fieldLanguage === "REQUIRED"}
                            options={[{ value: "", label: t("languageNone") }, ...languageOptions]}
                            value={r.spokenLanguage}
                            onValueChange={v => updateRegistrant(r.key, { spokenLanguage: v })}
                          />
                        )}
                        {form.fieldPhone !== "HIDDEN" && (
                          <FormField label={t("phoneLabel")} required={form.fieldPhone === "REQUIRED"} value={r.phone} onChange={e => updateRegistrant(r.key, { phone: e.target.value })} />
                        )}
                        {form.fieldMobile !== "HIDDEN" && (
                          <FormField label={t("mobileLabel")} required={form.fieldMobile === "REQUIRED"} value={r.mobile} onChange={e => updateRegistrant(r.key, { mobile: e.target.value })} />
                        )}
                      </div>
                      {form.customFields.map(field => (
                        <FormField
                          key={field.id}
                          label={field.label}
                          required={field.required}
                          type={field.type === "NUMBER" ? "number" : "text"}
                          value={r.answers[field.id] ?? ""}
                          onChange={e => updateRegistrant(r.key, { answers: { ...r.answers, [field.id]: e.target.value } })}
                        />
                      ))}
                    </div>
                  )
                })}

                {canAddRegistrant && (
                  <Button type="button" variant="outline" size="sm" onClick={addRegistrant}>
                    <PlusIcon className="mr-1.5 size-4" />
                    {t("addRegistrant")}
                  </Button>
                )}

                {!isMulti && extraTiers.length > 0 && (
                  <div className="space-y-2 border-t pt-4">
                    <p className="text-sm font-medium">{t("extrasLabel")}</p>
                    <div className="space-y-2">
                      {extraTiers.map(extra => {
                        const checked = selectedExtraIds.has(extra.id)
                        return (
                          <div key={extra.id} className="space-y-1.5">
                            <label className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer hover:border-foreground/40">
                              <span className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={e => setSelectedExtraIds(prev => {
                                    const next = new Set(prev)
                                    if (e.target.checked) next.add(extra.id); else next.delete(extra.id)
                                    return next
                                  })}
                                />
                                {extra.label}
                                {extra.itemType === "DONATION" && (
                                  <span className="text-xs text-muted-foreground">{t("donationBadge")}</span>
                                )}
                              </span>
                              {!extra.freeAmount && (
                                <span className="text-muted-foreground">
                                  {Number(extra.amount).toLocaleString(loc, { style: "currency", currency: "EUR" })}
                                </span>
                              )}
                            </label>
                            {checked && extra.freeAmount && (
                              <>
                                <CurrencyField
                                  label={extra.itemType === "DONATION" ? t("freeAmountLabel") : t("amountLabel")}
                                  value={extraAmounts[extra.id] ?? tierMinimum(extra)}
                                  onChange={v => setExtraAmounts(prev => ({ ...prev, [extra.id]: v }))}
                                />
                                {(extraAmounts[extra.id] ?? tierMinimum(extra)) < tierMinimum(extra) && (
                                  <p className="text-xs text-destructive">
                                    {t("belowExtraMinimum", {
                                      label: extra.label,
                                      amount: tierMinimum(extra).toLocaleString(loc, { style: "currency", currency: "EUR" }),
                                    })}
                                  </p>
                                )}
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {isMulti && <p className="text-xs text-muted-foreground border-t pt-3">{t("sharedAccountHint")}</p>}
                {form.fieldPhoto !== "HIDDEN" && (
                  <div className="flex justify-center">
                    <ImageUpload
                      value={photoUrl}
                      onChange={setPhotoUrl}
                      aspectRatio="square"
                      className="w-32"
                      compact
                      uploadUrl={`/api/public/${slug}/adhesion/${formSlug}/photo`}
                    />
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField label={t("firstNameLabel")} required value={firstName} onChange={e => setFirstName(e.target.value)} />
                  <FormField label={t("lastNameLabel")} required value={lastName} onChange={e => setLastName(e.target.value)} />
                </div>
                <FormField label={t("emailLabel")} type="email" required value={email} onChange={e => setEmail(e.target.value)} />
                {willBeImmediate && (
                  <FormField
                    label={t("passwordLabel")}
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    hint={t("passwordHint")}
                  />
                )}

                {form.fieldAddress !== "HIDDEN" && (
                  <FormField label={t("addressLabel")} required={form.fieldAddress === "REQUIRED"} value={address} onChange={e => setAddress(e.target.value)} />
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {form.fieldBirthDate !== "HIDDEN" && (
                    <FormField label={t("birthDateLabel")} type="date" required={form.fieldBirthDate === "REQUIRED"} value={birthDate} onChange={e => setBirthDate(e.target.value)} />
                  )}
                  {form.fieldGender !== "HIDDEN" && (
                    <SelectField
                      label={t("genderLabel")}
                      required={form.fieldGender === "REQUIRED"}
                      options={[
                        { value: "",       label: t("genderNone") },
                        { value: "HOMME",  label: t("genderHomme") },
                        { value: "FEMME",  label: t("genderFemme") },
                      ]}
                      value={sexe}
                      onValueChange={v => setSexe(v as "" | "HOMME" | "FEMME")}
                    />
                  )}
                  {form.fieldLanguage !== "HIDDEN" && (
                    <SelectField
                      label={t("languageLabel")}
                      required={form.fieldLanguage === "REQUIRED"}
                      options={[{ value: "", label: t("languageNone") }, ...languageOptions]}
                      value={spokenLanguage}
                      onValueChange={setSpokenLanguage}
                    />
                  )}
                  {form.fieldPhone !== "HIDDEN" && (
                    <FormField label={t("phoneLabel")} required={form.fieldPhone === "REQUIRED"} value={phone} onChange={e => setPhone(e.target.value)} />
                  )}
                  {form.fieldMobile !== "HIDDEN" && (
                    <FormField label={t("mobileLabel")} required={form.fieldMobile === "REQUIRED"} value={mobile} onChange={e => setMobile(e.target.value)} />
                  )}
                </div>

                {form.customFields.map(field => (
                  <FormField
                    key={field.id}
                    label={field.label}
                    required={field.required}
                    type={field.type === "NUMBER" ? "number" : "text"}
                    value={answers[field.id] ?? ""}
                    onChange={e => setAnswers(prev => ({ ...prev, [field.id]: e.target.value }))}
                  />
                ))}

                {form.conditions && (
                  <RichTextView content={form.conditions} className="text-xs text-muted-foreground" />
                )}
                {!!form.attachments?.length && (
                  <ul className="space-y-1">
                    {form.attachments.map(a => (
                      <li key={a.url}>
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        >
                          <FileIcon className="size-3.5 shrink-0" />
                          {a.filename}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {form.requireCguvSignature && (
                  <CheckboxField label={t("conditionsAgreeLabel")} checked={conditionsAgreed} onChange={e => setConditionsAgreed(e.target.checked)} />
                )}

                {canBuyProducts && offeredProducts.length > 0 && (
                  <div className="space-y-2 border-t pt-4">
                    <p className="text-sm font-medium">{t("productsLabel")}</p>
                    {isMulti && <p className="text-xs text-muted-foreground">{t("productsMultiHint")}</p>}
                    <div className="space-y-2">
                      {offeredProducts.map(product => {
                        const quantity = productQuantities[product.varianteId] ?? 0
                        return (
                          <div key={product.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                            <div>
                              <div>{product.productName} — {product.variantLabel}</div>
                              <div className="text-xs text-muted-foreground">
                                {(product.price / 100).toLocaleString(loc, { style: "currency", currency: "EUR" })}
                              </div>
                            </div>
                            {product.stock === 0 ? (
                              <span className="text-xs text-muted-foreground">{t("outOfStock")}</span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon-sm"
                                  disabled={quantity === 0}
                                  aria-label={t("decreaseQuantityLabel")}
                                  onClick={() => setProductQuantities(prev => ({ ...prev, [product.varianteId]: Math.max(0, quantity - 1) }))}
                                >
                                  <MinusIcon className="size-3.5" />
                                </Button>
                                <span className="w-4 text-center tabular-nums">{quantity}</span>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon-sm"
                                  disabled={quantity >= product.stock}
                                  aria-label={t("increaseQuantityLabel")}
                                  onClick={() => setProductQuantities(prev => ({ ...prev, [product.varianteId]: Math.min(product.stock, quantity + 1) }))}
                                >
                                  <PlusIcon className="size-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {needsPayment && (
                  <div className="flex items-center justify-between text-sm font-medium border-t pt-3">
                    <span>{t("totalLabel")}</span>
                    <span className="tabular-nums">{amount.toLocaleString(loc, { style: "currency", currency: "EUR" })}</span>
                  </div>
                )}
                {belowMinimum && (
                  <p className="text-xs text-destructive">
                    {t("belowMinimumAmount", { amount: MIN_AMOUNT.toLocaleString(loc, { style: "currency", currency: "EUR" }) })}
                  </p>
                )}

                {showOfflineChoice && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">{t("paymentMethodLabel")}</p>
                    <div className="flex flex-wrap gap-3 text-sm">
                      {form.paymentEnabled && (
                        <label className="flex items-center gap-1.5">
                          <input type="radio" checked={paymentMethod === "STRIPE"} onChange={() => setPaymentMethod("STRIPE")} />
                          {t("paymentMethodStripe")}
                        </label>
                      )}
                      {offlineMethods.map(m => (
                        <label key={m} className="flex items-center gap-1.5">
                          <input type="radio" checked={paymentMethod === m} onChange={() => setPaymentMethod(m)} />
                          {m === "ESPECES" ? t("paymentMethodCash") : m === "CHEQUE" ? t("paymentMethodCheque") : t("paymentMethodTransfer")}
                        </label>
                      ))}
                    </div>
                    {paymentMethod !== "STRIPE" && form.offlineInstructions && (
                      <p className="text-xs text-muted-foreground">{form.offlineInstructions}</p>
                    )}
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={!canSubmit} loading={loading}>
                  {!needsPayment
                    ? (form.validationMode === "IMMEDIATE" ? t("submitImmediateFree") : t("submitFree"))
                    : t("submitPay", {
                        amount: `${amount.toLocaleString(loc, { style: "currency", currency: "EUR" })}${selectedTier?.free ? "" : selectedTier?.kind === "RECURRING" ? ` ${recurringSuffix(selectedTier)}` : payInInstallments ? ` ${t("firstInstallmentSuffix")}` : ""}`,
                      })}
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
