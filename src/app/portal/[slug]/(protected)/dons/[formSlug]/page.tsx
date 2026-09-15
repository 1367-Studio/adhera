"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from "react"
import { useParams, useRouter, usePathname, useSearchParams } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { useTranslations, useLocale } from "next-intl"
import { ArrowLeftIcon, HandHeartIcon, FileIcon, InfoIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { DateField } from "@/components/ui/date-field"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { Label } from "@/components/ui/label"
import { SelectField } from "@/components/ui/select-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { RichTextView } from "@/components/ui/rich-text-view"
import { TermsModal } from "@/components/public/terms-modal"
import { PublicFormSkeleton } from "@/components/public/public-form-skeleton"
import { cn } from "@/lib/utils"

type FieldRequirement = "HIDDEN" | "OPTIONAL" | "REQUIRED"
type CustomField = { id: string; type: "TEXT" | "NUMBER" | "SELECT" | "RADIO" | "CHECKBOX_MULTI"; label: string; required: boolean; options: string[] | null }
type AnswerValue = string | string[]
type Tier = {
  id: string; label: string; kind: "ONE_OFF" | "RECURRING"; interval: "MONTH" | "QUARTER" | "YEAR" | null
  freeAmount: boolean; amount: string | null; receiptMode: "NONE" | "FULL" | "PARTIAL"
  deductibleAmount: string | null
  ineligibleAmount: string | null
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
  member: { firstName: string; lastName: string; email: string; address: string; phone: string }
}

type PaymentMethod = "STRIPE" | "ESPECES" | "CHEQUE" | "VIREMENT"

// Mirrors MIN_DONATION_AMOUNT in the checkout route.
const MIN_DONATION_AMOUNT = 1

export default function PortalDonationFormPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-md mx-auto py-8"><PublicFormSkeleton /></div>}>
      <PortalDonationFormInner />
    </Suspense>
  )
}

function PortalDonationFormInner() {
  const t   = useTranslations("donationForms.public")
  const tp  = useTranslations("portalMembre.dons")
  const loc = useLocale()
  const { slug, formSlug } = useParams<{ slug: string; formSlug: string }>()
  const router      = useRouter()
  const pathname    = usePathname()
  const searchParams = useSearchParams()

  const [form, setForm]         = useState<FormInfo | null | undefined>(undefined) // undefined = loading, null = not found
  const [loading, setLoading]   = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [offlineSubmitted, setOfflineSubmitted] = useState(false)

  const [tierId, setTierId]         = useState("")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("STRIPE")
  const [freeAmount, setFreeAmount] = useState(0)
  const [donorType, setDonorType]   = useState<"INDIVIDUAL" | "COMPANY">("INDIVIDUAL")
  const [companyName, setCompanyName] = useState("")
  const [siret, setSiret]           = useState("")
  const [address, setAddress]       = useState("")
  const [birthDate, setBirthDate]   = useState("")
  const [phone, setPhone]           = useState("")
  const [mobile, setMobile]         = useState("")
  const [gender, setGender]         = useState("")
  const [message, setMessage]       = useState("")
  const [anonymous, setAnonymous]   = useState(false)
  const [conditionsAgreed, setConditionsAgreed] = useState(false)
  const [answers, setAnswers]       = useState<Record<string, AnswerValue>>({})

  // Ré-utilisé après un échec de soumission (voir handleSubmit) — la campagne a pu être
  // dépubliée/fermée pendant que le membre remplissait le formulaire, auquel cas on préfère
  // rafraîchir son état plutôt que de laisser un formulaire obsolète qui semble encore valide.
  const loadForm = useCallback(() => {
    setForm(undefined)
    return fetch(`/api/portal/dons/forms/${formSlug}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: FormInfo | null) => {
        setForm(data)
        if (data?.tiers.length) setTierId(prev => prev || data.tiers[0].id)
        // Pré-remplit ce qui est déjà connu du profil — le membre n'a pas à le ressaisir.
        if (data?.member) {
          setAddress(prev => prev || data.member.address)
          setPhone(prev => prev || data.member.phone)
        }
        return data
      })
      .catch(() => { setForm(null); return null })
  }, [formSlug])

  useEffect(() => { loadForm() }, [loadForm, loc])

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
  const tierMinimum = (x: Tier) => (x.amount != null ? Number(x.amount) : MIN_DONATION_AMOUNT)
  const partialReceiptAmount = (x: Tier, paidAmount: number): number | null => {
    if (x.receiptMode !== "PARTIAL") return null
    if (x.freeAmount) return x.ineligibleAmount != null ? Math.max(0, paidAmount - Number(x.ineligibleAmount)) : null
    return x.deductibleAmount != null ? Number(x.deductibleAmount) : null
  }

  const intervalSuffix = (interval: Tier["interval"]) =>
    interval === "MONTH" ? t("perMonth") : interval === "QUARTER" ? t("perQuarter") : t("perYear")

  const offlineMethods = (["ESPECES", "CHEQUE", "VIREMENT"] as const).filter(m =>
    m === "ESPECES" ? form?.allowCash : m === "CHEQUE" ? form?.allowCheque : form?.allowTransfer,
  )
  const showOfflineChoice = selectedTier?.kind === "ONE_OFF" && offlineMethods.length > 0
  const hasAnyPaymentMethod = !!form && (form.paymentEnabled || (selectedTier?.kind === "ONE_OFF" && offlineMethods.length > 0))

  const belowMinimum = paymentMethod === "STRIPE" && amount > 0 && amount < MIN_DONATION_AMOUNT
  const belowTierMinimum = !!selectedTier && selectedTier.freeAmount && amount < tierMinimum(selectedTier)
  const belowIneligible = !!selectedTier && selectedTier.freeAmount && selectedTier.receiptMode === "PARTIAL" &&
    selectedTier.ineligibleAmount != null && amount < Number(selectedTier.ineligibleAmount)
  const amountError: string | null = !selectedTier ? null
    : belowMinimum      ? t("belowMinimumAmount", { amount: MIN_DONATION_AMOUNT.toLocaleString(loc, { style: "currency", currency: "EUR" }) })
    : belowTierMinimum  ? t("belowExtraMinimum", { label: selectedTier.label, amount: tierMinimum(selectedTier).toLocaleString(loc, { style: "currency", currency: "EUR" }) })
    : belowIneligible   ? t("belowIneligibleAmount", { amount: Number(selectedTier.ineligibleAmount).toLocaleString(loc, { style: "currency", currency: "EUR" }) })
    : null

  const canSubmit =
    !loading &&
    !!form && !!form.member.email && !form.notOpenYet && !form.closed &&
    (paymentMethod === "STRIPE" ? form.paymentEnabled : selectedTier?.kind === "ONE_OFF") &&
    !!selectedTier && amount > 0 && !belowMinimum && !belowTierMinimum && !belowIneligible &&
    (donorType !== "COMPANY" || (companyName.trim() && siret.trim())) &&
    (form.fieldAddress   !== "REQUIRED" || address.trim()) &&
    (form.fieldBirthDate !== "REQUIRED" || birthDate.trim()) &&
    (form.fieldPhone     !== "REQUIRED" || phone.trim()) &&
    (form.fieldMobile    !== "REQUIRED" || mobile.trim()) &&
    (form.fieldGender    !== "REQUIRED" || gender.trim()) &&
    (!form.requireCguvSignature || conditionsAgreed) &&
    form.customFields.every(f => {
      if (!f.required) return true
      const v = answers[f.id]
      return Array.isArray(v) ? v.length > 0 : (v ?? "").trim() !== ""
    })

  const submittingRef = useRef(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submittingRef.current || !canSubmit || !form || !selectedTier) return

    submittingRef.current = true
    setLoading(true)
    try {
      const res = await fetch(`/api/portal/dons/forms/${formSlug}/checkout`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tierId,
          paymentMethod,
          amount: selectedTier.freeAmount ? amount : undefined,
          donorType,
          companyName: donorType === "COMPANY" ? companyName.trim() : undefined,
          siret:       donorType === "COMPANY" ? siret.trim() : undefined,
          address:     address.trim() || undefined,
          birthDate:   birthDate.trim() || undefined,
          phone:       phone.trim() || undefined,
          mobile:      mobile.trim() || undefined,
          gender:      gender.trim() || undefined,
          message:     message.trim() || undefined,
          anonymous,
          answers,
          conditionsAgreed,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? t("genericError"))
        // La campagne a pu être dépubliée/fermée entre le chargement et la soumission —
        // on rafraîchit plutôt que de laisser le formulaire semblant encore valide.
        loadForm()
        return
      }
      if (data.url) { window.location.href = data.url; return }
      if (data.offline) { setOfflineSubmitted(true); setSubmitted(true); return }
    } catch {
      toast.error(t("errorNetwork"))
    } finally {
      setLoading(false)
      submittingRef.current = false
    }
  }

  if (form === undefined) {
    return (
      <div className="w-full max-w-md mx-auto py-8">
        <PublicFormSkeleton />
      </div>
    )
  }

  if (form === null) {
    return (
      <div className="w-full max-w-md mx-auto py-16 text-center space-y-4">
        <p className="text-muted-foreground">{t("notFound")}</p>
        <Button variant="outline" onClick={() => router.push(`/portal/${slug}/dons`)}>
          <ArrowLeftIcon className="size-4 mr-2" />
          {tp("backToDons")}
        </Button>
      </div>
    )
  }

  const missingEmail = !form.member.email

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => router.push(`/portal/${slug}/dons`)}>
        <ArrowLeftIcon className="size-3.5" />
        {tp("backToDons")}
      </Button>

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

      {!submitted && form.canIssueTaxReceipts && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 dark:bg-primary/10 p-4 flex gap-3">
          <InfoIcon className="size-4 text-primary shrink-0 mt-0.5" />
          <div className="text-sm text-foreground space-y-1">
            <p className="font-semibold">{tp("taxDeductibleTitle")}</p>
            <p className="text-xs text-muted-foreground">{tp("taxDeductibleDetail")}</p>
          </div>
        </div>
      )}

      {!submitted && form.canIssueTaxReceipts && !missingEmail && form.fieldAddress !== "REQUIRED" && !form.member.address && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 dark:bg-amber-950/20 p-4 flex gap-3">
          <WarningCircleIcon className="size-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-300 space-y-1">
            <p>
              {tp("noAddressWarning")}{" "}
              <Link href={`/portal/${slug}/profil`} className="underline underline-offset-2">
                {tp("completeProfile")}
              </Link>
            </p>
          </div>
        </div>
      )}

      {submitted ? (
        <div className="rounded-lg border bg-card p-6 text-center text-sm space-y-1">
          <p className="font-medium">{t("submittedTitle")}</p>
          {form.confirmationMessage ? (
            <RichTextView content={form.confirmationMessage} className="text-muted-foreground" />
          ) : (
            <p className="text-muted-foreground">{t("submittedWithEmail")}</p>
          )}
          {offlineSubmitted && form.offlineInstructions && (
            <p className="text-muted-foreground pt-2 border-t mt-3">{form.offlineInstructions}</p>
          )}
        </div>
      ) : missingEmail ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 dark:bg-amber-950/20 p-6 text-center space-y-3">
          <WarningCircleIcon className="size-6 text-amber-600 mx-auto" />
          <p className="text-sm text-amber-800 dark:text-amber-300">{tp("addEmailPrompt")}</p>
          <Button size="sm" onClick={() => router.push(`/portal/${slug}/profil`)}>
            {tp("completeProfile")}
          </Button>
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
          <p className="text-xs text-muted-foreground">
            {tp("donatingAs", { name: `${form.member.firstName} ${form.member.lastName}`, email: form.member.email })}
          </p>

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
            {selectedTier?.freeAmount ? (
              <CurrencyField
                label={t("freeAmountLabel")}
                required
                placeholder={tierMinimum(selectedTier).toLocaleString(loc, { style: "currency", currency: "EUR" })}
                value={freeAmount}
                onChange={setFreeAmount}
                error={amountError ?? undefined}
              />
            ) : amountError && (
              <p className="text-xs text-destructive">{amountError}</p>
            )}
            {selectedTier && !belowIneligible && partialReceiptAmount(selectedTier, amount) != null && (
              <p className="text-xs text-muted-foreground">
                {t("partialReceiptNotice", {
                  amount: partialReceiptAmount(selectedTier, amount)!.toLocaleString(loc, { style: "currency", currency: "EUR" }),
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
          {donorType === "COMPANY" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label={t("companyNameLabel")} placeholder={t("companyNamePlaceholder")} required value={companyName} onChange={e => setCompanyName(e.target.value)} />
              <FormField label={t("siretLabel")} placeholder={t("siretPlaceholder")} required value={siret} onChange={e => setSiret(e.target.value)} />
            </div>
          )}

          {form.fieldAddress !== "HIDDEN" && (
            <FormField label={t("addressLabel")} placeholder={t("addressPlaceholder")} required={form.fieldAddress === "REQUIRED"} value={address} onChange={e => setAddress(e.target.value)} />
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {form.fieldBirthDate !== "HIDDEN" && (
              <DateField label={t("birthDateLabel")} required={form.fieldBirthDate === "REQUIRED"} value={birthDate} onChange={setBirthDate} />
            )}
            {form.fieldGender !== "HIDDEN" && (
              <FormField label={t("genderLabel")} placeholder={t("genderPlaceholder")} required={form.fieldGender === "REQUIRED"} value={gender} onChange={e => setGender(e.target.value)} />
            )}
            {form.fieldPhone !== "HIDDEN" && (
              <FormField label={t("phoneLabel")} placeholder={t("phonePlaceholder")} required={form.fieldPhone === "REQUIRED"} value={phone} onChange={e => setPhone(e.target.value)} />
            )}
            {form.fieldMobile !== "HIDDEN" && (
              <FormField label={t("mobileLabel")} placeholder={t("mobilePlaceholder")} required={form.fieldMobile === "REQUIRED"} value={mobile} onChange={e => setMobile(e.target.value)} />
            )}
          </div>

          {form.customFields.map(field => {
            const stringValue = (): string => {
              const v = answers[field.id]
              return Array.isArray(v) ? "" : (v ?? "")
            }
            const arrayValue = (): string[] => {
              const v = answers[field.id]
              return Array.isArray(v) ? v : []
            }
            const setAnswer = (value: AnswerValue) => setAnswers(prev => ({ ...prev, [field.id]: value }))

            if (field.type === "SELECT") return (
              <SelectField
                key={field.id}
                label={field.label}
                required={field.required}
                options={(field.options ?? []).map(o => ({ value: o, label: o }))}
                value={stringValue()}
                onValueChange={setAnswer}
              />
            )
            if (field.type === "RADIO") return (
              <div key={field.id} className="space-y-1.5">
                <Label>{field.label}{field.required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}</Label>
                <div className="flex flex-col gap-1.5">
                  {(field.options ?? []).map(o => (
                    <label key={o} className="flex items-center gap-1.5 text-sm">
                      <input type="radio" name={`custom-${field.id}`} required={field.required} checked={stringValue() === o} onChange={() => setAnswer(o)} />
                      {o}
                    </label>
                  ))}
                </div>
              </div>
            )
            if (field.type === "CHECKBOX_MULTI") return (
              <div key={field.id} className="space-y-1.5">
                <Label>{field.label}{field.required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}</Label>
                <div className="flex flex-col gap-1.5">
                  {(field.options ?? []).map(o => {
                    const checked = arrayValue().includes(o)
                    return (
                      <label key={o} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => setAnswer(e.target.checked ? [...arrayValue(), o] : arrayValue().filter(v => v !== o))}
                        />
                        {o}
                      </label>
                    )
                  })}
                </div>
              </div>
            )
            return (
              <FormField
                key={field.id}
                label={field.label}
                required={field.required}
                type={field.type === "NUMBER" ? "number" : "text"}
                value={stringValue()}
                onChange={e => setAnswer(e.target.value)}
              />
            )
          })}

          <FormField
            label={t("messageLabel")}
            placeholder={t("messagePlaceholder")}
            value={message}
            onChange={e => setMessage(e.target.value)}
          />

          <CheckboxField label={t("anonymousLabel")} checked={anonymous} onChange={e => setAnonymous(e.target.checked)} />

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
  )
}
