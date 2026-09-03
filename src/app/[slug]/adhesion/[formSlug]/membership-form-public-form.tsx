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
import { PasswordRequirements, PASSWORD_MIN_LENGTH } from "@/components/ui/password-requirements"
import { ImageUpload } from "@/components/ui/image-upload"
import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { RichTextView } from "@/components/ui/rich-text-view"
import { TermsModal } from "@/components/public/terms-modal"
import { PublicFormSkeleton } from "@/components/public/public-form-skeleton"
import { spokenLanguageOptions } from "@/lib/languages"
import { InAppBrowserBanner } from "@/components/ui/in-app-browser-banner"
import { useInAppBrowserEscape } from "@/hooks/use-in-app-browser-escape"
import { Label } from "@/components/ui/label"
import { BASE_PATH } from "@/lib/env"
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
  // Montant fixe : déjà calculé côté serveur (montant payé = amount). Montant libre : null —
  // ineligibleAmount brut est utilisé à la place pour recalculer en direct au fur et à mesure
  // de la saisie (voir partialReceiptAmount ci-dessous).
  deductibleAmount: string | null
  ineligibleAmount: string | null
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
  contactEmail: string | null
  contactPhone: string | null
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
// "linkSent" n'existe qu'en mode admin (isAdminFill) : le formulaire n'a rien encaissé,
// il a créé le membre et envoyé le lien de paiement par email.
type SubmitOutcome = "url" | "immediate" | "offline" | "pending" | "linkSent" | null

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
  // Mode admin : un gestionnaire remplit le formulaire À LA PLACE d'un adhérent (entrée
  // « Ajouter » de la page Membres). Même formulaire, mais : pas de mot de passe ni de CGUV
  // (la personne n'est pas là), pas d'options/produits/inscription groupée/échelonné/
  // hors-ligne (le lien de paiement envoyé ne facture que la cotisation), et l'envoi crée le
  // membre + expédie le lien Stripe au lieu d'encaisser (voir admin-registration/route.ts,
  // qui re-vérifie la session et tout le reste côté serveur — ce flag n'est qu'un mode d'UI).
  const isAdminFill  = searchParams.get("admin") === "1"
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
  // Un champ ne vire au rouge qu'une fois quitté, ou après un clic sur le bouton d'envoi
  // désactivé — marquer tout de suite chaque champ requis vide afficherait le formulaire
  // intégralement en rouge à l'arrivée, avant que le visiteur ait fait quoi que ce soit.
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [showAllErrors, setShowAllErrors] = useState(false)
  // Renseigné au blur du champ e-mail par /check-email — le checkout refuse déjà cette adresse
  // avec un 409, mais seulement une fois tout le formulaire rempli (et parfois au retour de
  // Stripe). Prévenir ici évite au visiteur de tout saisir pour rien.
  const [emailTaken, setEmailTaken] = useState(false)
  const [extraRegistrants, setExtraRegistrants] = useState<RegistrantDraft[]>([])

  useEffect(() => {
    // Reset to the loading state on every re-fetch (including a locale switch), not just
    // the first mount — otherwise the previous-locale content stays on screen, unindicated,
    // for however long the translation takes before flipping all at once.
    setForm(undefined)
    fetch(`/api/public/${slug}/adhesion/${formSlug}${isPreview ? "?preview=1" : ""}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: FormInfo | null) => {
        setForm(data)
        const membershipCandidates = (data?.tiers.filter(t => t.itemType === "MEMBERSHIP") ?? [])
          // Mode admin : seuls les tarifs que le lien de paiement sait facturer (one-off,
          // payants) sont proposés — même filtre que membershipTiers plus bas.
          .filter(t => !isAdminFill || (t.kind === "ONE_OFF" && !t.free))
        const hasOffline = !!(data?.allowCash || data?.allowCheque || data?.allowTransfer)
        // Prefer a tier that's actually payable (free, Stripe, or — single-registrant only —
        // an offline method) over whatever happens to be first — otherwise a visitor could land
        // straight on a dead-end "paiement indisponible" tier with no clue another one would work.
        const payable = membershipCandidates.find(t => t.free || data?.paymentEnabled || (t.kind === "ONE_OFF" && hasOffline))
        const firstMembership = payable ?? membershipCandidates[0]
        // Only default the selection on first load — a locale switch re-fetches the same
        // tiers (same ids, translated labels) and shouldn't discard what's already chosen.
        if (firstMembership) setTierId(prev => prev || firstMembership.id)
      })
      .catch(() => setForm(null))
  }, [slug, formSlug, isPreview, isAdminFill, loc])

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

  const membershipTiers = (form?.tiers.filter(t => t.itemType === "MEMBERSHIP") ?? [])
    .filter(t => !isAdminFill || (t.kind === "ONE_OFF" && !t.free))
  // Vider extraTiers en mode admin tue les options/dons embarqués partout d'un coup
  // (selectedExtras/extrasAmount en découlent) — le lien de paiement ne facture que la
  // cotisation elle-même.
  const extraTiers      = isAdminFill ? [] : form?.tiers.filter(t => t.itemType !== "MEMBERSHIP") ?? []
  const selectedTier = membershipTiers.find(x => x.id === tierId) ?? null
  // Offline methods only make sense for a one-off charge — a cheque doesn't arrive on its own
  // every year. Never available in multi-registrant mode (Stripe-only, see checkout/route.ts).
  const offlineMethods = (["ESPECES", "CHEQUE", "VIREMENT"] as const).filter(m =>
    m === "ESPECES" ? form?.allowCash : m === "CHEQUE" ? form?.allowCheque : form?.allowTransfer,
  )
  // Whether a given tier has *any* usable payment method in the given mode — a free tier always
  // does, a paid one needs Stripe (both modes) or, single-registrant only, an offline method.
  // isPreview always says yes: canSubmit already forces isPreview off, so a manager previewing
  // the form can't get stuck mid-submit and should be able to see every section regardless of
  // whether Stripe/offline is configured yet. Used to keep tier pickers from ever offering (or
  // silently defaulting a new registrant to) a choice that would leave the visitor with no way
  // to pay — instead of reacting after the fact by hiding the whole form.
  const isTierPayable = (tier: Tier, multi: boolean) =>
    // Mode admin : le lien envoyé passe forcément par Stripe — les méthodes hors-ligne ne
    // comptent pas comme « payable » ici.
    isAdminFill ? !!form?.paymentEnabled :
    tier.free || isPreview || (multi ? !!form?.paymentEnabled : !!(form?.paymentEnabled || (tier.kind === "ONE_OFF" && offlineMethods.length > 0)))
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
  // Montant réellement éligible au reçu fiscal pour un tarif "Sim, parcialmente" — déjà
  // calculé côté serveur pour un montant fixe (deductibleAmount), recalculé en direct ici pour
  // un montant libre (ineligibleAmount brut) puisque le montant payé n'est connu qu'au moment
  // de la saisie (voir eligibleReceiptAmount côté serveur).
  const partialReceiptAmount = (x: Tier, paidAmount: number): number | null => {
    if (x.receiptMode !== "PARTIAL") return null
    if (x.freeAmount) return x.ineligibleAmount != null ? Math.max(0, paidAmount - Number(x.ineligibleAmount)) : null
    return x.deductibleAmount != null ? Number(x.deductibleAmount) : null
  }
  // Un montant libre payé en dessous de la part non éligible donnerait un reçu à montant
  // négatif — le serveur le refuse déjà (voir checkout/route.ts), mais sans ce même contrôle
  // ici le visiteur ne le découvrirait qu'après avoir rempli tout le formulaire.
  const belowIneligible = (x: Tier, paidAmount: number): boolean =>
    x.freeAmount && x.receiptMode === "PARTIAL" && x.ineligibleAmount != null && paidAmount < Number(x.ineligibleAmount)
  const selectedExtras = extraTiers.filter(x => selectedExtraIds.has(x.id))
  // Fallback 0, never tierMinimum: an untouched free-amount extra has NOT been filled in, and
  // handleSubmit already sends `?? 0` for it. Defaulting to the minimum here made the running
  // total (and extraBelowMinimum below) disagree with what was actually posted — the visitor
  // saw a valid 1,00 € and a matching total, then got the server's "Montant invalide" back.
  const extrasAmount = selectedExtras.reduce((sum, x) => sum + (x.freeAmount ? (extraAmounts[x.id] ?? 0) : Number(x.amount ?? 0)), 0)
  const extraBelowMinimum = selectedExtras.find(x => x.freeAmount && (extraAmounts[x.id] ?? 0) < tierMinimum(x))

  // ─── Inscription groupée (N ≥ 2 "Adhérent") ─────────────────────────────────────
  // No addons/donation embarquée and no RECURRING tier in this mode — see checkout/route.ts's
  // own scoping note (a Stripe Subscription can't be split across N people). Registrant 0 is
  // always the person filling out the form, reusing every state variable above; this only
  // covers the extra blocks added via "Ajouter un autre adhérent".
  const oneOffMembershipTiers = membershipTiers.filter(x => x.kind === "ONE_OFF")
  // The only tiers ever safe to assign to an extra registrant, or to default a newly-added one
  // to — anything else would need an offline method that doesn't exist once isMulti is true.
  const multiUsableTiers = oneOffMembershipTiers.filter(x => isTierPayable(x, true))
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
  const canBuyProducts = !isAdminFill && !!selectedTier && selectedTier.kind === "ONE_OFF" && !payInInstallments
  const offeredProducts = isAdminFill ? [] : form?.products ?? []
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
  const registrantBelowIneligible = extraRegistrants.find(r => {
    const rt = registrantTier(r)
    return !!rt && belowIneligible(rt, registrantAmount(r))
  })
  // Requires selectedTier itself to already be multi-payable (isTierPayable(…, true)) — a tier
  // that's only payable offline (single-registrant mode) must not let the visitor into isMulti,
  // since it would instantly become unpayable the moment it flips on. Also requires at least one
  // multiUsableTiers entry so there's something valid to default a newly-added registrant to —
  // a form with only offline-paid tiers and no Stripe simply doesn't offer this feature.
  const canAddRegistrant = !isAdminFill && (!isMulti
    ? !!selectedTier && selectedTier.kind === "ONE_OFF" && isTierPayable(selectedTier, true) && multiUsableTiers.length > 0
    : extraRegistrants.length + 1 < MAX_REGISTRANTS && multiUsableTiers.length > 0)

  // extrasAmount counts in both modes: an option or an embedded donation belongs to the
  // submission, not to one person, so a group buying one owes exactly what a lone member would.
  const amount = (isMulti ? extraRegistrantsAmount : 0) + membershipAmount + extrasAmount + productsAmount
  // A paid membership tier is always immediate as soon as payment is confirmed; so is any
  // paid extra/registrant riding along with an otherwise-free membership (there's nothing
  // sensible to "hold for approval" once money changed hands) — mirrors willBeImmediate in
  // checkout/route.ts (both the single- and multi-registrant branches).
  const willBeImmediate = !!selectedTier && (amount > 0 || form?.validationMode === "IMMEDIATE")

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
  const canPayInInstallments = !isAdminFill && !isMulti && !!selectedTier && selectedTier.installmentsAllowed && extrasAmount === 0 && !hasProductsSelected
  const showOfflineChoice = !isAdminFill && !isMulti && !!selectedTier && needsPayment && selectedTier.kind === "ONE_OFF" && offlineMethods.length > 0 && extrasAmount === 0 && !hasProductsSelected && !payInInstallments
  // Safety net, not the primary guard — canAddRegistrant/isTierPayable already keep every tier
  // picker (registrant 0's buttons, each extra registrant's select) from ever landing on a tier
  // that isn't payable in the current mode. This still matters for the tier a visitor lands on
  // by default (form.notOpenYet aside, the very first membership tier fetched) when literally
  // nothing on the form has a working payment method — a real admin misconfiguration, not
  // something reachable through normal interaction anymore.
  const hasAnyPaymentMethod = !selectedTier || !needsPayment || isTierPayable(selectedTier, isMulti)

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
    const defaultTier = multiUsableTiers[0]
    // Options et dons embarqués survivent au passage en inscription groupée : comme les
    // produits Boutique, ils appartiennent à la soumission et sont attribués en entier au
    // registrant 0 (voir consumeMembershipCheckoutDraft). Ils étaient vidés ici tant que le
    // checkout groupé ne savait pas les facturer — cocher « Faire un don » puis ajouter un
    // second adhérent faisait disparaître le don sans rien dire.
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

  const touch = (name: string) =>
    setTouched(prev => (prev.has(name) ? prev : new Set(prev).add(name)))
  // Visible une fois le champ quitté, ou après une tentative d'envoi — jamais avant.
  const showsError = (name: string) => showAllErrors || touched.has(name)
  // `required` reprend la matrice de champs du formulaire : un champ OPTIONAL laissé vide
  // n'est pas une erreur et ne doit donc jamais rougir.
  const requiredError = (name: string, value: string, required = true) =>
    required && !value.trim() && showsError(name) ? t("fieldRequired") : undefined

  // ImageUpload n'a pas de blur : ces deux-là n'apparaissent donc qu'après une tentative
  // d'envoi (showAllErrors), ce qui est exactement le moment où le visiteur cherche ce qui
  // manque.
  const photoError = requiredError("photo", photoUrl, form?.fieldPhoto === "REQUIRED")
  const registrantPhotoError = (r: RegistrantDraft) =>
    requiredError(`${r.key}.photo`, r.photoUrl, form?.fieldPhoto === "REQUIRED")

  async function checkEmailTaken() {
    touch("email")
    const value = email.trim()
    if (!emailValid(value)) { setEmailTaken(false); return }
    try {
      const res = await fetch(
        `/api/public/${slug}/adhesion/${formSlug}/check-email?email=${encodeURIComponent(value)}`,
      )
      if (!res.ok) { setEmailTaken(false); return }
      setEmailTaken(!!(await res.json()).exists)
    } catch {
      // Purement informatif : le checkout revalide de toute façon. Une coupure réseau ne doit
      // pas afficher un faux « déjà adhérent » ni bloquer la saisie.
      setEmailTaken(false)
    }
  }
  const belowMinimum = needsPayment && paymentMethod === "STRIPE" && amount < MIN_AMOUNT
  // Le tarif principal peut configurer son propre minimum (montant libre) — même garde-fou
  // que les extras/inscrits supplémentaires (extraBelowMinimum/registrantBelowMinimum), qui
  // eux le respectent déjà.
  const membershipBelowMinimum = !!selectedTier && !selectedTier.free && selectedTier.freeAmount && membershipAmount < tierMinimum(selectedTier)
  const membershipBelowIneligible = !!selectedTier && belowIneligible(selectedTier, membershipAmount)
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
    (!isMulti || (!registrantBelowMinimum && !registrantBelowIneligible && extraRegistrants.every(registrantValid))) &&
    !extraBelowMinimum &&
    (!needsPayment || (
      !belowMinimum && !membershipBelowMinimum && !membershipBelowIneligible &&
      (paymentMethod === "STRIPE" ? form.paymentEnabled : selectedTier.kind === "ONE_OFF")
    )) &&
    firstName.trim() && lastName.trim() && emailValid(email) &&
    // Mode admin : la personne n'est pas là pour choisir un mot de passe (son compte n'est
    // créé qu'au paiement) ni pour accepter les CGUV.
    (!willBeImmediate || isAdminFill || password.length >= PASSWORD_MIN_LENGTH) &&
    (form.fieldAddress   !== "REQUIRED" || address.trim()) &&
    (form.fieldBirthDate !== "REQUIRED" || birthDate.trim()) &&
    (form.fieldPhone     !== "REQUIRED" || phone.trim()) &&
    (form.fieldMobile    !== "REQUIRED" || mobile.trim()) &&
    (form.fieldGender    !== "REQUIRED" || sexe) &&
    (form.fieldLanguage  !== "REQUIRED" || !!spokenLanguage) &&
    (form.fieldPhoto     !== "REQUIRED" || photoUrl) &&
    (!form.requireCguvSignature || isAdminFill || conditionsAgreed) &&
    form.customFields.every(f => !f.required || (answers[f.id] ?? "").trim() !== "")

  // Same numbering the registrant cards themselves use (registrantLabel: idx + 2, since
  // registrant 0 is always "Membre 1" — the person filling out the form).
  const invalidRegistrantIndex = isMulti ? extraRegistrants.findIndex(r => !registrantValid(r)) : -1
  const belowMinimumRegistrantIndex = registrantBelowMinimum ? extraRegistrants.indexOf(registrantBelowMinimum) : -1

  // Mirrors canSubmit's own checks, in priority order, but surfaces *why* the button is
  // disabled instead of leaving the visitor to guess — a disabled <button> fires no click/
  // submit event at all, so without this there is no way to find out what's wrong short of
  // reading the page source. belowMinimum (the overall Stripe total) is the one exception:
  // its own inline message already sits right above this section, next to the button, so
  // repeating it here would just be noise.
  const blockingReason: string | null = !form ? null
    : isPreview ? t("blockedPreview")
    : !selectedTier ? null // membershipTiers.length === 0 already replaces the whole form with noTiers
    : isMulti && invalidRegistrantIndex !== -1 ? t("blockedRegistrantIncomplete", { number: invalidRegistrantIndex + 2 })
    : isMulti && belowMinimumRegistrantIndex !== -1 ? t("blockedRegistrantBelowMinimum", { number: belowMinimumRegistrantIndex + 2 })
    : needsPayment && paymentMethod === "STRIPE" && !form.paymentEnabled ? t("blockedNoPaymentMethod")
    : needsPayment && paymentMethod !== "STRIPE" && selectedTier.kind !== "ONE_OFF" ? t("blockedNoPaymentMethod")
    : extraBelowMinimum ? t("blockedExtraBelowMinimum", { label: extraBelowMinimum.label })
    : !firstName.trim() || !lastName.trim() ? t("blockedMissingIdentity")
    : !emailValid(email) ? t("blockedInvalidEmail")
    : willBeImmediate && !isAdminFill && password.length < PASSWORD_MIN_LENGTH ? t("blockedPasswordTooShort")
    : form.requireCguvSignature && !isAdminFill && !conditionsAgreed ? t("blockedConditionsNotAccepted")
    : (form.fieldAddress   === "REQUIRED" && !address.trim())
      || (form.fieldBirthDate === "REQUIRED" && !birthDate.trim())
      || (form.fieldPhone     === "REQUIRED" && !phone.trim())
      || (form.fieldMobile    === "REQUIRED" && !mobile.trim())
      || (form.fieldGender    === "REQUIRED" && !sexe)
      || (form.fieldLanguage  === "REQUIRED" && !spokenLanguage)
      || (form.fieldPhoto     === "REQUIRED" && !photoUrl)
      || !form.customFields.every(f => !f.required || (answers[f.id] ?? "").trim() !== "")
    ? t("blockedMissingRequiredField")
    : null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !form || !selectedTier) return

    setLoading(true)
    try {
      // Mode admin : rien n'est encaissé ici — le serveur crée le membre et lui envoie le
      // lien de paiement par email (session gestionnaire re-vérifiée côté serveur).
      if (isAdminFill) {
        const res = await fetch(`/api/membership-forms/${form.id}/admin-registration`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tierId,
            amount: !selectedTier.free && selectedTier.freeAmount ? membershipAmount : undefined,
            firstName: firstName.trim(),
            lastName:  lastName.trim(),
            email:     email.trim(),
            address:   address.trim() || undefined,
            birthDate: birthDate.trim() || undefined,
            phone:     phone.trim() || undefined,
            mobile:    mobile.trim() || undefined,
            sexe:      sexe || undefined,
            spokenLanguage: spokenLanguage || undefined,
            photoUrl:  photoUrl || undefined,
            locale:    loc,
            answers,
          }),
        })
        const data = await res.json()
        if (!res.ok) { toast.error(data.error ?? t("genericError")); return }
        setOutcome("linkSent")
        return
      }

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
            // Ni les options ni les produits ne sont rattachés à un registrant précis —
            // toujours attribués en entier au registrant 0 une fois consommés (voir
            // consumeMembershipCheckoutDraft).
            addons: selectedExtras.map(x => ({ tierId: x.id, amount: x.freeAmount ? (extraAmounts[x.id] ?? 0) : undefined })),
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
          <div className="min-h-[calc(100vh-1.5rem)] rounded-[10px] bg-public-panel flex items-start justify-center py-12 px-4">
            <div className="w-full max-w-md">
              <PublicFormSkeleton />
            </div>
          </div>
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
            <LocaleSwitcher persistAccountLocale={!isPreview} />
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
              <LocaleSwitcher persistAccountLocale={!isPreview} />
            </div>

            {isPreview && (
              <p className="rounded-md border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
                {t("previewNotice")}
              </p>
            )}

            {isAdminFill && !isPreview && (
              <p className="rounded-md border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
                {t("adminFillNotice")}
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
                  {outcome === "linkSent" ? t("adminLinkSentTitle") : outcome === "pending" ? t("submittedRequestTitle") : t("submittedTitle")}
                </p>
                <p className="text-muted-foreground">
                  {outcome === "linkSent"
                    ? t("adminLinkSentBody", { email: email.trim() })
                    : outcome === "pending"
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
                      const recurringInMulti = isMulti && tier.kind === "RECURRING"
                      const noPaymentMethod = !recurringInMulti && !isTierPayable(tier, isMulti)
                      const disabled = recurringInMulti || noPaymentMethod
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
                          {noPaymentMethod ? t("tierUnavailable") :
                            tier.free ? t("freeLabel") : !tier.freeAmount && Number(tier.amount).toLocaleString(loc, { style: "currency", currency: "EUR" })}
                          {!noPaymentMethod && tier.kind === "RECURRING" && ` ${recurringSuffix(tier)}`}
                        </div>
                        {!noPaymentMethod && oneOffDurationSuffix(tier) && (
                          <div className="text-xs text-muted-foreground">{oneOffDurationSuffix(tier)}</div>
                        )}
                      </button>
                      )
                    })}
                  </div>
                  {selectedTier && !selectedTier.free && selectedTier.freeAmount && (
                    <>
                      <CurrencyField
                        label={t("freeAmountLabel")}
                        required
                        placeholder={tierMinimum(selectedTier).toLocaleString(loc, { style: "currency", currency: "EUR" })}
                        value={freeAmount}
                        onChange={setFreeAmount}
                        error={
                          membershipBelowMinimum
                            ? t("belowExtraMinimum", { label: selectedTier.label, amount: tierMinimum(selectedTier).toLocaleString(loc, { style: "currency", currency: "EUR" }) })
                            : membershipBelowIneligible
                            ? t("belowIneligibleAmount", { amount: Number(selectedTier.ineligibleAmount).toLocaleString(loc, { style: "currency", currency: "EUR" }) })
                            : undefined
                        }
                      />
                    </>
                  )}
                  {selectedTier && !membershipBelowIneligible && partialReceiptAmount(selectedTier, membershipAmount) != null && (
                    <p className="text-xs text-muted-foreground">
                      {t("partialReceiptNotice", {
                        amount: partialReceiptAmount(selectedTier, membershipAmount)!.toLocaleString(loc, { style: "currency", currency: "EUR" }),
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

                {extraTiers.length > 0 && (
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
                                  required
                                  placeholder={tierMinimum(extra).toLocaleString(loc, { style: "currency", currency: "EUR" })}
                                  value={extraAmounts[extra.id] ?? 0}
                                  onChange={v => setExtraAmounts(prev => ({ ...prev, [extra.id]: v }))}
                                  error={
                                    (extraAmounts[extra.id] ?? 0) < tierMinimum(extra)
                                      ? t("belowExtraMinimum", {
                                          label: extra.label,
                                          amount: tierMinimum(extra).toLocaleString(loc, { style: "currency", currency: "EUR" }),
                                        })
                                      : undefined
                                  }
                                />
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {isMulti && <p className="text-xs text-muted-foreground border-t pt-3">{t("sharedAccountHint")}</p>}
                {/* ImageUpload n'affiche ni libellé ni astérisque : sans ce cadre, une photo
                    obligatoire bloquait l'envoi avec « Renseignez tous les champs obligatoires
                    signalés ci-dessus » alors que rien, précisément, n'était signalé. */}
                {form.fieldPhoto !== "HIDDEN" && (
                  <div className="flex flex-col items-center gap-1.5">
                    <Label className={cn(photoError && "text-destructive")}>
                      {t("photoLabel")}
                      {form.fieldPhoto === "REQUIRED" && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
                    </Label>
                    <ImageUpload
                      value={photoUrl}
                      onChange={setPhotoUrl}
                      aspectRatio="square"
                      className="w-32"
                      compact
                      invalid={!!photoError}
                      uploadUrl={`/api/public/${slug}/adhesion/${formSlug}/photo${isPreview ? "?preview=1" : ""}`}
                      maxSizeErrorMessage={t("photoTooLarge")}
                      genericErrorMessage={t("photoUploadError")}
                    />
                    {photoError && <p className="text-xs text-destructive">{photoError}</p>}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField label={t("firstNameLabel")} placeholder={t("firstNamePlaceholder")} required value={firstName} onChange={e => setFirstName(e.target.value)} onBlur={() => touch("firstName")} error={requiredError("firstName", firstName)} />
                  <FormField label={t("lastNameLabel")} placeholder={t("lastNamePlaceholder")} required value={lastName} onChange={e => setLastName(e.target.value)} onBlur={() => touch("lastName")} error={requiredError("lastName", lastName)} />
                </div>
                <FormField
                  label={t("emailLabel")}
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  required
                  value={email}
                  onChange={e => { setEmail(e.target.value); setEmailTaken(false) }}
                  onBlur={checkEmailTaken}
                  error={!showsError("email") ? undefined : !email.trim() ? t("fieldRequired") : !emailValid(email) ? t("blockedInvalidEmail") : undefined}
                />
                {/* Un avertissement, pas une erreur : le visiteur peut légitimement continuer
                    (foyer partageant une adresse, homonyme). Ambre plutôt que rouge, et le
                    bouton d'envoi reste actif — c'est le checkout qui tranchera. */}
                {emailTaken && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {isAdminFill ? t("adminEmailAlreadyMember") : (
                      <>
                        {t("emailAlreadyMember")}{" "}
                        <a href={`${BASE_PATH}/portal/${slug}/login`} className="underline underline-offset-2 font-medium">
                          {t("emailAlreadyMemberLogin")}
                        </a>
                      </>
                    )}
                  </p>
                )}
                {willBeImmediate && !isAdminFill && (
                  <div className="space-y-1.5">
                    <FormField
                      label={t("passwordLabel")}
                      type="password"
                      required
                      minLength={PASSWORD_MIN_LENGTH}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      onBlur={() => touch("password")}
                      error={requiredError("password", password)}
                      hint={t("passwordHint")}
                    />
                    <PasswordRequirements
                      title={t("passwordRequirementsTitle")}
                      rules={[{
                        label: t("passwordRuleMinLength", { count: PASSWORD_MIN_LENGTH }),
                        met:   password.length >= PASSWORD_MIN_LENGTH,
                      }]}
                    />
                  </div>
                )}

                {form.fieldAddress !== "HIDDEN" && (
                  <FormField label={t("addressLabel")} placeholder={t("addressPlaceholder")} required={form.fieldAddress === "REQUIRED"} value={address} onChange={e => setAddress(e.target.value)} onBlur={() => touch("address")} error={requiredError("address", address, form.fieldAddress === "REQUIRED")} />
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {form.fieldBirthDate !== "HIDDEN" && (
                    <FormField label={t("birthDateLabel")} type="date" required={form.fieldBirthDate === "REQUIRED"} value={birthDate} onChange={e => setBirthDate(e.target.value)} onBlur={() => touch("birthDate")} error={requiredError("birthDate", birthDate, form.fieldBirthDate === "REQUIRED")} />
                  )}
                  {form.fieldGender !== "HIDDEN" && (
                    <SelectField
                      label={t("genderLabel")}
                      required={form.fieldGender === "REQUIRED"}
                      options={[
                        // Pas d'option vide quand le champ est requis : « Préférer ne pas préciser » vaut ""
                        // et ne satisfait donc jamais l'exigence, alors qu'elle s'affiche comme une réponse
                        // choisie. Sans elle, SelectField retombe sur son placeholder « Choisir… ».
                        ...(form.fieldGender === "REQUIRED" ? [] : [{ value: "", label: t("genderNone") }]),
                        { value: "HOMME",  label: t("genderHomme") },
                        { value: "FEMME",  label: t("genderFemme") },
                      ]}
                      value={sexe}
                      onValueChange={v => setSexe(v as "" | "HOMME" | "FEMME")}
                      error={requiredError("sexe", sexe, form.fieldGender === "REQUIRED")}
                    />
                  )}
                  {form.fieldLanguage !== "HIDDEN" && (
                    <SelectField
                      label={t("languageLabel")}
                      required={form.fieldLanguage === "REQUIRED"}
                      options={form.fieldLanguage === "REQUIRED"
                        ? languageOptions
                        : [{ value: "", label: t("languageNone") }, ...languageOptions]}
                      value={spokenLanguage}
                      onValueChange={setSpokenLanguage}
                      error={requiredError("spokenLanguage", spokenLanguage, form.fieldLanguage === "REQUIRED")}
                    />
                  )}
                  {form.fieldPhone !== "HIDDEN" && (
                    <FormField label={t("phoneLabel")} placeholder={t("phonePlaceholder")} required={form.fieldPhone === "REQUIRED"} value={phone} onChange={e => setPhone(e.target.value)} onBlur={() => touch("phone")} error={requiredError("phone", phone, form.fieldPhone === "REQUIRED")} />
                  )}
                  {form.fieldMobile !== "HIDDEN" && (
                    <FormField label={t("mobileLabel")} placeholder={t("mobilePlaceholder")} required={form.fieldMobile === "REQUIRED"} value={mobile} onChange={e => setMobile(e.target.value)} onBlur={() => touch("mobile")} error={requiredError("mobile", mobile, form.fieldMobile === "REQUIRED")} />
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
                    onBlur={() => touch(field.id)}
                    error={requiredError(field.id, answers[field.id] ?? "", field.required)}
                  />
                ))}

                {/* Adhérents 2..N sit after registrant 1's own details rather than straight
                    under the tarif picker: being asked to add a second person before having
                    given the first one's name read as a step out of order. The block and the
                    button that creates its cards stay together, so a newly added card always
                    appears right where the button is. */}
                {(extraRegistrants.length > 0 || canAddRegistrant) && (
                  <div className="space-y-3 border-t pt-4">
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
                            options={multiUsableTiers.map(x => ({
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
                              <CurrencyField
                                label={t("freeAmountLabel")}
                                required
                                placeholder={tierMinimum(rt).toLocaleString(loc, { style: "currency", currency: "EUR" })}
                                value={r.freeAmount}
                                onChange={v => updateRegistrant(r.key, { freeAmount: v })}
                                error={
                                  registrantAmount(r) < tierMinimum(rt)
                                    ? t("belowExtraMinimum", { label: rt.label, amount: tierMinimum(rt).toLocaleString(loc, { style: "currency", currency: "EUR" }) })
                                    : belowIneligible(rt, registrantAmount(r))
                                    ? t("belowIneligibleAmount", { amount: Number(rt.ineligibleAmount).toLocaleString(loc, { style: "currency", currency: "EUR" }) })
                                    : undefined
                                }
                              />
                            </>
                          )}
                          {rt && !belowIneligible(rt, registrantAmount(r)) && partialReceiptAmount(rt, registrantAmount(r)) != null && (
                            <p className="text-xs text-muted-foreground">
                              {t("partialReceiptNotice", {
                                amount: partialReceiptAmount(rt, registrantAmount(r))!.toLocaleString(loc, { style: "currency", currency: "EUR" }),
                              })}
                            </p>
                          )}
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <FormField label={t("firstNameLabel")} placeholder={t("firstNamePlaceholder")} required value={r.firstName} onChange={e => updateRegistrant(r.key, { firstName: e.target.value })} onBlur={() => touch(`${r.key}.firstName`)} error={requiredError(`${r.key}.firstName`, r.firstName)} />
                            <FormField label={t("lastNameLabel")} placeholder={t("lastNamePlaceholder")} required value={r.lastName} onChange={e => updateRegistrant(r.key, { lastName: e.target.value })} onBlur={() => touch(`${r.key}.lastName`)} error={requiredError(`${r.key}.lastName`, r.lastName)} />
                          </div>
                          {form.fieldPhoto !== "HIDDEN" && (
                            <div className="flex flex-col items-center gap-1.5">
                              <Label className={cn(registrantPhotoError(r) && "text-destructive")}>
                                {t("photoLabel")}
                                {form.fieldPhoto === "REQUIRED" && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
                              </Label>
                              <ImageUpload
                                value={r.photoUrl}
                                onChange={v => updateRegistrant(r.key, { photoUrl: v })}
                                aspectRatio="square"
                                className="w-32"
                                compact
                                invalid={!!registrantPhotoError(r)}
                                uploadUrl={`/api/public/${slug}/adhesion/${formSlug}/photo${isPreview ? "?preview=1" : ""}`}
                                maxSizeErrorMessage={t("photoTooLarge")}
                                genericErrorMessage={t("photoUploadError")}
                              />
                              {registrantPhotoError(r) && <p className="text-xs text-destructive">{registrantPhotoError(r)}</p>}
                            </div>
                          )}
                          {form.fieldAddress !== "HIDDEN" && (
                            <FormField label={t("addressLabel")} placeholder={t("addressPlaceholder")} required={form.fieldAddress === "REQUIRED"} value={r.address} onChange={e => updateRegistrant(r.key, { address: e.target.value })} onBlur={() => touch(`${r.key}.address`)} error={requiredError(`${r.key}.address`, r.address, form.fieldAddress === "REQUIRED")} />
                          )}
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {form.fieldBirthDate !== "HIDDEN" && (
                              <FormField label={t("birthDateLabel")} type="date" required={form.fieldBirthDate === "REQUIRED"} value={r.birthDate} onChange={e => updateRegistrant(r.key, { birthDate: e.target.value })} onBlur={() => touch(`${r.key}.birthDate`)} error={requiredError(`${r.key}.birthDate`, r.birthDate, form.fieldBirthDate === "REQUIRED")} />
                            )}
                            {form.fieldGender !== "HIDDEN" && (
                              <SelectField
                                label={t("genderLabel")}
                                required={form.fieldGender === "REQUIRED"}
                                options={[
                                  // Pas d'option vide quand le champ est requis : « Préférer ne pas préciser » vaut ""
                                  // et ne satisfait donc jamais l'exigence, alors qu'elle s'affiche comme une réponse
                                  // choisie. Sans elle, SelectField retombe sur son placeholder « Choisir… ».
                                  ...(form.fieldGender === "REQUIRED" ? [] : [{ value: "", label: t("genderNone") }]),
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
                                options={form.fieldLanguage === "REQUIRED"
                                  ? languageOptions
                                  : [{ value: "", label: t("languageNone") }, ...languageOptions]}
                                value={r.spokenLanguage}
                                onValueChange={v => updateRegistrant(r.key, { spokenLanguage: v })}
                              />
                            )}
                            {form.fieldPhone !== "HIDDEN" && (
                              <FormField label={t("phoneLabel")} placeholder={t("phonePlaceholder")} required={form.fieldPhone === "REQUIRED"} value={r.phone} onChange={e => updateRegistrant(r.key, { phone: e.target.value })} onBlur={() => touch(`${r.key}.phone`)} error={requiredError(`${r.key}.phone`, r.phone, form.fieldPhone === "REQUIRED")} />
                            )}
                            {form.fieldMobile !== "HIDDEN" && (
                              <FormField label={t("mobileLabel")} placeholder={t("mobilePlaceholder")} required={form.fieldMobile === "REQUIRED"} value={r.mobile} onChange={e => updateRegistrant(r.key, { mobile: e.target.value })} onBlur={() => touch(`${r.key}.mobile`)} error={requiredError(`${r.key}.mobile`, r.mobile, form.fieldMobile === "REQUIRED")} />
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
                              onBlur={() => touch(`${r.key}.${field.id}`)}
                              error={requiredError(`${r.key}.${field.id}`, r.answers[field.id] ?? "", field.required)}
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
                  </div>
                )}

                {form.conditions && (
                  <TermsModal content={form.conditions} triggerLabel={t("viewConditionsLabel")} title={t("conditionsModalTitle")} />
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
                {form.requireCguvSignature && !isAdminFill && (
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

                {!loading && blockingReason && (
                  <p className="text-xs text-destructive text-center">{blockingReason}</p>
                )}

                {/* Le bouton est désactivé tant que le formulaire est incomplet, et un bouton
                    désactivé n'émet aucun clic — c'est ce conteneur qui le reçoit (Button porte
                    `disabled:pointer-events-none`, le clic le traverse) et fait rougir d'un coup
                    tout ce qui manque, y compris les champs jamais visités. */}
                <div onClick={() => { if (!canSubmit) setShowAllErrors(true) }}>
                  <Button type="submit" className="w-full" disabled={!canSubmit} loading={loading}>
                    {isAdminFill
                      ? t("adminSubmitSendLink", { amount: amount.toLocaleString(loc, { style: "currency", currency: "EUR" }) })
                      : !needsPayment
                      ? (form.validationMode === "IMMEDIATE" ? t("submitImmediateFree") : t("submitFree"))
                      : t("submitPay", {
                          amount: `${amount.toLocaleString(loc, { style: "currency", currency: "EUR" })}${selectedTier?.free ? "" : selectedTier?.kind === "RECURRING" ? ` ${recurringSuffix(selectedTier)}` : payInInstallments ? ` ${t("firstInstallmentSuffix")}` : ""}`,
                        })}
                  </Button>
                </div>
              </form>
            )}

            {/* Renseignées à l'étape 1 de l'éditeur, sous « Informations de contact à destination
                des adhérents », dont le hint promet noir sur blanc « Les coordonnées apparaissent
                sur le formulaire en ligne ». L'API les envoyait déjà ; personne ne les affichait.
                Placées hors du bloc conditionnel : c'est justement quand le formulaire est fermé,
                pas encore ouvert ou sans tarif que le visiteur a besoin de joindre quelqu'un. */}
            {(form.contactEmail || form.contactPhone) && (
              <p className="text-center text-xs text-muted-foreground">
                {t("contactHelp")}{" "}
                {form.contactEmail && (
                  <a href={`mailto:${form.contactEmail}`} className="underline underline-offset-2 hover:text-foreground">
                    {form.contactEmail}
                  </a>
                )}
                {form.contactEmail && form.contactPhone && <span aria-hidden> · </span>}
                {form.contactPhone && (
                  <a href={`tel:${form.contactPhone.replace(/\s/g, "")}`} className="underline underline-offset-2 hover:text-foreground">
                    {form.contactPhone}
                  </a>
                )}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
