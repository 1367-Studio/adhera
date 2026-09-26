"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { InfoIcon, CheckCircleIcon, IdentificationCardIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { DateField } from "@/components/ui/date-field"
import { SelectField } from "@/components/ui/select-field"
import { AddressFields } from "@/components/ui/address-fields"
import { CurrencyField } from "@/components/ui/currency-field"
import { ImageUpload } from "@/components/ui/image-upload"
import { RichTextView } from "@/components/ui/rich-text-view"
import { FormTermsSection } from "@/components/public/form-terms-section"
import { publicFormTerms, type FormTermsAttachment } from "@/lib/form-terms"
import { LegalConsent, type RequiredLegalDocument } from "@/components/public/legal-consent"
import { MembershipFormFieldInput, type MembershipFormFieldInputField } from "@/components/adhesions/membership-form-field-input"
import { EMPTY_ADDRESS_FORM_VALUES, type AddressFormValues } from "@/lib/address"
import { spokenLanguageOptions } from "@/lib/languages"

type FieldRequirement = "HIDDEN" | "OPTIONAL" | "REQUIRED"

type Tier = { id: string; label: string; freeAmount: boolean; amount: string | null; durationMonths: number | null; fixedPeriodEnd: string | null }

type CompletionData = {
  associationName: string
  slug:            string
  formSlug:        string
  formTitle:       string
  description:     string | null
  conditions:      string | null
  attachments?:    FormTermsAttachment[] | null
  requireCguvSignature: boolean
  online:          boolean
  fieldAddress:    FieldRequirement
  fieldBirthDate:  FieldRequirement
  fieldPhone:      FieldRequirement
  fieldMobile:     FieldRequirement
  fieldGender:     FieldRequirement
  fieldPhoto:      FieldRequirement
  fieldLanguage:   FieldRequirement
  tiers:           Tier[]
  legalDocuments:  RequiredLegalDocument[]
  customFields:    MembershipFormFieldInputField[]
  prefill: {
    firstName: string; lastName: string; email: string
    phone: string; mobile: string
    addressStreet: string; addressComplement: string; postalCode: string; city: string; country: string
    birthDate: string; sexe: string; spokenLanguage: string; photoUrl: string
    answers: Record<string, string>
  }
}

// One-off "finish your adhésion" page for a member who self-registered via the portal but
// was never actually billed — see src/app/api/public/complete-adhesion/[token]/route.ts's
// header comment for the full context. Deliberately its own small component rather than a
// mode of membership-form-public-form.tsx: that component covers multi-registrant/
// installments/addons/products/offline-payment, none of which apply here, and this is a
// one-off tool, not a permanent feature worth threading through its complexity.
export default function CompletarAdesaoPage() {
  const { token } = useParams<{ token: string }>()
  // Same terms wording as the membership public form (the rest of this page is still hardcoded French).
  const tMembership = useTranslations("membershipForms.public")

  const [data, setData]       = useState<CompletionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [outcome] = useState<"success" | "cancelled" | null>(() => {
    if (typeof window === "undefined") return null
    const payment = new URLSearchParams(window.location.search).get("payment")
    return payment === "success" || payment === "cancelled" ? payment : null
  })

  const [tierId, setTierId]   = useState("")
  const [amount, setAmount]   = useState(0)
  const [phone, setPhone]     = useState("")
  const [mobile, setMobile]   = useState("")
  const [addressValues, setAddressValues] = useState<AddressFormValues>({ ...EMPTY_ADDRESS_FORM_VALUES })
  const [birthDate, setBirthDate] = useState("")
  const [sexe, setSexe]       = useState<"" | "HOMME" | "FEMME">("")
  const [spokenLanguage, setSpokenLanguage] = useState("")
  const [photoUrl, setPhotoUrl] = useState("")
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [conditionsAgreed, setConditionsAgreed] = useState(false)
  const [legalAccepted, setLegalAccepted] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  useEffect(() => {
    // Skipped once payment already succeeded: the webhook clears the token the moment it
    // processes the payment (single-use, see adhesion-completion.ts), so re-fetching here
    // would legitimately 404 on a link that just worked — nothing left to render a form for.
    if (outcome === "success") { setLoading(false); return }
    fetch(`/api/public/complete-adhesion/${token}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: CompletionData) => {
        setData(d)
        setPhone(d.prefill.phone)
        setMobile(d.prefill.mobile)
        setAddressValues({
          addressStreet: d.prefill.addressStreet, addressComplement: d.prefill.addressComplement,
          postalCode: d.prefill.postalCode, city: d.prefill.city, country: d.prefill.country,
        })
        setBirthDate(d.prefill.birthDate)
        setSexe(d.prefill.sexe === "HOMME" || d.prefill.sexe === "FEMME" ? d.prefill.sexe : "")
        setSpokenLanguage(d.prefill.spokenLanguage)
        setPhotoUrl(d.prefill.photoUrl)
        setAnswers(d.prefill.answers)
        if (d.tiers.length === 1) setTierId(d.tiers[0].id)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [token])

  function touch(field: string) { setTouched(t => ({ ...t, [field]: true })) }
  function requiredError(field: string, value: string, required: boolean) {
    return required && touched[field] && !value.trim() ? "Ce champ est requis." : undefined
  }

  // Mirrors membership-form-public-form.tsx's oneOffDurationSuffix — every tier here is a
  // ONE_OFF tarif (see the route's `where`), so a custom duration still needs surfacing:
  // a single payment doesn't obviously mean "valid all year" to the visitor otherwise.
  function tierDurationLabel(tier: Tier): string | null {
    if (tier.fixedPeriodEnd) return `valable jusqu'au ${new Date(tier.fixedPeriodEnd).toLocaleDateString("fr-FR")}`
    if (tier.durationMonths) return `valable ${tier.durationMonths} mois`
    return null
  }

  const selectedTier = data?.tiers.find(t => t.id === tierId)
  const addressRequired = data?.fieldAddress === "REQUIRED"
  const addressFilled = !!addressValues.addressStreet.trim() && !!addressValues.postalCode.trim() && !!addressValues.city.trim()

  // Empty editor markup or a "required" flag with nothing to accept must not block the visitor.
  const requiresTermsAcceptance = !!data && publicFormTerms({
    conditions:           data.conditions,
    attachments:          data.attachments,
    requireCguvSignature: data.requireCguvSignature,
  }).requiresTermsAcceptance

  const canSubmit = !!data && !!selectedTier
    && (!selectedTier.freeAmount || amount > 0)
    && (data.fieldPhone !== "REQUIRED" || !!phone.trim())
    && (data.fieldMobile !== "REQUIRED" || !!mobile.trim())
    && (data.fieldBirthDate !== "REQUIRED" || !!birthDate.trim())
    && (data.fieldGender !== "REQUIRED" || !!sexe)
    && (data.fieldLanguage !== "REQUIRED" || !!spokenLanguage)
    && (data.fieldPhoto !== "REQUIRED" || !!photoUrl.trim())
    && (!addressRequired || addressFilled)
    && data.customFields.every(f => !f.required || !!answers[f.id]?.trim())
    && (!requiresTermsAcceptance || conditionsAgreed)
    && (data.legalDocuments.length === 0 || legalAccepted)

  // Mirrors membership-form-public-form.tsx's own blockingReason — surfaces *why* the
  // button won't proceed instead of leaving the visitor to guess, on top of the inline
  // per-field errors a click attempt now reveals (see handleSubmit).
  const blockingReason: string | null = !data ? null
    : !selectedTier ? null // le sélecteur de tarif montre déjà lui-même qu'aucun choix n'est fait
    : selectedTier.freeAmount && amount <= 0 ? "Indiquez un montant."
    : !data.online ? "Le paiement en ligne n'est pas disponible pour le moment. Contactez l'association."
    : (data.fieldPhone === "REQUIRED" && !phone.trim())
      || (data.fieldMobile === "REQUIRED" && !mobile.trim())
      || (data.fieldBirthDate === "REQUIRED" && !birthDate.trim())
      || (data.fieldGender === "REQUIRED" && !sexe)
      || (data.fieldLanguage === "REQUIRED" && !spokenLanguage)
      || (data.fieldPhoto === "REQUIRED" && !photoUrl.trim())
      || (addressRequired && !addressFilled)
      || !data.customFields.every(f => !f.required || !!answers[f.id]?.trim())
    ? "Complétez les champs requis ci-dessus."
    : requiresTermsAcceptance && !conditionsAgreed ? "Vous devez accepter les conditions générales pour adhérer."
    : data.legalDocuments.length > 0 && !legalAccepted ? "Vous devez accepter les documents de l'association pour continuer."
    : null

  async function handleSubmit() {
    if (!data || !canSubmit) return

    setSubmitting(true)
    try {
      const res = await fetch(`/api/public/complete-adhesion/${token}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tierId, amount: selectedTier?.freeAmount ? amount : undefined,
          phone, mobile, ...addressValues, birthDate, sexe: sexe || undefined,
          spokenLanguage: spokenLanguage || undefined, photoUrl: photoUrl || undefined, answers,
          conditionsAgreed,
          acceptedLegalRevisionIds: legalAccepted ? data.legalDocuments.map(d => d.revisionId) : [],
        }),
      })
      const result = await res.json()
      if (!res.ok) { toast.error(result.error ?? "Erreur"); return }
      window.location.href = result.url
    } catch {
      toast.error("Erreur réseau")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="dashboard-canvas public-canvas min-h-screen p-3">
        <div className="min-h-[calc(100vh-1.5rem)] rounded-[10px] bg-public-panel flex items-center justify-center">
          <div className="size-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      </div>
    )
  }

  if (outcome === "success") {
    return (
      <div className="dashboard-canvas public-canvas min-h-screen p-3">
        <div className="min-h-[calc(100vh-1.5rem)] rounded-[10px] bg-public-panel flex items-center justify-center text-center px-4">
          <div className="flex flex-col items-center gap-2 max-w-sm">
            <CheckCircleIcon className="size-6 text-primary" />
            <p className="font-medium">Merci, votre adhésion est finalisée.</p>
            <p className="text-sm text-muted-foreground">Vous allez recevoir la confirmation par email — aucune autre action n&apos;est nécessaire.</p>
          </div>
        </div>
      </div>
    )
  }

  if (notFound || !data) {
    return (
      <div className="dashboard-canvas public-canvas min-h-screen p-3">
        <div className="min-h-[calc(100vh-1.5rem)] rounded-[10px] bg-public-panel flex items-center justify-center text-center px-4">
          <p className="text-muted-foreground">Ce lien est invalide ou a déjà été utilisé.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard-canvas public-canvas min-h-screen p-3">
      <div className="min-h-[calc(100vh-1.5rem)] rounded-[10px] bg-public-panel flex items-start justify-center py-12 px-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center size-12 rounded-full bg-primary/10 dark:bg-primary/20 mb-2">
              <IdentificationCardIcon className="size-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{data.formTitle}</h1>
            <p className="text-muted-foreground text-sm">{data.associationName}</p>
            <p className="text-muted-foreground text-sm">
              {data.prefill.firstName} {data.prefill.lastName} · {data.prefill.email}
            </p>
          </div>

          {data.description && (
            <div className="rounded-lg border bg-card p-4 text-sm">
              <RichTextView content={data.description} className="text-foreground/90" />
            </div>
          )}

          {outcome === "cancelled" && (
            <p className="text-sm text-muted-foreground">Paiement annulé — vous pouvez réessayer quand vous voulez.</p>
          )}

          <div className="rounded-lg border bg-card p-4 space-y-4">
          <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
            <InfoIcon className="size-4 mt-0.5 shrink-0" />
            <span>Votre mot de passe d&apos;accès à l&apos;espace membre reste le même — inutile d&apos;en créer un nouveau.</span>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium">Tarif d&apos;adhésion</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.tiers.map(tier => (
                <button
                  key={tier.id}
                  type="button"
                  onClick={() => setTierId(tier.id)}
                  className={`rounded-md border px-4 py-3 text-left text-sm transition-colors ${
                    tierId === tier.id ? "border-primary bg-primary/5" : "border-input hover:bg-muted/40"
                  }`}
                >
                  <div className="font-medium">{tier.label}</div>
                  <div className="text-muted-foreground">
                    {tier.freeAmount ? `À partir de ${tier.amount ?? "0"}€` : `${tier.amount}€`}
                  </div>
                  {tierDurationLabel(tier) && (
                    <div className="text-xs text-muted-foreground">{tierDurationLabel(tier)}</div>
                  )}
                </button>
              ))}
            </div>
            {selectedTier?.freeAmount && (
              <CurrencyField label="Montant" required value={amount} onChange={setAmount} />
            )}
          </div>

          {data.fieldPhone !== "HIDDEN" && (
            <FormField
              label="Téléphone" required={data.fieldPhone === "REQUIRED"}
              value={phone} onChange={e => setPhone(e.target.value)} onBlur={() => touch("phone")}
              error={requiredError("phone", phone, data.fieldPhone === "REQUIRED")}
            />
          )}
          {data.fieldMobile !== "HIDDEN" && (
            <FormField
              label="Mobile" required={data.fieldMobile === "REQUIRED"}
              value={mobile} onChange={e => setMobile(e.target.value)} onBlur={() => touch("mobile")}
              error={requiredError("mobile", mobile, data.fieldMobile === "REQUIRED")}
            />
          )}
          {data.fieldAddress !== "HIDDEN" && (
            <AddressFields
              value={addressValues} onChange={patch => setAddressValues(v => ({ ...v, ...patch }))}
              required={addressRequired} errors={touched.address && addressRequired && !addressFilled ? { addressStreet: "Requis" } : undefined}
            />
          )}
          {data.fieldBirthDate !== "HIDDEN" && (
            <DateField
              label="Date de naissance" required={data.fieldBirthDate === "REQUIRED"}
              value={birthDate} onChange={v => { setBirthDate(v); touch("birthDate") }}
              error={requiredError("birthDate", birthDate, data.fieldBirthDate === "REQUIRED")}
            />
          )}
          {data.fieldGender !== "HIDDEN" && (
            <SelectField
              label="Genre" required={data.fieldGender === "REQUIRED"}
              options={[
                ...(data.fieldGender === "REQUIRED" ? [] : [{ value: "", label: "Préférer ne pas préciser" }]),
                { value: "HOMME", label: "Homme" }, { value: "FEMME", label: "Femme" },
              ]}
              value={sexe} onValueChange={v => { setSexe(v as "" | "HOMME" | "FEMME"); touch("sexe") }}
              error={requiredError("sexe", sexe, data.fieldGender === "REQUIRED")}
            />
          )}
          {data.fieldLanguage !== "HIDDEN" && (
            <SelectField
              label="Langue parlée" required={data.fieldLanguage === "REQUIRED"}
              options={data.fieldLanguage === "REQUIRED"
                ? spokenLanguageOptions()
                : [{ value: "", label: "Non précisé" }, ...spokenLanguageOptions()]}
              value={spokenLanguage} onValueChange={v => { setSpokenLanguage(v); touch("spokenLanguage") }}
              error={requiredError("spokenLanguage", spokenLanguage, data.fieldLanguage === "REQUIRED")}
            />
          )}
          {data.fieldPhoto !== "HIDDEN" && (
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Photo{data.fieldPhoto === "REQUIRED" ? " *" : ""}</span>
              <ImageUpload
                value={photoUrl} onChange={setPhotoUrl}
                uploadUrl={`/api/public/${data.slug}/adhesion/${data.formSlug}/photo`}
                invalid={data.fieldPhoto === "REQUIRED" && touched.photoUrl && !photoUrl}
                aspectRatio="square"
              />
            </div>
          )}

          {data.customFields.map(field => (
            <MembershipFormFieldInput
              key={field.id} field={field} value={answers[field.id] ?? ""}
              onChange={v => setAnswers(a => ({ ...a, [field.id]: v }))}
              onBlur={() => touch(`custom-${field.id}`)}
              error={touched[`custom-${field.id}`] && field.required && !answers[field.id]?.trim() ? "Ce champ est requis." : undefined}
            />
          ))}

          <FormTermsSection
            conditions={data.conditions}
            attachments={data.attachments}
            requireCguvSignature={data.requireCguvSignature}
            accepted={conditionsAgreed}
            onAcceptedChange={setConditionsAgreed}
            labels={{
              viewConditions:   tMembership("viewConditionsLabel"),
              conditionsTitle:  tMembership("conditionsModalTitle"),
              acceptConditions: tMembership("conditionsAgreeLabel"),
            }}
          />
          <LegalConsent
            slug={data.slug}
            documents={data.legalDocuments}
            checked={legalAccepted}
            onChange={setLegalAccepted}
          />

          <div className="space-y-2">
            <Button loading={submitting} disabled={!canSubmit} onClick={handleSubmit} className="w-full">
              Payer et finaliser ({selectedTier ? (selectedTier.freeAmount ? amount : selectedTier.amount) : 0}€)
            </Button>
            {blockingReason && (
              <p className="text-sm text-center text-muted-foreground">{blockingReason}</p>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}
