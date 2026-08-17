"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { HandshakeIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { CurrencyInput } from "@/components/ui/currency-field"
import { cn } from "@/lib/utils"

const SUGGESTED_AMOUNTS = [5, 10, 20]
const emailValid = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

type Props = {
  slug:            string
  evenementId:     string
  associationName: string
  // Prefill values when a single attendee was just registered (free path, same render) —
  // null on the paid path, where this component mounts fresh after the Stripe redirect
  // back with no attendee data left in memory.
  donor:              { firstName: string; lastName: string; email: string } | null
  // Identity fields are shown (prefilled from `donor` when available, editable) whenever
  // there's no single unambiguous donor to silently assume — either no attendee data at
  // all, or more than one attendee, where guessing attendee #1 as the donor would be wrong
  // as often as not (e.g. a parent registering several kids).
  showIdentityFields: boolean
  canIssueTaxReceipts: boolean
  // Instagram/Facebook in-app browsers frequently swallow target="_blank" — this page
  // already has to work around that for its own registration flow (see
  // useInAppBrowserEscape), so the same signal is reused here to fall back to same-tab.
  inAppBrowser:       boolean
  donationCompleted:  boolean
  locale:             string
  t:                  ReturnType<typeof useTranslations>
}

const inputClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"

// A lighter, event-scoped sibling of the standalone /portal/[slug]/don form — no
// company/SIRET/tax-receipt fields, donor identity is reused from registration when it's
// unambiguous. Shown as a nudge after registration, never as a blocking step.
export function EventDonationPrompt({
  slug, evenementId, associationName, donor, showIdentityFields, canIssueTaxReceipts,
  inAppBrowser, donationCompleted, locale, t,
}: Props) {
  const [amount, setAmount]   = useState(SUGGESTED_AMOUNTS[1])
  const [loading, setLoading] = useState(false)
  const [firstName, setFirstName] = useState(donor?.firstName ?? "")
  const [lastName, setLastName]   = useState(donor?.lastName ?? "")
  const [email, setEmail]         = useState(donor?.email ?? "")

  const identityValid = !!firstName.trim() && !!lastName.trim() && emailValid(email)

  async function handleDonate() {
    if (amount <= 0 || !identityValid || loading) return
    setLoading(true)
    try {
      const res = await fetch(`/api/public/${slug}/don`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          donorType: "INDIVIDUAL",
          firstName: firstName.trim(),
          lastName:  lastName.trim(),
          email:     email.trim(),
          amount,
          evenementId,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? t("errorGeneric")); return }
      window.location.href = data.url
    } catch {
      toast.error(t("errorNetwork"))
    } finally {
      setLoading(false)
    }
  }

  // Once a donation actually completed (visitor returned from Stripe with
  // donation=success), leave the amount/identity form behind rather than sitting there
  // ready to fire again — no reason to invite an accidental second donation.
  if (donationCompleted) {
    return (
      <div className="border-t pt-4 text-center text-sm">
        <p className="font-medium">{t("donationPrompt.thanksTitle")}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 border-t pt-4 text-left">
      <div className="space-y-0.5">
        <p className="font-medium">{t("donationPrompt.title")}</p>
        <p className="text-muted-foreground text-sm">{t("donationPrompt.subtitle", { associationName })}</p>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          {SUGGESTED_AMOUNTS.map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(v)}
              className={cn(
                "h-9 rounded-md border text-sm font-medium transition-colors",
                amount === v
                  ? "bg-primary border-primary text-primary-foreground"
                  : "border-input hover:border-primary/50",
              )}
            >
              {v} €
            </button>
          ))}
        </div>
        <CurrencyInput value={amount} onChange={setAmount} />
      </div>

      {showIdentityFields && (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("firstNameLabel")}</span>
            <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} className={inputClass} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("lastNameLabel")}</span>
            <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} className={inputClass} />
          </label>
          <label className="col-span-2 space-y-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("emailLabel")}</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputClass} />
            {email.length > 0 && !emailValid(email) && (
              <p className="text-xs text-amber-600">{t("donationPrompt.emailInvalid")}</p>
            )}
          </label>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        className="w-full"
        loading={loading}
        disabled={amount <= 0 || !identityValid}
        onClick={handleDonate}
      >
        <HandshakeIcon className="size-4" />
        {t("donationPrompt.submit", { amount: amount.toLocaleString(locale, { style: "currency", currency: "EUR" }) })}
      </Button>

      <p className="text-center text-[11px] text-muted-foreground">{t("donationPrompt.privacyNote")}</p>

      <Link
        href={`/portal/${slug}/don`}
        target={inAppBrowser ? undefined : "_blank"}
        rel={inAppBrowser ? undefined : "noopener noreferrer"}
        className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {t(canIssueTaxReceipts ? "donationPrompt.receiptLink" : "donationPrompt.receiptLinkNoTax")}
      </Link>
    </div>
  )
}
