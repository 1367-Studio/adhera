"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { useTranslations, useLocale } from "next-intl"
import { CalendarBlankIcon, MapPinIcon, TicketIcon, ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { LocaleSwitcher } from "@/components/layout/locale-switcher"

type CustomField = { id: string; type: "TEXT" | "NUMBER"; label: string; required: boolean }

type EventInfo = {
  associationName: string
  id:          string
  title:       string
  description: string | null
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

  const [event, setEvent]     = useState<EventInfo | null>(null)
  const [loadingEvent, setLoadingEvent] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName]   = useState("")
  const [email, setEmail]         = useState("")
  const [phone, setPhone]         = useState("")
  const [address, setAddress]     = useState("")
  const [answers, setAnswers]     = useState<Record<string, string>>({})
  const [website, setWebsite]     = useState("") // honeypot — must stay empty
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading]     = useState(false)

  useEffect(() => {
    fetch(`/api/public/${slug}/evenements/${id}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: EventInfo) => setEvent(d))
      .catch(() => setNotFound(true))
      .finally(() => setLoadingEvent(false))
  }, [slug, id])

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

  const isPaid = !!event?.isPaid
  const canSubmit =
    !loading &&
    !!event &&
    !event.full &&
    !event.past &&
    (!isPaid || event.paymentEnabled) &&
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
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? t("errorGeneric")); return }
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="size-6 rounded-full border-2 border-violet-600 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (notFound || !event) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-4 gap-4">
        <p className="text-muted-foreground">{t("notFound")}</p>
        <LocaleSwitcher />
      </div>
    )
  }

  const dateObj = new Date(event.date)

  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50/60 to-background flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-end">
          <LocaleSwitcher />
        </div>

        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center size-12 rounded-full bg-violet-100 dark:bg-violet-900/30 mb-2">
            <TicketIcon className="size-6 text-violet-600 dark:text-violet-400" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{event.title}</h1>
          <p className="text-muted-foreground text-sm">{event.associationName}</p>
        </div>

        {/* Détails */}
        <div className="rounded-xl border bg-card shadow-sm p-4 space-y-2 text-sm">
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
          {event.description && <p className="pt-1 text-foreground/90 whitespace-pre-line">{event.description}</p>}
          {event.price && Number(event.price) > 0 && (
            <p className="pt-1 font-semibold text-violet-700 dark:text-violet-400">{Number(event.price).toLocaleString(loc, { style: "currency", currency: "EUR" })}</p>
          )}
        </div>

        {submitted ? (
          <div className="rounded-xl border p-6 text-center text-sm space-y-1">
            <p className="font-medium">{t("submittedTitle")}</p>
            <p className="text-muted-foreground">
              {email ? t("submittedWithEmail") : t("submittedNoEmail")}
            </p>
          </div>
        ) : event.past ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("past")}
          </div>
        ) : event.full ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("full")}
          </div>
        ) : isPaid && !event.paymentEnabled ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("paymentDisabled")}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-xl border bg-card shadow-sm p-6 space-y-4">
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
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-400"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("lastNameLabel")}</label>
                <input
                  type="text" required value={lastName} onChange={e => setLastName(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-400"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {isPaid ? t("emailLabelRequired") : t("emailLabelOptional")}
              </label>
              <input
                type="email" required={isPaid} value={email} onChange={e => setEmail(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-400"
              />
              {!isPaid && (
                <p className="text-xs text-muted-foreground">{t("emailNoConfirmHint")}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("phoneLabel")}</label>
              <input
                type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-400"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("addressLabel")}</label>
              <input
                type="text" value={address} onChange={e => setAddress(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-400"
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
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-400"
                />
              </div>
            ))}

            <Button
              type="submit"
              disabled={!canSubmit}
              loading={loading}
              className="w-full bg-violet-600 hover:bg-violet-700 text-white"
            >
              <TicketIcon className="size-4 mr-2" />
              {isPaid
                ? t("pay", { amount: Number(event.price).toLocaleString(loc, { style: "currency", currency: "EUR" }) })
                : t("submit")}
            </Button>

            <div className="flex gap-2 text-xs text-muted-foreground">
              <ShieldCheckIcon className="size-3.5 shrink-0 mt-0.5" />
              <p>{t("privacyNote")}</p>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
