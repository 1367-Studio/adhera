"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { toast } from "sonner"
import { useTranslations, useLocale } from "next-intl"
import { HandHeartIcon, FileIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { RichTextView } from "@/components/ui/rich-text-view"
import { InAppBrowserBanner } from "@/components/ui/in-app-browser-banner"
import { useInAppBrowserEscape } from "@/hooks/use-in-app-browser-escape"
import { cn } from "@/lib/utils"

type FieldRequirement = "HIDDEN" | "OPTIONAL" | "REQUIRED"
type CustomField = { id: string; type: "TEXT" | "NUMBER"; label: string; required: boolean }
type Tier = {
  id: string; label: string; kind: "ONE_OFF" | "RECURRING"; interval: "MONTH" | "QUARTER" | "YEAR" | null
  freeAmount: boolean; amount: string | null; receiptMode: "NONE" | "FULL" | "PARTIAL"
  deductibleAmount: string | null
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
  fieldAddress: FieldRequirement
  fieldBirthDate: FieldRequirement
  fieldPhone: FieldRequirement
  fieldMobile: FieldRequirement
  fieldGender: FieldRequirement
  confirmationMessage: string | null
  offlineInstructions: string | null
  allowCash: boolean
  allowCheque: boolean
  allowTransfer: boolean
  notOpenYet: boolean
  closed: boolean
  paymentEnabled: boolean
  canIssueTaxReceipts: boolean
  tiers: Tier[]
  customFields: CustomField[]
}

type PaymentMethod = "STRIPE" | "ESPECES" | "CHEQUE" | "VIREMENT"

// Mirrors MIN_DONATION_AMOUNT in checkout/route.ts — Stripe refuses to charge below ~0,50 €
// on EUR cards, 1 € is a round number safely above that floor.
const MIN_DONATION_AMOUNT = 1

type Props = { slug: string; formSlug: string }

export function DonationFormPublicForm(props: Props) {
  return (
    <Suspense fallback={null}>
      <DonationFormPublicFormInner {...props} />
    </Suspense>
  )
}

function DonationFormPublicFormInner({ slug, formSlug }: Props) {
  const t   = useTranslations("donationForms.public")
  const loc = useLocale()
  const searchParams = useSearchParams()
  const isPreview    = searchParams.get("preview") === "1"
  const router        = useRouter()
  const pathname       = usePathname()
  const showInAppBrowserBanner = useInAppBrowserEscape()

  const [form, setForm]         = useState<FormInfo | null | undefined>(undefined) // undefined = loading, null = not found
  const [loading, setLoading]   = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [offlineSubmitted, setOfflineSubmitted] = useState(false)

  const [tierId, setTierId]         = useState("")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("STRIPE")
  const [freeAmount, setFreeAmount] = useState(0)
  const [donorType, setDonorType]   = useState<"INDIVIDUAL" | "COMPANY">("INDIVIDUAL")
  const [firstName, setFirstName]   = useState("")
  const [lastName, setLastName]     = useState("")
  const [companyName, setCompanyName] = useState("")
  const [siret, setSiret]           = useState("")
  const [email, setEmail]           = useState("")
  const [address, setAddress]       = useState("")
  const [birthDate, setBirthDate]   = useState("")
  const [phone, setPhone]           = useState("")
  const [mobile, setMobile]         = useState("")
  const [gender, setGender]         = useState("")
  const [message, setMessage]       = useState("")
  const [anonymous, setAnonymous]   = useState(false)
  const [conditionsAgreed, setConditionsAgreed] = useState(false)
  const [answers, setAnswers]       = useState<Record<string, string>>({})
  const [website, setWebsite]       = useState("") // honeypot

  useEffect(() => {
    fetch(`/api/public/${slug}/dons/${formSlug}${isPreview ? "?preview=1" : ""}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: FormInfo | null) => {
        setForm(data)
        if (data?.tiers.length) setTierId(data.tiers[0].id)
      })
      .catch(() => setForm(null))
  }, [slug, formSlug, isPreview])

  const shownPaymentToast = useRef<string | null>(null)
  useEffect(() => {
    const p = searchParams.get("payment")
    if (!p || shownPaymentToast.current === p) return
    shownPaymentToast.current = p
    if (p === "success") setSubmitted(true)
    if (p === "cancelled") toast.info(t("toastCancelled"))
    router.replace(pathname, { scroll: false })
  }, [searchParams, t, router, pathname])

  const selectedTier = form?.tiers.find(x => x.id === tierId) ?? null
  const amount = selectedTier?.freeAmount ? freeAmount : Number(selectedTier?.amount ?? 0)

  const intervalSuffix = (interval: Tier["interval"]) =>
    interval === "MONTH" ? t("perMonth") : interval === "QUARTER" ? t("perQuarter") : t("perYear")

  // Offline methods only make sense for a one-off gift — a cheque doesn't arrive on its
  // own every month. Falls back to Stripe if a recurring tier is (re)selected while an
  // offline method was picked for an earlier, one-off tier.
  const offlineMethods = (["ESPECES", "CHEQUE", "VIREMENT"] as const).filter(m =>
    m === "ESPECES" ? form?.allowCash : m === "CHEQUE" ? form?.allowCheque : form?.allowTransfer,
  )
  const showOfflineChoice = selectedTier?.kind === "ONE_OFF" && offlineMethods.length > 0
  const hasAnyPaymentMethod = !!form && (form.paymentEnabled || (selectedTier?.kind === "ONE_OFF" && offlineMethods.length > 0))

  const emailValid = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
  // Below Stripe's charge floor — mirrors the server check in checkout/route.ts. Only
  // applies online: a small cash/cheque/transfer gift has no such constraint.
  const belowMinimum = paymentMethod === "STRIPE" && amount > 0 && amount < MIN_DONATION_AMOUNT
  const canSubmit =
    !loading && !isPreview &&
    !!form && !form.notOpenYet && !form.closed &&
    (paymentMethod === "STRIPE" ? form.paymentEnabled : selectedTier?.kind === "ONE_OFF") &&
    !!selectedTier && amount > 0 && !belowMinimum &&
    firstName.trim() && lastName.trim() && emailValid(email) &&
    (donorType !== "COMPANY" || (companyName.trim() && siret.trim())) &&
    (form.fieldAddress   !== "REQUIRED" || address.trim()) &&
    (form.fieldBirthDate !== "REQUIRED" || birthDate.trim()) &&
    (form.fieldPhone     !== "REQUIRED" || phone.trim()) &&
    (form.fieldMobile    !== "REQUIRED" || mobile.trim()) &&
    (form.fieldGender    !== "REQUIRED" || gender.trim()) &&
    (!form.requireCguvSignature || conditionsAgreed) &&
    form.customFields.every(f => !f.required || (answers[f.id] ?? "").trim() !== "")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !form || !selectedTier) return

    setLoading(true)
    try {
      const res = await fetch(`/api/public/${slug}/dons/${formSlug}/checkout`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tierId,
          paymentMethod,
          amount: selectedTier.freeAmount ? amount : undefined,
          donorType,
          firstName: firstName.trim(),
          lastName:  lastName.trim(),
          companyName: donorType === "COMPANY" ? companyName.trim() : undefined,
          siret:       donorType === "COMPANY" ? siret.trim() : undefined,
          email:       email.trim(),
          address:     address.trim() || undefined,
          birthDate:   birthDate.trim() || undefined,
          phone:       phone.trim() || undefined,
          mobile:      mobile.trim() || undefined,
          gender:      gender.trim() || undefined,
          message:     message.trim() || undefined,
          anonymous,
          answers,
          website,
          conditionsAgreed,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? t("genericError"))
        return
      }
      if (data.url) { window.location.href = data.url; return }
      if (data.offline) { setOfflineSubmitted(true); setSubmitted(true); return }
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
        <div className="min-h-screen flex items-center justify-center" />
      </>
    )
  }

  if (form === null) {
    return (
      <>
        {showInAppBrowserBanner && <InAppBrowserBanner>{t("inAppBrowserWarning")}</InAppBrowserBanner>}
        <div className="min-h-screen flex flex-col items-center justify-center text-center px-4 gap-4">
          <p className="text-muted-foreground">{t("notFound")}</p>
          <LocaleSwitcher />
        </div>
      </>
    )
  }

  return (
    <>
      {showInAppBrowserBanner && <InAppBrowserBanner>{t("inAppBrowserWarning")}</InAppBrowserBanner>}
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-start justify-center py-12 px-4">
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
              <HandHeartIcon className="size-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{form.title}</h1>
            <p className="text-muted-foreground text-sm">{form.associationName}</p>
          </div>

          {form.description && (
            <div className="rounded-lg border bg-card p-4 text-sm">
              <RichTextView content={form.description} className="text-foreground/90" />
            </div>
          )}

          {submitted ? (
            <div className="rounded-lg border bg-card p-6 text-center text-sm space-y-1">
              <p className="font-medium">{t("submittedTitle")}</p>
              <p className="text-muted-foreground">{form.confirmationMessage || t("submittedWithEmail")}</p>
              {offlineSubmitted && form.offlineInstructions && (
                <p className="text-muted-foreground pt-2 border-t mt-3">{form.offlineInstructions}</p>
              )}
            </div>
          ) : form.notOpenYet ? (
            <p className="text-center text-sm text-muted-foreground">{t("notOpenYet")}</p>
          ) : form.closed ? (
            <p className="text-center text-sm text-muted-foreground">{t("closed")}</p>
          ) : form.tiers.length === 0 ? (
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
                <p className="text-sm font-medium">{t("amountLabel")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {form.tiers.map(tier => (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() => { setTierId(tier.id); if (tier.kind === "RECURRING") setPaymentMethod("STRIPE") }}
                      className={cn(
                        "rounded-md border px-3 py-2 text-sm font-medium transition-colors text-left",
                        tierId === tier.id ? "border-primary bg-primary/5 text-primary" : "hover:border-foreground/40",
                      )}
                    >
                      <div>{tier.label}</div>
                      {(!tier.freeAmount || tier.kind === "RECURRING") && (
                        <div className="text-xs text-muted-foreground">
                          {!tier.freeAmount && Number(tier.amount).toLocaleString(loc, { style: "currency", currency: "EUR" })}
                          {tier.kind === "RECURRING" && ` ${intervalSuffix(tier.interval)}`}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                {selectedTier?.freeAmount && (
                  <CurrencyField label={t("freeAmountLabel")} value={freeAmount} onChange={setFreeAmount} />
                )}
                {belowMinimum && (
                  <p className="text-xs text-destructive">
                    {t("belowMinimumAmount", {
                      amount: MIN_DONATION_AMOUNT.toLocaleString(loc, { style: "currency", currency: "EUR" }),
                    })}
                  </p>
                )}
                {selectedTier?.receiptMode === "PARTIAL" && selectedTier.deductibleAmount && (
                  <p className="text-xs text-muted-foreground">
                    {t("partialReceiptNotice", {
                      amount: Number(selectedTier.deductibleAmount).toLocaleString(loc, { style: "currency", currency: "EUR" }),
                    })}
                  </p>
                )}
              </div>

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

              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={donorType === "INDIVIDUAL"} onChange={() => setDonorType("INDIVIDUAL")} />
                  {t("donorTypeIndividual")}
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={donorType === "COMPANY"} onChange={() => setDonorType("COMPANY")} />
                  {t("donorTypeCompany")}
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label={t("firstNameLabel")} required value={firstName} onChange={e => setFirstName(e.target.value)} />
                <FormField label={t("lastNameLabel")} required value={lastName} onChange={e => setLastName(e.target.value)} />
              </div>
              {donorType === "COMPANY" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField label={t("companyNameLabel")} required value={companyName} onChange={e => setCompanyName(e.target.value)} />
                  <FormField label={t("siretLabel")} required value={siret} onChange={e => setSiret(e.target.value)} />
                </div>
              )}
              <FormField label={t("emailLabel")} type="email" required value={email} onChange={e => setEmail(e.target.value)} />

              {form.fieldAddress !== "HIDDEN" && (
                <FormField label={t("addressLabel")} required={form.fieldAddress === "REQUIRED"} value={address} onChange={e => setAddress(e.target.value)} />
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {form.fieldBirthDate !== "HIDDEN" && (
                  <FormField label={t("birthDateLabel")} type="date" required={form.fieldBirthDate === "REQUIRED"} value={birthDate} onChange={e => setBirthDate(e.target.value)} />
                )}
                {form.fieldGender !== "HIDDEN" && (
                  <FormField label={t("genderLabel")} required={form.fieldGender === "REQUIRED"} value={gender} onChange={e => setGender(e.target.value)} />
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

              <FormField
                label={t("messageLabel")}
                placeholder={t("messagePlaceholder")}
                value={message}
                onChange={e => setMessage(e.target.value)}
              />

              <CheckboxField label={t("anonymousLabel")} checked={anonymous} onChange={e => setAnonymous(e.target.checked)} />

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

              <Button type="submit" className="w-full" disabled={!canSubmit} loading={loading}>
                {amount > 0
                  ? t("submitWithAmount", {
                      amount: `${amount.toLocaleString(loc, { style: "currency", currency: "EUR" })}${selectedTier?.kind === "RECURRING" ? ` ${intervalSuffix(selectedTier.interval)}` : ""}`,
                    })
                  : t("submitWithAmount", { amount: "" })}
              </Button>
            </form>
          )}
        </div>
      </div>
    </>
  )
}
