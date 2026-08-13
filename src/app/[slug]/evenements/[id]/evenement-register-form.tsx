"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { useTranslations, useLocale } from "next-intl"
import { CalendarBlankIcon, MapPinIcon, TicketIcon, ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { RichTextView } from "@/components/ui/rich-text-view"
import { InAppBrowserBanner } from "@/components/ui/in-app-browser-banner"
import { useInAppBrowserEscape } from "@/hooks/use-in-app-browser-escape"
import { SelectField } from "@/components/ui/select-field"
import { cheapestAvailableTicketTypePrice } from "@/lib/ticket-types"

type CustomField = { id: string; type: "TEXT" | "NUMBER"; label: string; required: boolean }
type TicketType  = { id: string; label: string; price: string; remaining: number | null; full: boolean }

type EventInfo = {
  associationName: string
  id:          string
  title:       string
  description: string | null
  imageUrl:    string | null
  date:        string
  endDate:     string | null
  location:    string | null
  price:       string | null
  capacity:    number | null
  full:            boolean
  past:            boolean
  isPaid:          boolean
  paymentEnabled:  boolean
  customFields:    CustomField[]
  ticketTypes:     TicketType[]
}

type Props = { slug: string; id: string }

export function EvenementRegisterForm(props: Props) {
  return (
    <Suspense fallback={null}>
      <EvenementRegisterFormInner {...props} />
    </Suspense>
  )
}

function EvenementRegisterFormInner({ slug, id }: Props) {
  const searchParams = useSearchParams()
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

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName]   = useState("")
  const [email, setEmail]         = useState("")
  const [phone, setPhone]         = useState("")
  const [address, setAddress]     = useState("")
  const [answers, setAnswers]     = useState<Record<string, string>>({})
  const [website, setWebsite]     = useState("") // honeypot — must stay empty
  const [submitted, setSubmitted] = useState(false)
  const [cancelUrl, setCancelUrl] = useState<string | null>(null)
  const [loading, setLoading]     = useState(false)
  const [ticketTypeId, setTicketTypeId] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/public/${slug}/evenements/${id}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: EventInfo) => setEvent(d))
      .catch(() => setNotFound(true))
      .finally(() => setLoadingEvent(false))
  }, [slug, id, loc])

  // Defaults to the first ticket type once the event (and its tiers, if any) loads —
  // a no-op for events with no ticket types. Prefers a tier that still has room; falls
  // back to the first one (sold out or not) so the picker never shows nothing selected.
  useEffect(() => {
    if (event?.ticketTypes.length && !ticketTypeId) {
      setTicketTypeId((event.ticketTypes.find(tt => !tt.full) ?? event.ticketTypes[0]).id)
    }
  }, [event, ticketTypeId])

  // Guards against showing the redirect toast again if the effect re-runs for an unrelated
  // reason (e.g. `t` getting a new identity when the visitor switches language via LocaleSwitcher).
  const shownTicketToast = useRef<string | null>(null)
  useEffect(() => {
    const p = searchParams.get("ticket")
    if (!p || shownTicketToast.current === p) return
    shownTicketToast.current = p
    if (p === "success") toast.success(t("toastConfirmed"))
    if (p === "cancelled") toast.info(t("toastCancelled"))
  }, [searchParams, t])

  const hasTicketTypes = !!event?.ticketTypes.length
  const selectedTicketType = hasTicketTypes ? event!.ticketTypes.find(tt => tt.id === ticketTypeId) : undefined
  // Every tier sold out is functionally the same as the event itself being full.
  const allTicketTypesFull = hasTicketTypes && event!.ticketTypes.every(tt => tt.full)
  // Ticket types (when the event has any) fully replace the flat price — isPaid reflects the
  // chosen tier, not the ignored event.isPaid, so picking a 0€ tier behaves like a free event.
  const isPaid = hasTicketTypes ? Number(selectedTicketType?.price ?? 0) > 0 : !!event?.isPaid
  const canSubmit =
    !loading &&
    !!event &&
    !event.full &&
    !event.past &&
    (!isPaid || event.paymentEnabled) &&
    (!hasTicketTypes || (!!selectedTicketType && !selectedTicketType.full)) &&
    firstName.trim() &&
    lastName.trim() &&
    (!isPaid || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) &&
    (event.customFields ?? []).every(f => !f.required || (answers[f.id] ?? "").trim() !== "")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !event) return
    setLoading(true)
    try {
      const res = await fetch(`/api/public/${slug}/evenements/${id}/inscription`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName:  lastName.trim(),
          email:     email.trim() || undefined,
          phone:     phone.trim() || undefined,
          address:   address.trim() || undefined,
          answers,
          website,
          ticketTypeId: hasTicketTypes ? ticketTypeId : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.code === "INVALID_TICKET_TYPE" || data.code === "TICKET_TYPE_FULL") {
          if (data.code === "TICKET_TYPE_FULL") {
            // The server's error text is in the event's original authoring language, not the
            // visitor's — use the label from our own already-translated ticketTypes instead.
            const fullLabel = event?.ticketTypes.find(tt => tt.id === ticketTypeId)?.label
            toast.error(fullLabel ? t("ticketTypeFullNamed", { label: fullLabel }) : t("ticketTypeFull"))
          } else {
            toast.error(t("ticketTypeInvalid"))
          }
          // The tier list may have changed server-side since this page loaded (admin edited
          // it, or someone else just took the last spot) — refresh it instead of leaving the
          // visitor stuck on a selection that will only ever fail again.
          fetch(`/api/public/${slug}/evenements/${id}`)
            .then(r => r.json())
            .then((d: EventInfo) => { setEvent(d); setTicketTypeId(null) })
            .catch(() => {})
          return
        }
        toast.error(data.error ?? t("errorGeneric"))
        return
      }
      if (data.url) { window.location.href = data.url; return }
      if (data.cancelUrl) setCancelUrl(data.cancelUrl)
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
                    {event.ticketTypes.length > 1
                      ? t("ticketTypeFromPrice", {
                          amount: cheapestAvailableTicketTypePrice(event.ticketTypes).toLocaleString(loc, { style: "currency", currency: "EUR" }),
                        })
                      : Number(event.ticketTypes[0].price).toLocaleString(loc, { style: "currency", currency: "EUR" })}
                  </p>
                ) : event.price && Number(event.price) > 0 && (
                  <p className="pt-1 font-semibold text-muted-foreground">{Number(event.price).toLocaleString(loc, { style: "currency", currency: "EUR" })}</p>
                )}
              </div>

              {submitted ? (
                <div className="rounded-lg border p-6 text-center text-sm space-y-3">
                  <div className="space-y-1">
                    <p className="font-medium">{t("submittedTitle")}</p>
                    <p className="text-muted-foreground">
                      {email ? t("submittedWithEmail") : t("submittedNoEmail")}
                    </p>
                  </div>
                  {!email && cancelUrl && (
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={cancelUrl}
                        onFocus={e => e.currentTarget.select()}
                        className="min-w-0 flex-1 rounded-md border border-input bg-muted/40 px-2.5 py-1.5 text-xs text-foreground outline-none"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(cancelUrl)
                          toast.success(t("linkCopied"))
                        }}
                      >
                        {t("copyLink")}
                      </Button>
                    </div>
                  )}
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
                  {/* Hoisted out of the form below: switching tiers must always stay possible,
                      even while the currently-selected tier can't be paid for (e.g. Stripe not
                      set up) — otherwise picking a paid tier would hide this control along with
                      the rest of the form, trapping the visitor with no way back to a free one. */}
                  {hasTicketTypes && (
                    <SelectField
                      label={t("ticketTypeLabel")}
                      value={ticketTypeId ?? undefined}
                      onValueChange={setTicketTypeId}
                      options={event.ticketTypes.map(tt => ({
                        value: tt.id,
                        disabled: tt.full,
                        label: `${tt.label} — ${Number(tt.price) === 0 ? t("ticketTypeFree") : Number(tt.price).toLocaleString(loc, { style: "currency", currency: "EUR" })}${tt.full ? ` (${t("ticketTypeSoldOut")})` : ""}`,
                      }))}
                    />
                  )}

                  {isPaid && !event.paymentEnabled ? (
                    <p className="text-center text-sm text-muted-foreground py-2">{t("paymentDisabled")}</p>
                  ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Honeypot — visually and semantically hidden from real visitors/screen readers,
                        but present in the DOM for bots that blindly fill every input they find. */}
                    <div className="absolute -left-[9999px] w-px h-px overflow-hidden" aria-hidden="true">
                      <label htmlFor="website">{t("honeypotLabel")}</label>
                      <input id="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("firstNameLabel")}</label>
                        <input
                          type="text" required value={firstName} onChange={e => setFirstName(e.target.value)}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("lastNameLabel")}</label>
                        <input
                          type="text" required value={lastName} onChange={e => setLastName(e.target.value)}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {isPaid ? t("emailLabelRequired") : t("emailLabelOptional")}
                      </label>
                      <input
                        type="email" required={isPaid} value={email} onChange={e => setEmail(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                      />
                      {!isPaid && (
                        <p className="text-xs text-muted-foreground">{t("emailNoConfirmHint")}</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("phoneLabel")}</label>
                      <input
                        type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("addressLabel")}</label>
                      <input
                        type="text" value={address} onChange={e => setAddress(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>

                    {event.customFields.map(field => (
                      <div key={field.id} className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          {field.required ? t("customFieldRequired", { label: field.label }) : t("customFieldOptional", { label: field.label })}
                        </label>
                        <input
                          type={field.type === "NUMBER" ? "number" : "text"}
                          min={field.type === "NUMBER" ? 0 : undefined}
                          step={field.type === "NUMBER" ? 1 : undefined}
                          inputMode={field.type === "NUMBER" ? "numeric" : undefined}
                          required={field.required}
                          value={answers[field.id] ?? ""}
                          onChange={e => setAnswers(prev => ({ ...prev, [field.id]: e.target.value }))}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                    ))}

                    <Button
                      type="submit"
                      disabled={!canSubmit}
                      loading={loading}
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/85"
                    >
                      <TicketIcon className="size-4 mr-2" />
                      {isPaid
                        ? t("pay", { amount: Number(hasTicketTypes ? selectedTicketType?.price : event.price).toLocaleString(loc, { style: "currency", currency: "EUR" }) })
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
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
