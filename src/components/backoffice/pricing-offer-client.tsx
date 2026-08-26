"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PlusIcon, CopyIcon, CheckIcon, TrashIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { BASE_PATH } from "@/lib/env"
import { APP_NAME } from "@/config/brand"

// amount in euros, same convention as every other CurrencyField in the app (e.g.
// cotisation-form.tsx) — converted to cents only right before hitting the API.
type PhaseInput = { amount: number; months: string }

const PLAN_OPTIONS = [
  { value: "ESSENTIAL", label: "Essentiel" },
  { value: "PRO",       label: "Pro" },
]

function toCents(amountEuros: number): number | null {
  const n = Math.round(amountEuros * 100)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function NewPricingOfferButton() {
  const router = useRouter()
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState("")

  const [label,    setLabel]    = useState("")
  const [planTier, setPlanTier] = useState("ESSENTIAL")
  const [phases,   setPhases]   = useState<PhaseInput[]>([{ amount: 0, months: "" }])
  const [lastOpenEnded, setLastOpenEnded] = useState(true)
  // Empty = no expiry (link stays redeemable indefinitely until manually revoked).
  const [expiresInDays, setExpiresInDays] = useState("")

  // What the person actually gets, shown right away so a typo (0 instead of 6 months,
  // forgetting to convert to cents) is caught before submitting — not something to
  // discover after the offer is already live.
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function reset() {
    setLabel(""); setPlanTier("ESSENTIAL"); setPhases([{ amount: 0, months: "" }])
    setLastOpenEnded(true); setExpiresInDays(""); setError(""); setGeneratedLink(null); setCopied(false)
  }

  function updatePhase(i: number, patch: Partial<PhaseInput>) {
    setPhases(prev => prev.map((p, idx) => idx === i ? { ...p, ...patch } : p))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (!label.trim()) { setError("Le libellé est obligatoire."); return }

    const parsedPhases = phases.map((p, i) => {
      const isLast = i === phases.length - 1
      const amountCents = toCents(p.amount)
      const openEnded = isLast && lastOpenEnded
      const months = openEnded ? null : parseInt(p.months, 10)
      return { amountCents, months, openEnded }
    })
    if (parsedPhases.some(p => p.amountCents === null)) { setError("Chaque phase a besoin d'un montant valide."); return }
    if (parsedPhases.some(p => !p.openEnded && (!Number.isInteger(p.months) || (p.months as number) <= 0))) {
      setError("Chaque phase (sauf la dernière si « récurrente sans fin ») a besoin d'une durée en mois.")
      return
    }

    const expiresInDaysNum = expiresInDays.trim() ? parseInt(expiresInDays, 10) : null
    if (expiresInDaysNum !== null && (!Number.isInteger(expiresInDaysNum) || expiresInDaysNum <= 0)) {
      setError("La validité doit être un nombre de jours positif, ou vide pour aucune expiration.")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/backoffice/pricing-offers", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          planTier,
          phases: parsedPhases.map(p => ({ amountCents: p.amountCents, months: p.months })),
          expiresAt: expiresInDaysNum !== null
            ? new Date(Date.now() + expiresInDaysNum * 86_400_000).toISOString()
            : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erreur lors de la création de l'offre")

      setGeneratedLink(`${window.location.origin}${BASE_PATH}/register?offer=${data.token}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur")
    } finally {
      setLoading(false)
    }
  }

  async function copyLink() {
    if (!generatedLink) return
    try {
      await navigator.clipboard.writeText(generatedLink)
      setCopied(true)
      toast.success("Lien copié")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Copie impossible. Sélectionnez le lien manuellement.")
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon className="mr-1.5 size-4" />
        Nouvelle offre
      </Button>

      <Modal
        open={open}
        onOpenChange={(v) => { setOpen(v); if (!v) reset() }}
        title="Nouvelle offre tarifaire"
        description="Lien d'inscription à usage unique : le prix négocié remplace le choix Essentiel/Pro standard."
        size="lg"
        footer={generatedLink ? (
          <Button onClick={() => { setOpen(false); reset() }}>Fermer</Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Annuler</Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? "Création…" : "Créer l'offre"}
            </Button>
          </>
        )}
      >
        {generatedLink ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Offre créée. Envoyez ce lien au client : il ne fonctionne qu&apos;une seule fois.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={generatedLink} onFocus={e => e.currentTarget.select()} className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copyLink} aria-label="Copier le lien">
                {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-1">
            <FormField
              label="Libellé interne"
              placeholder="Cliente X, lancement"
              value={label}
              onChange={e => setLabel(e.target.value)}
              hint="Visible uniquement au backoffice, jamais au client."
              required
            />

            <SelectField
              label="Plan"
              options={PLAN_OPTIONS}
              value={planTier}
              onValueChange={setPlanTier}
              required
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Phases</span>
                <Button
                  type="button" variant="ghost" size="sm"
                  onClick={() => setPhases(prev => [...prev, { amount: 0, months: "" }])}
                >
                  <PlusIcon className="mr-1 size-3.5" />
                  Ajouter une phase
                </Button>
              </div>

              {phases.map((phase, i) => {
                const isLast = i === phases.length - 1
                const openEnded = isLast && lastOpenEnded
                return (
                  <div key={i} className="flex items-end gap-2">
                    <CurrencyField
                      label={`Phase ${i + 1} : montant`}
                      value={phase.amount}
                      onChange={v => updatePhase(i, { amount: v })}
                      required
                    />
                    <FormField
                      label="Durée (mois)"
                      type="number" min="1"
                      placeholder="6"
                      value={phase.months}
                      onChange={e => updatePhase(i, { months: e.target.value })}
                      disabled={openEnded}
                      required={!openEnded}
                    />
                    {phases.length > 1 && (
                      <Button
                        type="button" variant="ghost" size="icon"
                        onClick={() => setPhases(prev => prev.filter((_, idx) => idx !== i))}
                        aria-label="Supprimer cette phase"
                      >
                        <XIcon className="size-4" />
                      </Button>
                    )}
                  </div>
                )
              })}

              <CheckboxField
                id="last-open-ended"
                label="La dernière phase est récurrente sans fin (facturée jusqu'à annulation)"
                checked={lastOpenEnded}
                onChange={e => setLastOpenEnded(e.target.checked)}
              />
              {!lastOpenEnded && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Attention : sans phase finale « récurrente », l&apos;abonnement se termine et l&apos;accès à {APP_NAME} est automatiquement coupé dès la fin de la dernière phase. Si le prix doit repasser au tarif standard Essentiel/Pro ensuite, il faudra le refaire manuellement avant cette date.
                </p>
              )}
            </div>

            <FormField
              label="Validité du lien (jours)"
              type="number" min="1"
              placeholder="Illimitée"
              value={expiresInDays}
              onChange={e => setExpiresInDays(e.target.value)}
              hint="Laissez vide pour un lien sans expiration."
            />

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
            )}
          </form>
        )}
      </Modal>
    </>
  )
}

export function PricingOfferRowActions({ id, token, status }: { id: string; token: string; status: string }) {
  const router = useRouter()
  const [copied, setCopied]   = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [revoking, setRevoking] = useState(false)

  const link = `${typeof window !== "undefined" ? window.location.origin : ""}${BASE_PATH}/register?offer=${token}`

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      toast.success("Lien copié")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Copie impossible. Sélectionnez le lien manuellement.")
    }
  }

  async function revoke() {
    setRevoking(true)
    try {
      const res = await fetch(`/api/backoffice/pricing-offers/${id}`, { method: "PATCH" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erreur")
      toast.success("Offre révoquée")
      setConfirmOpen(false)
      router.refresh()
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {status === "PENDING" && (
        <>
          <Button variant="ghost" size="icon-sm" onClick={copyLink} aria-label="Copier le lien">
            {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setConfirmOpen(true)} aria-label="Révoquer l'offre">
            <TrashIcon className="size-3.5" />
          </Button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Révoquer cette offre ?"
            description="Le lien cessera de fonctionner immédiatement. Cette action est irréversible."
            confirmLabel="Révoquer"
            loading={revoking}
            onConfirm={revoke}
          />
        </>
      )}
    </div>
  )
}
