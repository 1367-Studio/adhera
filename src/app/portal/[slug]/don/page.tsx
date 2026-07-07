"use client"

import { useState, useEffect, Suspense } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { HandshakeIcon, InfoIcon, ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const SUGGESTED = [10, 20, 50, 100]

type AssocInfo = {
  name:               string
  canIssueTaxReceipts: boolean
}

export default function PublicDonPage() {
  return (
    <Suspense fallback={null}>
      <PublicDonPageInner />
    </Suspense>
  )
}

function PublicDonPageInner() {
  const { slug }       = useParams<{ slug: string }>()
  const searchParams   = useSearchParams()

  const [assoc, setAssoc]             = useState<AssocInfo | null>(null)
  const [loadingAssoc, setLoadingAssoc] = useState(true)

  const [selected, setSelected]   = useState<number | null>(null)
  const [custom, setCustom]       = useState("")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName]   = useState("")
  const [email, setEmail]         = useState("")
  const [address, setAddress]     = useState("")
  const [message, setMessage]     = useState("")
  const [anonymous, setAnonymous] = useState(false)
  const [loading, setLoading]     = useState(false)

  useEffect(() => {
    fetch(`/api/public/${slug}/don`)
      .then(r => r.json())
      .then((d: { name?: string; canIssueTaxReceipts?: boolean }) => {
        setAssoc({ name: d.name ?? "", canIssueTaxReceipts: d.canIssueTaxReceipts ?? false })
      })
      .catch(() => setAssoc({ name: "", canIssueTaxReceipts: false }))
      .finally(() => setLoadingAssoc(false))
  }, [slug])

  useEffect(() => {
    const p = searchParams.get("payment")
    if (p === "success") toast.success("Merci pour votre don ! Un e-mail de confirmation vous a été envoyé.")
    if (p === "cancelled") toast.info("Don annulé.")
  }, [searchParams])

  const amount = selected ?? (custom ? parseFloat(custom.replace(",", ".")) : null)
  const canSubmit =
    !loading &&
    !!amount && amount > 0 &&
    firstName.trim() &&
    lastName.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !amount) return
    setLoading(true)
    try {
      const res = await fetch(`/api/public/${slug}/don`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName:  lastName.trim(),
          email:     email.trim(),
          address:   address.trim() || undefined,
          amount,
          message:   message.trim() || undefined,
          anonymous,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Erreur"); return }
      window.location.href = data.url
    } catch {
      toast.error("Erreur réseau")
    } finally {
      setLoading(false)
    }
  }

  if (loadingAssoc) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="size-6 rounded-full border-2 border-violet-600 border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50/60 to-background flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center size-12 rounded-full bg-violet-100 dark:bg-violet-900/30 mb-2">
            <HandshakeIcon className="size-6 text-violet-600 dark:text-violet-400" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Faire un don</h1>
          {assoc?.name && (
            <p className="text-muted-foreground text-sm">à <strong>{assoc.name}</strong></p>
          )}
        </div>

        {/* Avantage fiscal */}
        {assoc?.canIssueTaxReceipts && (
          <div className="rounded-xl border border-violet-200 bg-violet-50/80 dark:bg-violet-950/20 p-4 flex gap-3">
            <InfoIcon className="size-4 text-violet-600 shrink-0 mt-0.5" />
            <div className="text-sm text-violet-800 dark:text-violet-300 space-y-1">
              <p className="font-semibold">Votre don est déductible des impôts</p>
              <p className="text-xs text-violet-700 dark:text-violet-400">
                75 % de réduction jusqu'à 1 000 €, puis 66 % — Art. 200 CGI.
                Un reçu fiscal vous sera envoyé par e-mail.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="rounded-xl border bg-card shadow-sm p-6 space-y-5">
          {/* Montants suggérés */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Montant</label>
            <div className="grid grid-cols-4 gap-2">
              {SUGGESTED.map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => { setSelected(v); setCustom("") }}
                  className={cn(
                    "rounded-lg border py-2.5 text-sm font-semibold transition-colors",
                    selected === v && !custom
                      ? "bg-violet-600 border-violet-600 text-white"
                      : "border-input hover:border-violet-400 hover:text-violet-700",
                  )}
                >
                  {v} €
                </button>
              ))}
            </div>
            <div className="relative">
              <input
                type="number"
                min="1"
                step="0.01"
                placeholder="Autre montant (€)"
                value={custom}
                onChange={e => { setCustom(e.target.value); setSelected(null) }}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-400"
              />
            </div>
          </div>

          {/* Identité */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prénom *</label>
              <input
                type="text"
                required
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-400"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nom *</label>
              <input
                type="text"
                required
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-400"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">E-mail *</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Adresse {assoc?.canIssueTaxReceipts ? "(recommandée pour le reçu fiscal)" : "(optionnelle)"}
            </label>
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Ex : 12 rue de la Paix, 75001 Paris"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Message (optionnel)</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Un message pour l'association…"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-400 resize-none"
            />
          </div>

          {/* Anonymat */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={e => setAnonymous(e.target.checked)}
              className="mt-0.5 rounded border-input accent-violet-600"
            />
            <span className="text-sm text-muted-foreground">
              Je souhaite rester anonyme (mon nom ne sera pas affiché dans la liste des donateurs)
            </span>
          </label>

          <Button
            type="submit"
            disabled={!canSubmit}
            loading={loading}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white"
          >
            <HandshakeIcon className="size-4 mr-2" />
            Faire un don{amount && amount > 0 ? ` de ${amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}` : ""}
          </Button>

          {/* RGPD */}
          <div className="flex gap-2 text-xs text-muted-foreground">
            <ShieldCheckIcon className="size-3.5 shrink-0 mt-0.5" />
            <p>
              Vos données (nom, e-mail) sont collectées uniquement pour la confirmation du paiement et
              l'émission du reçu fiscal (Art. 200 CGI). Aucune utilisation commerciale. Durée de
              conservation : 6 ans minimum (obligation fiscale).
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
