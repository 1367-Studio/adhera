"use client"

import { useState, useEffect } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { ChatCircleTextIcon } from "@phosphor-icons/react/dist/ssr";
import { CHURN_REASON_LABEL_BY_CODE } from "@/lib/churn-feedback-reasons"

type FeedbackInfo = {
  reason:      string | null
  detail:      string | null
  respondedAt: string | null
}

// French-only, like every other public token page (/billet, /annulation) — reached only
// from the churn-feedback email, which is French-only too.
//
// The reason is only ever written by an explicit "Confirmer" click on this page (see the
// API route's own comment) — never by the page simply loading, even though the page itself
// loads via a client-side fetch on mount (same shape as /billet/[token]). A corporate email
// gateway's link-scanner that renders this page in a real headless browser to check for
// phishing/malware still only ever *loads* it — it doesn't synthesize a button click — so
// it never gets to record an answer nobody chose. Confirming again later (a different link,
// or the same one) always overwrites, on purpose: if a scanner (or a wrong click) ever did
// leave a stale answer, the real one just replaces it.
export default function ChurnFeedbackPage() {
  const { token } = useParams<{ token: string }>()
  const searchParams = useSearchParams()
  const reasonParam = searchParams.get("reason")
  const reasonLabel = reasonParam ? CHURN_REASON_LABEL_BY_CODE[reasonParam] : undefined

  const [info, setInfo]         = useState<FeedbackInfo | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading]   = useState(true)

  // Whether the "Did you mean X?" step still needs an explicit click — starts true
  // whenever the link carried a reason, regardless of what's already saved server-side
  // (reconfirming is always allowed, see the module comment above).
  const [confirming, setConfirming] = useState(false)
  const [confirmSaving, setConfirmSaving] = useState(false)

  const [detail, setDetail] = useState("")
  const [saved, setSaved]   = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/public/churn-feedback/${token}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: FeedbackInfo) => {
        setInfo(d)
        // Pre-fill with whatever was already saved — otherwise revisiting this link later
        // (e.g. from the inbox again) shows an empty box, and submitting it as-is would
        // silently wipe out the detail they already wrote the first time.
        if (d.detail) setDetail(d.detail)
        if (reasonParam && reasonLabel) setConfirming(true)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function confirmReason() {
    if (!reasonParam) return
    setConfirmSaving(true)
    try {
      const res = await fetch(`/api/public/churn-feedback/${token}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ reason: reasonParam }),
      })
      if (res.ok) {
        setInfo(prev => prev ? { ...prev, reason: reasonParam, respondedAt: new Date().toISOString() } : prev)
        setConfirming(false)
      }
    } finally {
      setConfirmSaving(false)
    }
  }

  async function submitDetail() {
    setSaving(true)
    try {
      const res = await fetch(`/api/public/churn-feedback/${token}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ detail }),
      })
      if (res.ok) setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="size-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (notFound || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-4">
        <p className="text-muted-foreground">Ce lien est invalide.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center size-12 rounded-full bg-primary/10 dark:bg-primary/20 mb-2">
            <ChatCircleTextIcon className="size-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {confirming ? "Vous confirmez ?" : info.reason ? "Merci pour votre retour" : "Dites-nous en quelques mots"}
          </h1>
          {!confirming && info.reason && (
            <p className="text-muted-foreground text-sm">Votre réponse a bien été enregistrée.</p>
          )}
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-4">
          {confirming ? (
            <>
              <p className="text-sm text-muted-foreground">
                Vous avez cliqué sur : <span className="font-medium text-foreground">{reasonLabel}</span>
              </p>
              <button
                type="button"
                onClick={confirmReason}
                disabled={confirmSaving}
                className="w-full rounded-md bg-primary text-primary-foreground text-sm font-medium py-2 disabled:opacity-50"
              >
                Confirmer
              </button>
            </>
          ) : saved ? (
            <p className="text-sm text-center text-muted-foreground">Merci, c&apos;est noté.</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {info.reason
                  ? "Vous pouvez ajouter quelques précisions si vous le souhaitez :"
                  : "Pourquoi n'avez-vous pas continué avec Formwise ?"}
              </p>
              <textarea
                className="w-full min-h-28 rounded-md border bg-background p-3 text-sm resize-y"
                value={detail}
                onChange={e => setDetail(e.target.value)}
                maxLength={2000}
                placeholder="Votre message..."
              />
              <button
                type="button"
                onClick={submitDetail}
                // Empty text is never a valid submission here — without this, resubmitting
                // an untouched (pre-filled) box, or clearing it by mistake, would silently
                // overwrite a previously-saved message with blank.
                disabled={saving || !detail.trim()}
                className="w-full rounded-md bg-primary text-primary-foreground text-sm font-medium py-2 disabled:opacity-50"
              >
                Envoyer
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
