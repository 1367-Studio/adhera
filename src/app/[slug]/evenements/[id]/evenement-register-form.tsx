"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { toast } from "sonner"
import { useTranslations, useLocale } from "next-intl"
import { CalendarBlankIcon, MapPinIcon, TicketIcon, ShieldCheckIcon, MinusIcon, PlusIcon, FileIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { RichTextView } from "@/components/ui/rich-text-view"
import { InAppBrowserBanner } from "@/components/ui/in-app-browser-banner"
import { useInAppBrowserEscape } from "@/hooks/use-in-app-browser-escape"
import { SelectField } from "@/components/ui/select-field"
import { QuantityStepper } from "@/components/ui/quantity-stepper"
import { EventDonationPrompt } from "@/components/public/event-donation-prompt"
import { TermsModal } from "@/components/public/terms-modal"
import { cheapestAvailableTicketTypePrice } from "@/lib/ticket-types"

const MAX_QUANTITY = 10

type CustomFieldType = "TEXT" | "NUMBER" | "FILE" | "LONG_TEXT" | "DATE" | "SELECT" | "RADIO" | "CHECKBOX_MULTI" | "BOOLEAN"
type CustomField = { id: string; type: CustomFieldType; label: string; required: boolean; options: string[] | null }
// A plain string for every type except CHECKBOX_MULTI, which is a string array — see
// Participation.answers's own comment in schema.prisma for the same convention server-side.
type AnswerValue = string | string[]
type TicketType  = { id: string; label: string; price: string; priceBeforeDiscount: string | null; remaining: number | null; full: boolean; notOpenYet: boolean; closed: boolean }
// Same 3-way check the <select>'s own disabled logic already applies (see ticketTypeOptions
// below) — reused here so a not-yet-open/closed tariff can never end up auto-selected either.
function isTicketTypeAvailable(tt: TicketType): boolean {
  return !tt.full && !tt.notOpenYet && !tt.closed
}
type DonationExtra = { id: string; label: string; minAmount: string }
type OfferedProduct = {
  id: string; varianteId: string; variantLabel: string; price: number; stock: number
  productId: string; productName: string; productImageUrl: string | null
}
type FieldRequirement = "HIDDEN" | "OPTIONAL" | "REQUIRED"
type PaymentMethod = "STRIPE" | "ESPECES" | "CHEQUE" | "VIREMENT"

type EventInfo = {
  associationName: string
  id:          string
  title:       string
  description: string | null
  imageUrl:    string | null
  date:        string
  endDate:     string | null
  location:    string | null
  contactEmail: string | null
  contactPhone: string | null
  price:       string | null
  capacity:    number | null
  remainingCapacity: number | null
  full:            boolean
  past:            boolean
  notOpenYet:      boolean
  closed:          boolean
  isPaid:          boolean
  paymentEnabled:  boolean
  donationsEnabled: boolean
  canIssueTaxReceipts: boolean
  fieldPhone:     FieldRequirement
  fieldAddress:   FieldRequirement
  fieldBirthDate: FieldRequirement
  fieldGender:    FieldRequirement
  fieldMobile:    FieldRequirement
  allowCash:              boolean
  allowCheque:            boolean
  allowTransfer:          boolean
  offlineInstructions:    string | null
  confirmationMessage:    string | null
  customFields:    CustomField[]
  ticketTypes:     TicketType[]
  donationExtras:  DonationExtra[]
  products:        OfferedProduct[]
  conditions:           string | null
  attachments:          { url: string; filename: string; size: number }[]
  requireCguvSignature: boolean
}

type Attendee = {
  firstName:    string
  lastName:     string
  email:        string
  ticketTypeId: string
  phone:        string
  address:      string
  birthDate:    string
  gender:       "" | "HOMME" | "FEMME"
  mobile:       string
  answers:      Record<string, AnswerValue>
}

const EMPTY_ATTENDEE: Attendee = { firstName: "", lastName: "", email: "", ticketTypeId: "", phone: "", address: "", birthDate: "", gender: "", mobile: "", answers: {} }

type Props = { slug: string; id: string }

export function EvenementRegisterForm(props: Props) {
  return (
    <Suspense fallback={null}>
      <EvenementRegisterFormInner {...props} />
    </Suspense>
  )
}

// Uploads immediately on selection (unlike the lazy admin DocumentUpload) — the public form
// has no separate "save" step, submission itself is the moment the answer is captured, so the
// URL must already be in hand by then. No preview thumbnail (PDFs are a valid answer here,
// same reasoning as DocumentUpload's own filename-only display), just the filename + a way to
// remove it — the filename itself is UI-only state, not part of the answer (the stored answer
// is just the R2 url), so it's lost on reload, same tradeoff DocumentUpload accepts.
function EvenementFileField({
  value, onChange, uploadUrl, required, label, t,
}: {
  value:     string
  onChange:  (url: string) => void
  uploadUrl: string
  required:  boolean
  label:     string
  t:         ReturnType<typeof useTranslations>
}) {
  const [uploading, setUploading] = useState(false)
  const [fileName, setFileName]   = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("fileTooLarge"))
      if (inputRef.current) inputRef.current.value = ""
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch(uploadUrl, { method: "POST", body: fd })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? t("fileUploadError"))
        return
      }
      const { url } = await res.json()
      setFileName(file.name)
      onChange(url)
    } catch {
      toast.error(t("fileNetworkError"))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  function handleRemove() {
    setFileName("")
    onChange("")
  }

  if (value) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-muted/30 px-3 text-sm">
        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{fileName || t("fileChosen")}</span>
        <button type="button" onClick={handleRemove} className="text-muted-foreground hover:text-destructive" aria-label={t("fileRemove")}>
          <XIcon className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-3 text-sm text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground transition-colors">
      <input
        ref={inputRef}
        type="file"
        required={required}
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
      />
      <span>{uploading ? t("fileUploading") : t("fileAttach")}</span>
      <span className="sr-only">{label}</span>
    </label>
  )
}

function AttendeeFields({
  index,
  attendee,
  onChange,
  ticketTypes,
  customFields,
  fieldPhone,
  fieldAddress,
  fieldBirthDate,
  fieldGender,
  fieldMobile,
  showHeading,
  t,
  loc,
  slug,
  id,
}: {
  index:        number
  attendee:     Attendee
  onChange:     (patch: Partial<Attendee>) => void
  ticketTypes:  TicketType[]
  customFields: CustomField[]
  fieldPhone:     FieldRequirement
  fieldAddress:   FieldRequirement
  fieldBirthDate: FieldRequirement
  fieldGender:    FieldRequirement
  fieldMobile:    FieldRequirement
  showHeading:  boolean
  t:            ReturnType<typeof useTranslations>
  loc:          string
  slug:         string
  id:           string
}) {
  // Same dynamic "* " / "(optionnel)" suffix already used for custom fields below — a
  // standard field's own label is bare (no baked-in "(optionnel)") precisely so it can be
  // driven by whichever requirement level the admin actually picked (Hidden/Optional/
  // Required), not always assume optional the way it did before requirement toggles existed.
  const fieldLabel = (requirement: FieldRequirement, label: string) =>
    requirement === "REQUIRED" ? t("customFieldRequired", { label }) : t("customFieldOptional", { label })
  const tCommon = useTranslations("common")

  return (
    <div className={showHeading ? "space-y-3 border-t pt-4 first:border-t-0 first:pt-0" : "space-y-3"}>
      {showHeading && (
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("attendeeHeading", { n: index + 1 })}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("firstNameLabel")}</label>
          <input
            type="text" required value={attendee.firstName} onChange={e => onChange({ firstName: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("lastNameLabel")}</label>
          <input
            type="text" required value={attendee.lastName} onChange={e => onChange({ lastName: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("emailLabel")}</label>
        <input
          type="email" required value={attendee.email} onChange={e => onChange({ email: e.target.value })}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {ticketTypes.length > 0 && (
        <div className="space-y-1">
          <SelectField
            id={`ticket-type-${index}`}
            label={t("ticketTypeLabel")}
            value={attendee.ticketTypeId || undefined}
            onValueChange={v => onChange({ ticketTypeId: v })}
            options={ticketTypes.map(tt => {
              const price = Number(tt.price) === 0 ? t("ticketTypeFree") : Number(tt.price).toLocaleString(loc, { style: "currency", currency: "EUR" })
              // Plain text only — SelectItem/SelectField options render as strings, not JSX, so
              // the struck-through visual (below, once a tier is picked) can't live inside the
              // dropdown itself; a parenthetical reference price is the text-only equivalent.
              const wasPrice = tt.priceBeforeDiscount ? ` (${t("wasPrice", { amount: Number(tt.priceBeforeDiscount).toLocaleString(loc, { style: "currency", currency: "EUR" }) })})` : ""
              // notOpenYet/closed (own sale window, see EvenementTicketType.opensAt/closesAt)
              // take priority over the sold-out label — a tier can be both capacity-full and
              // outside its window, but the window is the more informative reason to show.
              const suffix = tt.notOpenYet ? ` (${t("ticketTypeNotOpenYet")})`
                : tt.closed ? ` (${t("ticketTypeClosed")})`
                : tt.full ? ` (${t("ticketTypeSoldOut")})`
                : (tt.remaining != null ? ` (${t("ticketTypeRemaining", { count: tt.remaining })})` : "")
              return { value: tt.id, disabled: tt.full || tt.notOpenYet || tt.closed, label: `${tt.label} — ${price}${wasPrice}${suffix}` }
            })}
          />
          {(() => {
            const selected = ticketTypes.find(tt => tt.id === attendee.ticketTypeId)
            if (!selected?.priceBeforeDiscount) return null
            return (
              <p className="text-xs text-muted-foreground">
                <span className="line-through">{Number(selected.priceBeforeDiscount).toLocaleString(loc, { style: "currency", currency: "EUR" })}</span>
                {" "}
                <span className="font-medium text-foreground">{Number(selected.price).toLocaleString(loc, { style: "currency", currency: "EUR" })}</span>
              </p>
            )
          })()}
        </div>
      )}

      {fieldPhone !== "HIDDEN" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{fieldLabel(fieldPhone, t("phoneLabel"))}</label>
          <input
            type="tel" required={fieldPhone === "REQUIRED"} value={attendee.phone} onChange={e => onChange({ phone: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      {fieldAddress !== "HIDDEN" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{fieldLabel(fieldAddress, t("addressLabel"))}</label>
          <input
            type="text" required={fieldAddress === "REQUIRED"} value={attendee.address} onChange={e => onChange({ address: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      {fieldMobile !== "HIDDEN" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{fieldLabel(fieldMobile, t("mobileLabel"))}</label>
          <input
            type="tel" required={fieldMobile === "REQUIRED"} placeholder={t("mobilePlaceholder")} value={attendee.mobile} onChange={e => onChange({ mobile: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      {fieldBirthDate !== "HIDDEN" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{fieldLabel(fieldBirthDate, t("birthDateLabel"))}</label>
          <input
            type="date" required={fieldBirthDate === "REQUIRED"} value={attendee.birthDate} onChange={e => onChange({ birthDate: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      {fieldGender !== "HIDDEN" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{fieldLabel(fieldGender, t("genderLabel"))}</label>
          <select
            required={fieldGender === "REQUIRED"} value={attendee.gender} onChange={e => onChange({ gender: e.target.value as Attendee["gender"] })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="" disabled={fieldGender === "REQUIRED"} hidden={fieldGender === "REQUIRED"}>
              {fieldGender === "REQUIRED" ? tCommon("choosePlaceholder") : t("genderNone")}
            </option>
            <option value="HOMME">{t("genderHomme")}</option>
            <option value="FEMME">{t("genderFemme")}</option>
          </select>
        </div>
      )}

      {customFields.map(field => {
        const stringValue = (): string => {
          const v = attendee.answers[field.id]
          return Array.isArray(v) ? "" : (v ?? "")
        }
        const arrayValue = (): string[] => {
          const v = attendee.answers[field.id]
          return Array.isArray(v) ? v : []
        }
        const setAnswer = (value: AnswerValue) => onChange({ answers: { ...attendee.answers, [field.id]: value } })
        const labelText = field.required ? t("customFieldRequired", { label: field.label }) : t("customFieldOptional", { label: field.label })

        return (
        <div key={field.id} className="space-y-1.5">
          {/* SelectField renders its own label internally (see the SELECT branch below) —
              every other branch shares this one instead of duplicating it. */}
          {field.type !== "SELECT" && (
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{labelText}</label>
          )}
          {field.type === "FILE" ? (
            <EvenementFileField
              value={stringValue()}
              onChange={url => setAnswer(url)}
              uploadUrl={`/api/public/${slug}/evenements/${id}/upload`}
              required={field.required}
              label={field.label}
              t={t}
            />
          ) : field.type === "LONG_TEXT" ? (
            <textarea
              required={field.required}
              rows={3}
              value={stringValue()}
              onChange={e => setAnswer(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          ) : field.type === "DATE" ? (
            <input
              type="date" required={field.required}
              value={stringValue()}
              onChange={e => setAnswer(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          ) : field.type === "BOOLEAN" ? (
            <div className="flex h-9 items-center gap-4">
              {(["true", "false"] as const).map(v => (
                <label key={v} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio" name={`bool-${index}-${field.id}`} required={field.required}
                    checked={stringValue() === v}
                    onChange={() => setAnswer(v)}
                  />
                  {v === "true" ? t("booleanYes") : t("booleanNo")}
                </label>
              ))}
            </div>
          ) : field.type === "SELECT" ? (
            <SelectField
              id={`custom-${index}-${field.id}`}
              label={labelText}
              required={field.required}
              value={stringValue() || undefined}
              onValueChange={v => setAnswer(v)}
              options={(field.options ?? []).map(o => ({ value: o, label: o }))}
            />
          ) : field.type === "RADIO" ? (
            <div className="flex flex-col gap-1.5">
              {(field.options ?? []).map(o => (
                <label key={o} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio" name={`radio-${index}-${field.id}`} required={field.required}
                    checked={stringValue() === o}
                    onChange={() => setAnswer(o)}
                  />
                  {o}
                </label>
              ))}
            </div>
          ) : field.type === "CHECKBOX_MULTI" ? (
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
          ) : (
            <input
              type={field.type === "NUMBER" ? "number" : "text"}
              min={field.type === "NUMBER" ? 0 : undefined}
              step={field.type === "NUMBER" ? 1 : undefined}
              inputMode={field.type === "NUMBER" ? "numeric" : undefined}
              required={field.required}
              value={stringValue()}
              onChange={e => setAnswer(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          )}
        </div>
        )
      })}
    </div>
  )
}

function EvenementRegisterFormInner({ slug, id }: Props) {
  const searchParams = useSearchParams()
  const router   = useRouter()
  const pathname = usePathname()
  const t   = useTranslations("evenements.publicRegister")
  const loc = useLocale()
  const showInAppBrowserBanner = useInAppBrowserEscape()

  const [event, setEvent]     = useState<EventInfo | null>(null)
  const [loadingEvent, setLoadingEvent] = useState(true)
  const [notFound, setNotFound] = useState(false)
  // Portrait covers pair naturally with the form in a two-column layout (similar
  // heights); a landscape cover left in that layout leaves a tall dead gap under it
  // since it's short and the form is tall, so those instead run full-width above the
  // form like a banner. Null (still loading) falls back to the banner treatment, since
  // most event covers are landscape.
  const [isPortrait, setIsPortrait] = useState<boolean | null>(null)

  // One ticket = one attendee, even within a single order — every submission carries a
  // list, starting at 1. `attendees` can hold more entries than `attendeeCount` — lowering
  // the stepper only hides the tail, it never discards what was typed into it, so raising
  // the count back brings that data right back instead of forcing a retype.
  const [attendees, setAttendees]         = useState<Attendee[]>([EMPTY_ATTENDEE])
  const [attendeeCount, setAttendeeCount] = useState(1)
  const [website, setWebsite]             = useState("") // honeypot — must stay empty
  const [submitted, setSubmitted]     = useState(false)
  // Distinct from `submitted` — a waitlisted order was never confirmed a spot, so it must
  // never show the same "you're in" screen (nor the admin's confirmationMessage, written
  // assuming a real confirmation) or solicit a donation from someone with no confirmed seat.
  const [waitlisted, setWaitlisted]   = useState(false)
  const [paidSuccess, setPaidSuccess] = useState(false)
  const [thankYouOpen, setThankYouOpen] = useState(false)
  const [donationCompleted, setDonationCompleted] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("STRIPE")
  // Donation extras ride once per order, not per attendee — same convention as the
  // membership public form's own extras (attributed to the person filling out the form),
  // and restricted below to a single-attendee order for the same reason products/offline
  // payment already are: one Participation, one payment, no ambiguity about who it belongs to.
  const [donationSelections, setDonationSelections] = useState<Record<string, boolean>>({})
  const [donationAmounts, setDonationAmounts]       = useState<Record<string, number>>({})
  // Same one-per-order restriction as donations above (one Participation, one payment, no
  // per-seat stock tracking) — see resolveRequestedProducts in inscription/route.ts.
  const [productQuantities, setProductQuantities] = useState<Record<string, number>>({})
  const [conditionsAgreed, setConditionsAgreed] = useState(false)
  const [signedName, setSignedName]             = useState("")
  // Un seul par commande, comme les dons/produits ci-dessus — voir le commentaire du champ
  // ticketTypeIds dans schema.prisma : ne s'applique jamais aux dons ni à la boutique.
  const [discountCodeInput, setDiscountCodeInput] = useState("")
  const [discountCodeStatus, setDiscountCodeStatus] = useState<"idle" | "checking" | "valid" | "invalid" | "notApplicable">("idle")
  const [appliedDiscount, setAppliedDiscount] = useState<{ code: string; kind: "FIXED" | "PERCENT"; value: number; ticketTypeIds: string[] } | null>(null)

  useEffect(() => {
    fetch(`/api/public/${slug}/evenements/${id}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: EventInfo) => setEvent(d))
      .catch(() => setNotFound(true))
      .finally(() => setLoadingEvent(false))
  }, [slug, id, loc])

  // Defaults every attendee still missing a tier to the first one with room once the
  // event (and its tiers, if any) loads — a no-op for events with no ticket types, and
  // for attendees that already have a tier picked.
  useEffect(() => {
    if (!event?.ticketTypes.length) return
    const defaultTicketTypeId = (event.ticketTypes.find(isTicketTypeAvailable) ?? event.ticketTypes[0]).id
    setAttendees(prev => {
      let changed = false
      const next = prev.map(a => {
        if (a.ticketTypeId) return a
        changed = true
        return { ...a, ticketTypeId: defaultTicketTypeId }
      })
      return changed ? next : prev
    })
  }, [event])

  const hasTicketTypes = !!event?.ticketTypes.length
  // Every tier sold out is functionally the same as the event itself being full.
  const allTicketTypesFull = hasTicketTypes && event!.ticketTypes.every(tt => tt.full)

  const maxAttendees = event
    ? Math.max(1, Math.min(MAX_QUANTITY, event.remainingCapacity ?? MAX_QUANTITY))
    : 1

  // The event's remaining capacity can shrink after a refresh (e.g. someone else just
  // took a spot) — clamp the visible count, but keep whatever was already typed in case
  // capacity opens back up (someone else's hold expiring, etc).
  useEffect(() => {
    setAttendeeCount(prev => Math.min(prev, maxAttendees))
  }, [maxAttendees])

  function setQuantity(n: number) {
    if (n > attendees.length) {
      // New attendees inherit the last visible one's tier (when it still has room) instead
      // of always resetting to the cheapest/first tier — buying N tickets of the same tier
      // is the common case, and this avoids re-picking it by hand for every person added.
      const lastTicketTypeId = attendees[attendeeCount - 1]?.ticketTypeId
      const lastTicketType = event!.ticketTypes.find(tt => tt.id === lastTicketTypeId)
      const inherited = hasTicketTypes && !!lastTicketTypeId && !!lastTicketType && isTicketTypeAvailable(lastTicketType)
      const defaultTicketTypeId = hasTicketTypes
        ? (inherited ? lastTicketTypeId! : (event!.ticketTypes.find(isTicketTypeAvailable) ?? event!.ticketTypes[0]).id)
        : ""
      const additions = Array.from({ length: n - attendees.length }, () => ({ ...EMPTY_ATTENDEE, ticketTypeId: defaultTicketTypeId }))
      setAttendees(prev => [...prev, ...additions])
    }
    setAttendeeCount(n)
  }

  function updateAttendee(index: number, patch: Partial<Attendee>) {
    setAttendees(prev => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)))
  }

  const visibleAttendees = attendees.slice(0, attendeeCount)

  function seatPrice(a: Attendee): number {
    if (hasTicketTypes) return Number(event!.ticketTypes.find(tt => tt.id === a.ticketTypeId)?.price ?? 0)
    return event?.price ? Number(event.price) : 0
  }
  // Restreint à une seule commande d'un seul participant — même raisonnement que les dons/
  // produits ci-dessus, et évite d'avoir à décider contre quel billet le code s'applique dans
  // une commande groupée.
  function discountApplies(a: Attendee): boolean {
    if (!appliedDiscount || attendeeCount !== 1) return false
    return appliedDiscount.ticketTypeIds.length === 0 || appliedDiscount.ticketTypeIds.includes(a.ticketTypeId)
  }
  function discountedSeatPrice(a: Attendee): number {
    const price = seatPrice(a)
    if (!discountApplies(a)) return price
    const discounted = appliedDiscount!.kind === "PERCENT"
      ? price * (1 - appliedDiscount!.value / 100)
      : price - appliedDiscount!.value
    return Math.max(0, discounted)
  }
  const ticketsTotal = visibleAttendees.reduce((sum, a) => sum + discountedSeatPrice(a), 0)
  const discountAmount = visibleAttendees.reduce((sum, a) => sum + (seatPrice(a) - discountedSeatPrice(a)), 0)

  async function handleApplyDiscountCode() {
    const code = discountCodeInput.trim()
    if (!code) return
    setDiscountCodeStatus("checking")
    try {
      const res = await fetch(`/api/public/${slug}/evenements/${id}/discount-code`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ code }),
      })
      const data = await res.json()
      if (data.valid) {
        // Un code valide qui ne cible pas la tarif actuellement choisie ne doit jamais
        // s'afficher comme "appliqué" — sinon le total reste inchangé sans aucune explication,
        // ce qui a l'air d'un bug plutôt que d'un choix de tarif incompatible.
        const applies = data.ticketTypeIds.length === 0 || data.ticketTypeIds.includes(attendees[0]?.ticketTypeId ?? "")
        if (!applies) {
          setAppliedDiscount(null)
          setDiscountCodeStatus("notApplicable")
          return
        }
        setAppliedDiscount({ code: data.code, kind: data.kind, value: data.value, ticketTypeIds: data.ticketTypeIds })
        setDiscountCodeStatus("valid")
      } else {
        setAppliedDiscount(null)
        setDiscountCodeStatus("invalid")
      }
    } catch {
      setAppliedDiscount(null)
      setDiscountCodeStatus("invalid")
    }
  }
  function handleRemoveDiscountCode() {
    setAppliedDiscount(null)
    setDiscountCodeInput("")
    setDiscountCodeStatus("idle")
  }
  // Un code qui ne cible pas la tarif choisie ne doit pas rester silencieusement "appliqué"
  // sans effet — retiré dès que ça arrive (ex : la personne change de tarif après coup).
  useEffect(() => {
    if (appliedDiscount && attendeeCount === 1 && !discountApplies(attendees[0])) {
      setAppliedDiscount(null)
      setDiscountCodeStatus("notApplicable")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendees[0]?.ticketTypeId, attendeeCount])

  const donationExtras   = attendeeCount === 1 ? (event?.donationExtras ?? []) : []
  const selectedDonations = donationExtras.filter(d => donationSelections[d.id])
  const donationAmount = (d: DonationExtra) => Math.max(donationAmounts[d.id] ?? Number(d.minAmount), Number(d.minAmount))
  const donationsTotal = selectedDonations.reduce((sum, d) => sum + donationAmount(d), 0)

  const offeredProducts  = attendeeCount === 1 ? (event?.products ?? []) : []
  const hasProductsSelected = Object.values(productQuantities).some(q => q > 0)
  const productsTotal = offeredProducts.reduce((sum, p) => sum + (productQuantities[p.varianteId] ?? 0) * p.price, 0) / 100
  // Clears any chosen product the moment the section itself would stop rendering (switching
  // back to 2+ attendees) — same guard as the membership public form's own canBuyProducts effect.
  useEffect(() => {
    if (attendeeCount !== 1 && hasProductsSelected) setProductQuantities({})
  }, [attendeeCount, hasProductsSelected])

  const total  = ticketsTotal + donationsTotal + productsTotal
  const isPaid = total > 0

  const offlineMethods = (["ESPECES", "CHEQUE", "VIREMENT"] as const).filter(m =>
    m === "ESPECES" ? event?.allowCash : m === "CHEQUE" ? event?.allowCheque : event?.allowTransfer,
  )
  // A multi-attendee order has no single Participation.paymentMethod/ticketPaidAt pair to
  // carry an offline choice for the whole group — same reasoning as the membership public
  // form restricting its own offline chooser to a single registrant (isMulti there). A product
  // is never decremented/sold except via the Stripe webhook (see evenement-products.ts), so it
  // forces online payment the same way as it does on the membership form.
  const showOfflineChoice = attendeeCount === 1 && isPaid && offlineMethods.length > 0 && !hasProductsSelected
  // Same combination that turns showOfflineChoice off above, minus attendeeCount === 1/
  // !hasProductsSelected — the one case where the payment-method section would otherwise just
  // vanish (2+ attendees or a product choice silently forces online payment). Tell the visitor
  // instead of leaving an empty gap where the chooser used to be, same pattern as
  // forcedOnlineByExtras on the membership form.
  const forcedOnlineByMultipleAttendees = attendeeCount > 1 && isPaid && offlineMethods.length > 0 && !!event?.paymentEnabled
  const forcedOnlineByProducts = attendeeCount === 1 && hasProductsSelected && isPaid && offlineMethods.length > 0 && !!event?.paymentEnabled
  useEffect(() => {
    if (!showOfflineChoice && paymentMethod !== "STRIPE") setPaymentMethod("STRIPE")
  }, [showOfflineChoice, paymentMethod])

  // Guards against showing the redirect toast again if the effect re-runs for an unrelated
  // reason (e.g. `t` getting a new identity when the visitor switches language via LocaleSwitcher).
  const shownTicketToast = useRef<string | null>(null)
  useEffect(() => {
    const p = searchParams.get("ticket")
    if (!p || shownTicketToast.current === p) return
    shownTicketToast.current = p
    if (p === "success") {
      // A modal rather than a toast — the buyer just came back from Stripe and needs the
      // "your ticket is on its way by email" message to actually register, not flash by.
      setThankYouOpen(true)
      setPaidSuccess(true)
      // Carried through the Stripe redirect — see the `skipped` param built in the
      // inscription route — since the JSON response's own `skippedEmails` never reaches
      // this page when checkout redirects straight to Stripe instead.
      const skipped = Number(searchParams.get("skipped") ?? 0)
      if (skipped > 0) toast.info(t("attendeesSkipped", { count: skipped }))
    }
    if (p === "cancelled") toast.info(t("toastCancelled"))
    // Drop the param from the URL bar so a refresh, a back/forward navigation, or the
    // visitor forwarding this exact link to someone else doesn't replay the "registration
    // confirmed" state (and donation prompt) for a page they never actually completed.
    router.replace(pathname, { scroll: false })
  }, [searchParams, t, router, pathname])

  // Same guard pattern as the ticket toast above, for the separate round-trip through
  // Stripe when the visitor donates from the post-registration prompt below.
  const shownDonationToast = useRef<string | null>(null)
  useEffect(() => {
    const p = searchParams.get("donation")
    if (!p || shownDonationToast.current === p) return
    shownDonationToast.current = p
    if (p === "success") {
      toast.success(t("toastDonationConfirmed"))
      setDonationCompleted(true)
    }
    if (p === "cancelled") toast.info(t("toastDonationCancelled"))
    router.replace(pathname, { scroll: false })
  }, [searchParams, t, router, pathname])

  const emailValid = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const canSubmit =
    !loading &&
    !!event &&
    !event.full &&
    !event.past &&
    (!isPaid || event.paymentEnabled || (paymentMethod !== "STRIPE" && showOfflineChoice)) &&
    visibleAttendees.every(a =>
      a.firstName.trim() &&
      a.lastName.trim() &&
      emailValid(a.email) &&
      (!hasTicketTypes || (() => {
        const tt = event.ticketTypes.find(tt => tt.id === a.ticketTypeId)
        return !!tt && isTicketTypeAvailable(tt)
      })()) &&
      (event.fieldPhone     !== "REQUIRED" || a.phone.trim()     !== "") &&
      (event.fieldAddress   !== "REQUIRED" || a.address.trim()   !== "") &&
      (event.fieldMobile    !== "REQUIRED" || a.mobile.trim()    !== "") &&
      (event.fieldBirthDate !== "REQUIRED" || a.birthDate.trim() !== "") &&
      (event.fieldGender    !== "REQUIRED" || a.gender !== "") &&
      (event.customFields ?? []).every(f => {
        if (!f.required) return true
        const value = a.answers[f.id]
        return Array.isArray(value) ? value.length > 0 : (value ?? "").trim() !== ""
      }),
    ) &&
    selectedDonations.every(d => (donationAmounts[d.id] ?? Number(d.minAmount)) >= Number(d.minAmount)) &&
    (!event.requireCguvSignature || (conditionsAgreed && signedName.trim() !== ""))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !event) return

    if (new Set(visibleAttendees.map(a => a.email.trim().toLowerCase())).size !== visibleAttendees.length) {
      toast.error(t("duplicateEmail"))
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/public/${slug}/evenements/${id}/inscription`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attendees: visibleAttendees.map(a => ({
            firstName: a.firstName.trim(),
            lastName:  a.lastName.trim(),
            email:     a.email.trim(),
            ticketTypeId: hasTicketTypes ? a.ticketTypeId : undefined,
            phone:     a.phone.trim() || undefined,
            address:   a.address.trim() || undefined,
            mobile:    a.mobile.trim() || undefined,
            birthDate: a.birthDate || undefined,
            gender:    a.gender || undefined,
            answers:   a.answers,
          })),
          website,
          paymentMethod: showOfflineChoice ? paymentMethod : undefined,
          donations: selectedDonations.map(d => ({ ticketTypeId: d.id, amount: donationAmount(d) })),
          products: Object.entries(productQuantities)
            .filter(([, q]) => q > 0)
            .map(([varianteId, quantity]) => ({ varianteId, quantity })),
          conditionsAgreed: event.requireCguvSignature ? conditionsAgreed : undefined,
          signedName:       event.requireCguvSignature ? signedName.trim() : undefined,
          discountCode:     appliedDiscount && attendeeCount === 1 ? appliedDiscount.code : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.code === "INVALID_TICKET_TYPE" || data.code === "TICKET_TYPE_FULL" || data.code === "TICKET_TYPE_NOT_OPEN" || data.code === "TICKET_TYPE_CLOSED") {
          toast.error(
            data.code === "TICKET_TYPE_FULL" ? t("ticketTypeFull")
              : data.code === "TICKET_TYPE_NOT_OPEN" ? t("ticketTypeNotOpenToast")
              : data.code === "TICKET_TYPE_CLOSED" ? t("ticketTypeClosedToast")
              : t("ticketTypeInvalid"),
          )
          // The tier list may have changed server-side since this page loaded (admin edited
          // it, or someone else just took the last spot, or its own sale window opened/closed
          // in the meantime) — refresh it and clear any attendee stuck on a tier that no
          // longer resolves or isn't purchasable anymore, instead of leaving them stuck on a
          // selection that will only ever fail again.
          fetch(`/api/public/${slug}/evenements/${id}`)
            .then(r => r.json())
            .then((d: EventInfo) => {
              setEvent(d)
              setAttendees(prev => prev.map(a => {
                const tt = d.ticketTypes.find(x => x.id === a.ticketTypeId)
                return (!tt || !isTicketTypeAvailable(tt)) ? { ...a, ticketTypeId: "" } : a
              }))
            })
            .catch(() => {})
          return
        }
        if (data.code === "DISCOUNT_CODE_INVALID") {
          toast.error(t("discountCodeInvalid"))
          setAppliedDiscount(null)
          setDiscountCodeStatus("idle")
          return
        }
        if (data.code === "DUPLICATE_EMAIL") { toast.error(t("duplicateEmail")); return }
        if (data.code === "ALREADY_REGISTERED") { toast.error(t("alreadyRegistered", { email: data.email ?? "" })); return }
        toast.error(data.error ?? t("errorGeneric"))
        return
      }
      // Attendees already registered from a previous visit aren't re-charged/re-created —
      // only genuinely new ones go through — so the buyer is told who was carried over.
      if (data.skippedEmails?.length) toast.info(t("attendeesSkipped", { count: data.skippedEmails.length }))
      if (data.url) { window.location.href = data.url; return }
      if (data.waitlisted) { setWaitlisted(true); return }
      setSubmitted(true)
    } catch {
      toast.error(t("errorNetwork"))
    } finally {
      setLoading(false)
    }
  }

  if (loadingEvent) {
    return (
      <>
        {showInAppBrowserBanner && <InAppBrowserBanner>{t("inAppBrowserWarning")}</InAppBrowserBanner>}
        <div className="min-h-screen flex items-center justify-center">
          <div className="size-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      </>
    )
  }

  if (notFound || !event) {
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

  const dateObj = new Date(event.date)

  return (
    <>
      {showInAppBrowserBanner && <InAppBrowserBanner>{t("inAppBrowserWarning")}</InAppBrowserBanner>}
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-start justify-center py-12 px-4">
        <div className={`w-full space-y-6 ${event.imageUrl && isPortrait ? "max-w-5xl" : "max-w-md"}`}>
          <div className="flex justify-end">
            <LocaleSwitcher />
          </div>

          <div className={event.imageUrl && isPortrait ? "grid gap-8 lg:grid-cols-2 items-start" : "space-y-6"}>
            {event.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={event.imageUrl}
                alt={event.title}
                onLoad={e => setIsPortrait(e.currentTarget.naturalHeight > e.currentTarget.naturalWidth)}
                className={
                  isPortrait
                    ? "w-auto h-auto max-w-full max-h-[32rem] mx-auto block rounded-lg lg:sticky lg:top-12"
                    : "w-auto h-auto max-w-full max-h-[26rem] rounded-lg"
                }
              />
            )}
            <div className="space-y-6">
              {/* Header */}
              <div className="text-center space-y-2">
                <div className="inline-flex items-center justify-center size-12 rounded-full bg-primary/10 dark:bg-primary/20 mb-2">
                  <TicketIcon className="size-6 text-primary" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight">{event.title}</h1>
                <p className="text-muted-foreground text-sm">{event.associationName}</p>
              </div>

              {/* Détails */}
              <div className="rounded-lg border bg-card p-4 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CalendarBlankIcon className="size-4 shrink-0" />
                  <span>
                    {dateObj.toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric" })}
                    {" "}
                    {dateObj.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {event.location && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPinIcon className="size-4 shrink-0" />
                    <span>{event.location}</span>
                  </div>
                )}
                {event.description && <RichTextView content={event.description} className="pt-1 text-foreground/90" />}
                {hasTicketTypes ? (
                  <p className="pt-1 font-semibold text-muted-foreground">
                    {event.ticketTypes.length > 1 ? (
                      t("ticketTypeFromPrice", {
                        amount: cheapestAvailableTicketTypePrice(event.ticketTypes).toLocaleString(loc, { style: "currency", currency: "EUR" }),
                      })
                    ) : (
                      <>
                        {event.ticketTypes[0].priceBeforeDiscount && (
                          <span className="mr-1.5 font-normal line-through">
                            {Number(event.ticketTypes[0].priceBeforeDiscount).toLocaleString(loc, { style: "currency", currency: "EUR" })}
                          </span>
                        )}
                        {Number(event.ticketTypes[0].price).toLocaleString(loc, { style: "currency", currency: "EUR" })}
                      </>
                    )}
                  </p>
                ) : event.price && Number(event.price) > 0 && (
                  <p className="pt-1 font-semibold text-muted-foreground">{Number(event.price).toLocaleString(loc, { style: "currency", currency: "EUR" })}</p>
                )}
              </div>

              {waitlisted ? (
                <div className="rounded-lg border bg-card p-6 text-center text-sm space-y-1">
                  <p className="font-medium">{t("waitlistedTitle")}</p>
                  <p className="text-muted-foreground">{t("waitlistedBody")}</p>
                </div>
              ) : submitted || paidSuccess ? (
                <div className="rounded-lg border bg-card p-6 text-center text-sm space-y-3">
                  <div className="space-y-1">
                    <p className="font-medium">{t("submittedTitle")}</p>
                    {event.confirmationMessage ? (
                      <RichTextView content={event.confirmationMessage} className="text-muted-foreground" />
                    ) : (
                      <p className="text-muted-foreground">{t("submittedWithEmail")}</p>
                    )}
                  </div>
                  {event.donationsEnabled && (
                    <EventDonationPrompt
                      slug={slug}
                      evenementId={event.id}
                      associationName={event.associationName}
                      canIssueTaxReceipts={event.canIssueTaxReceipts}
                      inAppBrowser={showInAppBrowserBanner}
                      donationCompleted={donationCompleted}
                      locale={loc}
                      t={t}
                      // A single known attendee is silently assumed to be the donor (frictionless
                      // for the common case) — with more than one, or none (paid path returning
                      // from Stripe with no attendee data left in memory), the identity fields are
                      // shown instead of guessing who's actually donating.
                      donor={
                        submitted && visibleAttendees[0]
                          ? { firstName: visibleAttendees[0].firstName, lastName: visibleAttendees[0].lastName, email: visibleAttendees[0].email }
                          : null
                      }
                      showIdentityFields={!(submitted && visibleAttendees.length === 1 && visibleAttendees[0])}
                    />
                  )}
                </div>
              ) : event.notOpenYet ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {t("notOpenYet")}
                </div>
              ) : event.closed ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {t("registrationClosed")}
                </div>
              ) : event.past ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {t("past")}
                </div>
              ) : event.full || allTicketTypesFull ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {t("full")}
                </div>
              ) : (
                <div className="rounded-lg border bg-card p-6 space-y-4">
                  {isPaid && !event.paymentEnabled && !showOfflineChoice ? (
                    <p className="text-center text-sm text-muted-foreground py-2">{t("paymentDisabled")}</p>
                  ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Honeypot — visually and semantically hidden from real visitors/screen readers,
                        but present in the DOM for bots that blindly fill every input they find. */}
                    <div className="absolute -left-[9999px] w-px h-px overflow-hidden" aria-hidden="true">
                      <label htmlFor="website">{t("honeypotLabel")}</label>
                      <input id="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
                    </div>

                    {maxAttendees > 1 && (
                      <QuantityStepper value={attendeeCount} onChange={setQuantity} max={maxAttendees} label={t("attendeesCountLabel")} />
                    )}

                    {visibleAttendees.map((a, i) => (
                      <AttendeeFields
                        key={i}
                        index={i}
                        attendee={a}
                        onChange={patch => updateAttendee(i, patch)}
                        ticketTypes={event.ticketTypes}
                        customFields={event.customFields}
                        fieldPhone={event.fieldPhone}
                        fieldAddress={event.fieldAddress}
                        fieldBirthDate={event.fieldBirthDate}
                        fieldGender={event.fieldGender}
                        fieldMobile={event.fieldMobile}
                        showHeading={visibleAttendees.length > 1}
                        t={t}
                        loc={loc}
                        slug={slug}
                        id={id}
                      />
                    ))}

                    {donationExtras.length > 0 && (
                      <div className="space-y-3 border-t pt-3">
                        <p className="text-sm font-medium">{t("donationExtrasLabel")}</p>
                        {donationExtras.map(d => {
                          const checked = !!donationSelections[d.id]
                          const amount  = donationAmounts[d.id] ?? Number(d.minAmount)
                          const belowMinimum = checked && amount < Number(d.minAmount)
                          return (
                            <div key={d.id} className="space-y-1">
                              <label className="flex items-center gap-1.5 text-sm">
                                <input
                                  type="checkbox" checked={checked}
                                  onChange={e => setDonationSelections(prev => ({ ...prev, [d.id]: e.target.checked }))}
                                />
                                {d.label}
                              </label>
                              {checked && (
                                <div className="pl-6 space-y-1">
                                  <input
                                    type="number" min={Number(d.minAmount)} step="0.01"
                                    value={amount}
                                    onChange={e => setDonationAmounts(prev => ({ ...prev, [d.id]: Number(e.target.value) }))}
                                    className="h-9 w-32 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                                  />
                                  {belowMinimum && (
                                    <p className="text-xs text-destructive">
                                      {t("belowDonationMinimum", { amount: Number(d.minAmount).toLocaleString(loc, { style: "currency", currency: "EUR" }) })}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {offeredProducts.length > 0 && (
                      <div className="space-y-2 border-t pt-4">
                        <p className="text-sm font-medium">{t("productsLabel")}</p>
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

                    {attendeeCount === 1 && (
                      <div className="space-y-1.5 border-t pt-3">
                        {appliedDiscount ? (
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="text-muted-foreground">
                              {t("discountCodeApplied", { code: appliedDiscount.code })}
                            </span>
                            <button type="button" onClick={handleRemoveDiscountCode} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                              {t("discountCodeRemove")}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-end gap-2">
                            <div className="flex-1 space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("discountCodeLabel")}</label>
                              <input
                                type="text"
                                value={discountCodeInput}
                                onChange={e => { setDiscountCodeInput(e.target.value.toUpperCase()); setDiscountCodeStatus("idle") }}
                                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                              />
                            </div>
                            <Button type="button" variant="outline" size="sm" disabled={!discountCodeInput.trim() || discountCodeStatus === "checking"} onClick={handleApplyDiscountCode}>
                              {t("discountCodeApply")}
                            </Button>
                          </div>
                        )}
                        {discountCodeStatus === "invalid" && (
                          <p className="text-xs text-destructive">{t("discountCodeInvalid")}</p>
                        )}
                        {discountCodeStatus === "notApplicable" && (
                          <p className="text-xs text-destructive">{t("discountCodeNotApplicable")}</p>
                        )}
                      </div>
                    )}

                    {(visibleAttendees.length > 1 || donationsTotal > 0 || productsTotal > 0 || discountAmount > 0) && (
                      <div className="space-y-1 border-t pt-3">
                        {discountAmount > 0 && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">{t("discountAmountLabel")}</span>
                            <span className="tabular-nums">-{discountAmount.toLocaleString(loc, { style: "currency", currency: "EUR" })}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{t("totalLabel")}</span>
                          <span className="font-semibold tabular-nums">{total.toLocaleString(loc, { style: "currency", currency: "EUR" })}</span>
                        </div>
                      </div>
                    )}

                    {showOfflineChoice && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">{t("paymentMethodLabel")}</p>
                        <div className="flex flex-wrap gap-3 text-sm">
                          {event.paymentEnabled && (
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
                        {paymentMethod !== "STRIPE" && event.offlineInstructions && (
                          <p className="text-xs text-muted-foreground">{event.offlineInstructions}</p>
                        )}
                      </div>
                    )}
                    {forcedOnlineByMultipleAttendees && (
                      <p className="text-sm font-medium">
                        {t("paymentMethodLabel")}
                        <span className="font-normal text-muted-foreground"> — {t("paymentMethodOnlineOnlyMultipleAttendees")}</span>
                      </p>
                    )}
                    {forcedOnlineByProducts && (
                      <p className="text-sm font-medium">
                        {t("paymentMethodLabel")}
                        <span className="font-normal text-muted-foreground"> — {t("paymentMethodOnlineOnlyProducts")}</span>
                      </p>
                    )}

                    {event.conditions && (
                      <TermsModal content={event.conditions} triggerLabel={t("viewConditionsLabel")} title={t("conditionsModalTitle")} />
                    )}
                    {!!event.attachments?.length && (
                      <ul className="space-y-1">
                        {event.attachments.map(a => (
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
                    {event.requireCguvSignature && (
                      <div className="space-y-2">
                        <label className="flex items-center gap-1.5 text-sm">
                          <input type="checkbox" checked={conditionsAgreed} onChange={e => setConditionsAgreed(e.target.checked)} />
                          {t("conditionsAgreeLabel")}
                        </label>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("signedNameLabel")}</label>
                          <input
                            type="text" value={signedName} onChange={e => setSignedName(e.target.value)}
                            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                          />
                        </div>
                      </div>
                    )}

                    <Button
                      type="submit"
                      disabled={!canSubmit}
                      loading={loading}
                      className="w-full"
                    >
                      <TicketIcon className="size-4 mr-2" />
                      {isPaid
                        ? t("pay", { amount: total.toLocaleString(loc, { style: "currency", currency: "EUR" }) })
                        : t("submit")}
                    </Button>

                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <ShieldCheckIcon className="size-3.5 shrink-0 mt-0.5" />
                      <p>{t("privacyNote")}</p>
                    </div>
                  </form>
                  )}
                </div>
              )}
              {/* Outside the conditional above on purpose — a visitor who hits notOpenYet/
                  closed/full/past needs a way to reach someone precisely then, not just once
                  the form itself is showing. Same placement convention as
                  membership-form-public-form.tsx's own contact block. */}
              {(event.contactEmail || event.contactPhone) && (
                <p className="pt-2 text-center text-xs text-muted-foreground">
                  {t("contactHelp")}{" "}
                  {event.contactEmail && (
                    <a href={`mailto:${event.contactEmail}`} className="underline underline-offset-2 hover:text-foreground">
                      {event.contactEmail}
                    </a>
                  )}
                  {event.contactEmail && event.contactPhone && <span aria-hidden> · </span>}
                  {event.contactPhone && (
                    <a href={`tel:${event.contactPhone.replace(/\s/g, "")}`} className="underline underline-offset-2 hover:text-foreground">
                      {event.contactPhone}
                    </a>
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={thankYouOpen}
        onOpenChange={setThankYouOpen}
        title={t("thankYouTitle")}
        size="sm"
        footer={
          <Button className="w-full" onClick={() => setThankYouOpen(false)}>
            {t("thankYouClose")}
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">{t("thankYouBody")}</p>
      </Modal>
    </>
  )
}
