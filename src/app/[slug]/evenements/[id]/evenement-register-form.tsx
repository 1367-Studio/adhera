"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { toast } from "sonner"
import { useTranslations, useLocale } from "next-intl"
import { CalendarBlankIcon, MapPinIcon, TicketIcon, ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { RichTextView } from "@/components/ui/rich-text-view"
import { InAppBrowserBanner } from "@/components/ui/in-app-browser-banner"
import { useInAppBrowserEscape } from "@/hooks/use-in-app-browser-escape"
import { SelectField } from "@/components/ui/select-field"
import { QuantityStepper } from "@/components/ui/quantity-stepper"
import { EventDonationPrompt } from "@/components/public/event-donation-prompt"
import { cheapestAvailableTicketTypePrice } from "@/lib/ticket-types"

const MAX_QUANTITY = 10

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
  remainingCapacity: number | null
  full:            boolean
  past:            boolean
  isPaid:          boolean
  paymentEnabled:  boolean
  donationsEnabled: boolean
  canIssueTaxReceipts: boolean
  customFields:    CustomField[]
  ticketTypes:     TicketType[]
}

type Attendee = {
  firstName:    string
  lastName:     string
  email:        string
  ticketTypeId: string
  phone:        string
  address:      string
  answers:      Record<string, string>
}

const EMPTY_ATTENDEE: Attendee = { firstName: "", lastName: "", email: "", ticketTypeId: "", phone: "", address: "", answers: {} }

type Props = { slug: string; id: string }

export function EvenementRegisterForm(props: Props) {
  return (
    <Suspense fallback={null}>
      <EvenementRegisterFormInner {...props} />
    </Suspense>
  )
}

function AttendeeFields({
  index,
  attendee,
  onChange,
  ticketTypes,
  customFields,
  showHeading,
  t,
  loc,
}: {
  index:        number
  attendee:     Attendee
  onChange:     (patch: Partial<Attendee>) => void
  ticketTypes:  TicketType[]
  customFields: CustomField[]
  showHeading:  boolean
  t:            ReturnType<typeof useTranslations>
  loc:          string
}) {
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
        <SelectField
          id={`ticket-type-${index}`}
          label={t("ticketTypeLabel")}
          value={attendee.ticketTypeId || undefined}
          onValueChange={v => onChange({ ticketTypeId: v })}
          options={ticketTypes.map(tt => {
            const price = Number(tt.price) === 0 ? t("ticketTypeFree") : Number(tt.price).toLocaleString(loc, { style: "currency", currency: "EUR" })
            const suffix = tt.full ? ` (${t("ticketTypeSoldOut")})` : (tt.remaining != null ? ` (${t("ticketTypeRemaining", { count: tt.remaining })})` : "")
            return { value: tt.id, disabled: tt.full, label: `${tt.label} — ${price}${suffix}` }
          })}
        />
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("phoneLabel")}</label>
        <input
          type="tel" value={attendee.phone} onChange={e => onChange({ phone: e.target.value })}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("addressLabel")}</label>
        <input
          type="text" value={attendee.address} onChange={e => onChange({ address: e.target.value })}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {customFields.map(field => (
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
            value={attendee.answers[field.id] ?? ""}
            onChange={e => onChange({ answers: { ...attendee.answers, [field.id]: e.target.value } })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      ))}
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
  const [paidSuccess, setPaidSuccess] = useState(false)
  const [donationCompleted, setDonationCompleted] = useState(false)
  const [loading, setLoading]         = useState(false)

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
    const defaultTicketTypeId = (event.ticketTypes.find(tt => !tt.full) ?? event.ticketTypes[0]).id
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
      const inherited = hasTicketTypes && !!lastTicketTypeId && !event!.ticketTypes.find(tt => tt.id === lastTicketTypeId)?.full
      const defaultTicketTypeId = hasTicketTypes
        ? (inherited ? lastTicketTypeId! : (event!.ticketTypes.find(tt => !tt.full) ?? event!.ticketTypes[0]).id)
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
  const total  = visibleAttendees.reduce((sum, a) => sum + seatPrice(a), 0)
  const isPaid = total > 0

  // Guards against showing the redirect toast again if the effect re-runs for an unrelated
  // reason (e.g. `t` getting a new identity when the visitor switches language via LocaleSwitcher).
  const shownTicketToast = useRef<string | null>(null)
  useEffect(() => {
    const p = searchParams.get("ticket")
    if (!p || shownTicketToast.current === p) return
    shownTicketToast.current = p
    if (p === "success") {
      toast.success(t("toastConfirmed"))
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
    (!isPaid || event.paymentEnabled) &&
    visibleAttendees.every(a =>
      a.firstName.trim() &&
      a.lastName.trim() &&
      emailValid(a.email) &&
      (!hasTicketTypes || (!!a.ticketTypeId && !event.ticketTypes.find(tt => tt.id === a.ticketTypeId)?.full)) &&
      (event.customFields ?? []).every(f => !f.required || (a.answers[f.id] ?? "").trim() !== ""),
    )

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
            answers:   a.answers,
          })),
          website,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.code === "INVALID_TICKET_TYPE" || data.code === "TICKET_TYPE_FULL") {
          toast.error(data.code === "TICKET_TYPE_FULL" ? t("ticketTypeFull") : t("ticketTypeInvalid"))
          // The tier list may have changed server-side since this page loaded (admin edited
          // it, or someone else just took the last spot) — refresh it and clear any attendee
          // stuck on a tier that no longer resolves or is now full, instead of leaving them
          // stuck on a selection that will only ever fail again.
          fetch(`/api/public/${slug}/evenements/${id}`)
            .then(r => r.json())
            .then((d: EventInfo) => {
              setEvent(d)
              setAttendees(prev => prev.map(a => {
                const tt = d.ticketTypes.find(x => x.id === a.ticketTypeId)
                return (!tt || tt.full) ? { ...a, ticketTypeId: "" } : a
              }))
            })
            .catch(() => {})
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

              {submitted || paidSuccess ? (
                <div className="rounded-lg border bg-card p-6 text-center text-sm space-y-3">
                  <div className="space-y-1">
                    <p className="font-medium">{t("submittedTitle")}</p>
                    <p className="text-muted-foreground">{t("submittedWithEmail")}</p>
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
                        showHeading={visibleAttendees.length > 1}
                        t={t}
                        loc={loc}
                      />
                    ))}

                    {visibleAttendees.length > 1 && (
                      <div className="flex items-center justify-between text-sm border-t pt-3">
                        <span className="text-muted-foreground">{t("totalLabel")}</span>
                        <span className="font-semibold tabular-nums">{total.toLocaleString(loc, { style: "currency", currency: "EUR" })}</span>
                      </div>
                    )}

                    <Button
                      type="submit"
                      disabled={!canSubmit}
                      loading={loading}
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/85"
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
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
