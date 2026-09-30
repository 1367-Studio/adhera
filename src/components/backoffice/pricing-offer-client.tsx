"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PlusIcon, CopyIcon, CheckIcon, TrashIcon, XIcon, BellIcon, ArrowsClockwiseIcon, LockOpenIcon } from "@phosphor-icons/react/dist/ssr";
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { DateField, todayValue } from "@/components/ui/date-field"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { RowActions, type RowAction } from "@/components/ui/row-actions"
import { BASE_PATH } from "@/lib/env"
import { APP_NAME } from "@/config/brand"

// amount in euros, same convention as every other CurrencyField in the app (e.g.
// cotisation-form.tsx) — converted to cents only right before hitting the API.
type PhaseInput = { amount: number; months: string }

const PLAN_OPTIONS = [
  { value: "STARTER",   label: "Starter" },
  { value: "ESSENTIAL", label: "Essentiel" },
  { value: "PRO",       label: "Pro" },
]

function toCents(amountEuros: number): number | null {
  const n = Math.round(amountEuros * 100)
  return Number.isFinite(n) && n >= 0 ? n : null
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

              {phases.some(p => Math.round(p.amount * 100) === 0) && (
                <p className="text-xs text-muted-foreground">
                  Une phase à 0 € ne demandera aucune carte bancaire à l&apos;inscription.
                </p>
              )}

              <CheckboxField
                id="last-open-ended"
                label="La dernière phase est récurrente sans fin (facturée jusqu'à annulation)"
                checked={lastOpenEnded}
                onChange={e => setLastOpenEnded(e.target.checked)}
              />
              {!lastOpenEnded && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Attention : sans phase finale « récurrente », l&apos;abonnement se termine et l&apos;accès à {APP_NAME} est automatiquement coupé dès la fin de la dernière phase{Math.round(phases[phases.length - 1].amount * 100) === 0 ? ", même si cette dernière phase est à 0 €" : ""}. Si le prix doit repasser au tarif standard Essentiel/Pro ensuite, il faudra le refaire manuellement avant cette date.
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

type OfferAssociation = {
  hasStripeCustomer:      boolean
  hasStripeSchedule:      boolean
  pendingScheduleRelease: boolean
  alreadyConverted:       boolean
}

const NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000

export function PricingOfferRowActions({
  id, token, status, association, hasPaymentMethod, lastNotifiedAt,
}: {
  id:                string
  token:              string
  status:             string
  association?:       OfferAssociation | null
  hasPaymentMethod?:  boolean | null
  lastNotifiedAt?:    string | null
}) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [notifying, setNotifying] = useState(false)
  const [convertOpen, setConvertOpen] = useState(false)
  const [releaseConfirmOpen, setReleaseConfirmOpen] = useState(false)
  const [releasing, setReleasing] = useState(false)

  const link = `${typeof window !== "undefined" ? window.location.origin : ""}${BASE_PATH}/register?offer=${token}`

  // Date.now() can't be called directly during render (breaks purity) — a lazy useState
  // initializer runs exactly once, which React treats as the sanctioned escape hatch for
  // reading a non-deterministic value like the current time. Just a proactive UI hint, not
  // the real cooldown boundary (that's enforced server-side, see notify-payment-method/route.ts).
  const [mountedAt] = useState(() => Date.now())
  const notifiedRecently = !!lastNotifiedAt && mountedAt - new Date(lastNotifiedAt).getTime() < NOTIFY_COOLDOWN_MS

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      toast.success("Lien copié")
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

  async function notify() {
    setNotifying(true)
    try {
      const res = await fetch(`/api/backoffice/pricing-offers/${id}/notify-payment-method`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erreur")
      toast.success("Client notifié")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    } finally {
      setNotifying(false)
    }
  }

  async function releaseNow() {
    setReleasing(true)
    try {
      const res = await fetch(`/api/backoffice/pricing-offers/${id}/release-schedule`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erreur")
      toast.success("Planning libéré")
      setReleaseConfirmOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    } finally {
      setReleasing(false)
    }
  }

  const usedActions: RowAction[] = []
  if (association?.hasStripeCustomer && hasPaymentMethod !== true) {
    usedActions.push({
      label:    notifiedRecently ? "Notifier le client (relance dans 24h)" : "Notifier le client",
      icon:     <BellIcon className="size-3.5" />,
      onClick:  notify,
      disabled: notifying || notifiedRecently,
    })
  }
  if (association?.pendingScheduleRelease) {
    usedActions.push({
      label:   "Libérer maintenant",
      icon:    <LockOpenIcon className="size-3.5" />,
      onClick: () => setReleaseConfirmOpen(true),
    })
  } else if (association?.hasStripeSchedule && !association.alreadyConverted) {
    usedActions.push({
      label:   "Convertir en tarif standard",
      icon:    <ArrowsClockwiseIcon className="size-3.5" />,
      onClick: () => setConvertOpen(true),
    })
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {status === "USED" && association && (
        <>
          {association.hasStripeCustomer && (
            <Badge variant={hasPaymentMethod ? "success" : "outline"}>
              Carte : {hasPaymentMethod ? "oui" : "non"}
            </Badge>
          )}

          {association.pendingScheduleRelease && (
            <Tooltip>
              <TooltipTrigger render={<Badge variant="warning" />}>En attente de paiement</TooltipTrigger>
              <TooltipContent side="top" className="max-w-64 whitespace-normal text-left">
                La conversion a été programmée mais le planning Stripe ne sera libéré qu&apos;au premier paiement confirmé sur le nouveau tarif.
              </TooltipContent>
            </Tooltip>
          )}

          {!association.pendingScheduleRelease && association.hasStripeSchedule && association.alreadyConverted && (
            <Tooltip>
              <TooltipTrigger render={<Badge variant="outline" />}>Convertie</TooltipTrigger>
              <TooltipContent side="top" className="max-w-64 whitespace-normal text-left">
                Déjà convertie, planning conservé pour d&apos;autres phases négociées — gérer manuellement dans Stripe si besoin.
              </TooltipContent>
            </Tooltip>
          )}

          {usedActions.length > 0 && <RowActions actions={usedActions} />}

          <ConfirmDialog
            open={releaseConfirmOpen}
            onOpenChange={setReleaseConfirmOpen}
            title="Libérer le planning maintenant ?"
            description="À utiliser si le client n'ajoutera pas de carte bancaire — le planning Stripe sera détaché immédiatement, sans attendre de paiement confirmé."
            confirmLabel="Libérer"
            loading={releasing}
            onConfirm={releaseNow}
          />
          <ConvertOfferDialog id={id} open={convertOpen} onOpenChange={setConvertOpen} />
        </>
      )}

      {status === "PENDING" && (
        <>
          <RowActions actions={[
            { label: "Copier le lien",     icon: <CopyIcon className="size-3.5" />,  onClick: copyLink },
            { label: "Révoquer l'offre",   icon: <TrashIcon className="size-3.5" />, onClick: () => setConfirmOpen(true), destructive: true, separator: true },
          ]} />
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

const BILLING_CYCLE_OPTIONS = [
  { value: "monthly", label: "Mensuel" },
  { value: "yearly",  label: "Annuel" },
]

function ConvertOfferDialog({ id, open, onOpenChange }: { id: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState("")

  const [effectiveDate, setEffectiveDate]     = useState(todayValue())
  const [planTier, setPlanTier]               = useState("ESSENTIAL")
  const [billingCycle, setBillingCycle]       = useState("monthly")
  const [releaseOnPayment, setReleaseOnPayment] = useState(false)

  function reset() {
    setEffectiveDate(todayValue()); setPlanTier("ESSENTIAL"); setBillingCycle("monthly")
    setReleaseOnPayment(false); setError("")
  }

  async function handleSubmit() {
    setError("")
    setLoading(true)
    try {
      const res = await fetch(`/api/backoffice/pricing-offers/${id}/convert`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ effectiveDate, planTier, billingCycle, releaseOnPayment }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erreur lors de la conversion")
      toast.success("Offre convertie en tarif standard")
      onOpenChange(false)
      reset()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(v) => { onOpenChange(v); if (!v) reset() }}
      title="Convertir en tarif standard"
      description="Ferme la phase négociée en cours à la date choisie et enchaîne sur le tarif du catalogue."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Conversion…" : "Convertir"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 py-1">
        <DateField
          label="Date d'effet"
          value={effectiveDate}
          onChange={setEffectiveDate}
          min={todayValue()}
          allowFuture
          required
        />

        <SelectField
          label="Plan"
          options={PLAN_OPTIONS}
          value={planTier}
          onValueChange={setPlanTier}
          required
        />

        <SelectField
          label="Cycle de facturation"
          options={BILLING_CYCLE_OPTIONS}
          value={billingCycle}
          onValueChange={setBillingCycle}
          required
        />

        <CheckboxField
          id="release-on-payment"
          label="Libérer le planning après confirmation du premier paiement"
          checked={releaseOnPayment}
          onChange={e => setReleaseOnPayment(e.target.checked)}
        />
        <p className="text-xs text-muted-foreground">
          « Libérer » signifie que l&apos;association redevient un abonnement standard comme les
          autres, dès que le premier paiement au nouveau tarif est confirmé — plus aucune gestion
          particulière à faire ensuite. Cochez cette case si cette conversion est la dernière étape
          prévue pour ce client. Ne cochez pas si d&apos;autres phases négociées sont prévues après
          celle-ci : le planning doit alors rester actif pour pouvoir enchaîner la phase suivante
          plus tard.
        </p>

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
        )}
      </div>
    </Modal>
  )
}
