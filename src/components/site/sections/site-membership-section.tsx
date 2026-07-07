"use client"

import { useState } from "react"
import type { MembershipSection } from "@/types/site-config"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";
type MembreType = { id: string; name: string; color: string }

type Props = {
  section:     MembershipSection
  slug:        string
  membreTypes: MembreType[]
  color:       string
}

type FormState = {
  firstName: string
  lastName:  string
  email:     string
  phone:     string
  typeId:    string
}

export function SiteMembershipSection({ section, slug, membreTypes, color }: Props) {
  const [form, setForm]       = useState<FormState>({ firstName: "", lastName: "", email: "", phone: "", typeId: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [done, setDone]       = useState(false)

  function set(field: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
    setError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError("Le prénom et le nom sont obligatoires.")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/${slug}/inscription`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          firstName: form.firstName.trim(),
          lastName:  form.lastName.trim(),
          email:     form.email.trim() || undefined,
          phone:     form.phone.trim() || undefined,
          typeId:    form.typeId || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        const msg = typeof json.error === "string" ? json.error : "Une erreur est survenue."
        setError(msg)
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
      <section className="py-16 px-4">
        <div className="max-w-md mx-auto text-center space-y-4">
          <CheckCircleIcon className="size-12 mx-auto" style={{ color }} />
          <h2 className="text-xl font-bold text-gray-900">Demande envoyée !</h2>
          <p className="text-gray-500 text-sm">
            Votre demande d&apos;adhésion a bien été reçue. L&apos;association vous contactera dans les meilleurs délais.
          </p>
          <button
            type="button"
            onClick={() => { setDone(false); setForm({ firstName: "", lastName: "", email: "", phone: "", typeId: "" }) }}
            className="text-sm underline underline-offset-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            Envoyer une autre demande
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="py-16 px-4">
      <div className="max-w-md mx-auto">
        <h2 className="text-2xl font-bold mb-2 text-gray-900">{section.title || "Rejoindre l'association"}</h2>
        {section.body && <p className="text-gray-500 text-sm mb-8">{section.body}</p>}

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
            <label className="text-xs font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => set("email", e.target.value)}
              placeholder="marie.dupont@email.com"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-1"
            />
          </div>

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

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ background: color }}
          >
            {loading ? "Envoi en cours…" : "Envoyer ma demande d'adhésion"}
          </button>
        </form>
      </div>
    </section>
  )
}
