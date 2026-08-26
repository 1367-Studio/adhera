"use client"

import { useEffect, useRef, useState, Suspense } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { toast } from "sonner"
import type { MembershipSection } from "@/types/site-config"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { PRIVACY_URL } from "@/lib/consent"
type MembreType = { id: string; name: string; color: string }

type Props = {
  section:     MembershipSection
  slug:        string
  membreTypes: MembreType[]
  color:       string
  // When true, the association has turned on immediate payment for this form (see
  // publicMembershipPaymentEnabled in parametres) — submitting redirects to a Stripe
  // Checkout subscription instead of just filing a PENDING request. `amount` is the
  // yearly cotisation, already resolved server-side (getSiteData in [slug]/page.tsx).
  paymentAvailable: boolean
  amount:           string | null
}

type FormState = {
  firstName:     string
  lastName:      string
  email:         string
  phone:         string
  typeId:        string
  password:      string
  acceptedTerms: boolean
}

const EMPTY_FORM: FormState = { firstName: "", lastName: "", email: "", phone: "", typeId: "", password: "", acceptedTerms: false }

export function SiteMembershipSection(props: Props) {
  return (
    <Suspense fallback={null}>
      <SiteMembershipSectionInner {...props} />
    </Suspense>
  )
}

// useSearchParams() (for the Stripe Checkout return) requires a Suspense boundary above
// it — the wrapper above provides that, same pattern as donation-form-public-form.tsx.
function SiteMembershipSectionInner({ section, slug, membreTypes, color, paymentAvailable, amount }: Props) {
  const searchParams = useSearchParams()
  const router        = useRouter()
  const pathname       = usePathname()

  const [form, setForm]       = useState<FormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [done, setDone]       = useState(false)

  function set(field: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
    setError(null)
  }

  // Stripe redirects back here (?payment=success/cancelled) after the hosted Checkout
  // page — same shape as donation-form-public-form.tsx's own handling of that redirect.
  const shownPaymentToast = useRef<string | null>(null)
  useEffect(() => {
    const p = searchParams.get("payment")
    if (!p || shownPaymentToast.current === p) return
    shownPaymentToast.current = p
    if (p === "success") setDone(true)
    if (p === "cancelled") toast.info("Paiement annulé — vous pouvez réessayer quand vous voulez.")
    router.replace(pathname, { scroll: false })
  }, [searchParams, router, pathname])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError("Le prénom et le nom sont obligatoires.")
      return
    }
    if (paymentAvailable && !form.email.trim()) {
      setError("L'email est obligatoire pour finaliser le paiement.")
      return
    }
    if (paymentAvailable && form.password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.")
      return
    }
    if (!form.acceptedTerms) {
      setError("Merci d'accepter la politique de confidentialité pour envoyer votre demande.")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const path = paymentAvailable ? `/api/public/${slug}/inscription/checkout` : `/api/public/${slug}/inscription`
      const res = await fetch(path, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          firstName:     form.firstName.trim(),
          lastName:      form.lastName.trim(),
          email:         paymentAvailable ? form.email.trim() : (form.email.trim() || undefined),
          phone:         form.phone.trim() || undefined,
          typeId:        form.typeId || undefined,
          ...(paymentAvailable ? { password: form.password } : {}),
          acceptedTerms: form.acceptedTerms,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        const msg = typeof json.error === "string" ? json.error : "Une erreur est survenue."
        setError(msg)
      } else if (paymentAvailable && json.url) {
        window.location.href = json.url
        return
      } else {
        setDone(true)
      }
    } catch {
      setError("Impossible de contacter le serveur. Réessayez.")
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <section id="adhesion" className="py-16 px-4">
        <div className="max-w-md mx-auto text-center space-y-4">
          <CheckCircleIcon className="size-12 mx-auto" style={{ color }} />
          <h2 className="text-xl font-bold text-gray-900">
            {paymentAvailable ? "Bienvenue !" : "Demande envoyée !"}
          </h2>
          <p className="text-gray-500 text-sm">
            {paymentAvailable
              ? "Votre adhésion est active et votre paiement a bien été reçu. Connectez-vous à votre espace membre avec l'email et le mot de passe que vous venez de choisir."
              : "Votre demande d'adhésion a bien été reçue. L'association vous contactera dans les meilleurs délais."}
          </p>
          {paymentAvailable && (
            <a
              href={`/portal/${slug}/login`}
              className="inline-block text-sm font-medium text-white rounded-lg px-4 py-2 transition-opacity hover:opacity-90"
              style={{ background: color }}
            >
              Accéder à mon espace membre
            </a>
          )}
          <button
            type="button"
            onClick={() => { setDone(false); setForm(EMPTY_FORM) }}
            className="block mx-auto text-sm underline underline-offset-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            {paymentAvailable ? "Faire une nouvelle demande" : "Envoyer une autre demande"}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section id="adhesion" className="py-16 px-4">
      <div className="max-w-md mx-auto">
        <h2 className="text-2xl font-bold mb-2 text-gray-900">{section.title || "Rejoindre l'association"}</h2>
        {section.body && <p className="text-gray-500 text-sm mb-8">{section.body}</p>}

        {paymentAvailable && amount && (
          <div className="mb-6 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-700">
            Cotisation : <strong>{Number(amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</strong> par an, prélevée automatiquement.
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Prénom <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.firstName}
                onChange={e => set("firstName", e.target.value)}
                placeholder="Marie"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-1"
                style={{ "--tw-ring-color": color } as React.CSSProperties}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Nom <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.lastName}
                onChange={e => set("lastName", e.target.value)}
                placeholder="Dupont"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-1"
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">
              Email {paymentAvailable && <span className="text-red-500">*</span>}
            </label>
            <input
              type="email"
              value={form.email}
              onChange={e => set("email", e.target.value)}
              placeholder="marie.dupont@email.com"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-1"
              required={paymentAvailable}
            />
          </div>

          {paymentAvailable && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Mot de passe <span className="text-red-500">*</span></label>
              <input
                type="password"
                value={form.password}
                onChange={e => set("password", e.target.value)}
                placeholder="Min. 8 caractères"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-1"
                required
                minLength={8}
              />
              <p className="text-xs text-gray-400">Pour accéder à votre espace membre après le paiement.</p>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">Téléphone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={e => set("phone", e.target.value)}
              placeholder="+33 6 00 00 00 00"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-1"
            />
          </div>

          {membreTypes.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Type d&apos;adhésion</label>
              <select
                value={form.typeId}
                onChange={e => set("typeId", e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-1 bg-white"
              >
                <option value="">Sélectionner…</option>
                {membreTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-start gap-2.5">
            <input
              type="checkbox"
              id="membership-accepted-terms"
              checked={form.acceptedTerms}
              onChange={e => setForm(prev => ({ ...prev, acceptedTerms: e.target.checked }))}
              required
              className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-gray-300"
              style={{ accentColor: color } as React.CSSProperties}
            />
            <label htmlFor="membership-accepted-terms" className="text-xs text-gray-600 cursor-pointer">
              J&apos;accepte que mes données soient traitées conformément à la{" "}
              <a
                href={PRIVACY_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="underline underline-offset-2 hover:text-gray-900"
              >
                politique de confidentialité
              </a>
            </label>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ background: color }}
          >
            {loading
              ? "Envoi en cours…"
              : paymentAvailable ? "Adhérer et payer" : "Envoyer ma demande d'adhésion"}
          </button>
        </form>
      </div>
    </section>
  )
}
