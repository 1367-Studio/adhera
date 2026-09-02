"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { StarIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { StarRating } from "@/components/ui/star-rating"

type ReviewInfo = {
  eventTitle:       string
  eventDate:        string
  firstName:        string
  eligible:         boolean
  alreadySubmitted: boolean
}

export default function ReviewPage() {
  const { token } = useParams<{ token: string }>()

  const [info, setInfo]         = useState<ReviewInfo | null>(null)
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [done, setDone]         = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [rating, setRating]     = useState(0)
  const [comment, setComment]   = useState("")

  useEffect(() => {
    fetch(`/api/public/review/${token}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: ReviewInfo) => setInfo(d))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [token])

  async function handleSubmit() {
    if (rating < 1) { toast.error("Choisissez une note"); return }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/public/review/${token}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ rating, comment: comment.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Erreur"); return }
      setDone(true)
    } catch {
      toast.error("Erreur réseau")
    } finally {
      setSubmitting(false)
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
        <p className="text-muted-foreground">Ce lien d&apos;avis est invalide.</p>
      </div>
    )
  }

  const dateStr = new Date(info.eventDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center size-12 rounded-full bg-primary/10 dark:bg-primary/20 mb-2">
            <StarIcon className="size-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{info.eventTitle}</h1>
          <p className="text-muted-foreground text-sm">{dateStr}</p>
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-4 text-center">
          {done || info.alreadySubmitted ? (
            <p className="font-medium">Merci pour votre avis !</p>
          ) : !info.eligible ? (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <WarningCircleIcon className="size-5" />
              <p>Seuls les participants présents à l&apos;événement peuvent laisser un avis.</p>
            </div>
          ) : (
            <>
              <p className="text-sm">
                Bonjour {info.firstName}, comment avez-vous trouvé cet événement ?
              </p>
              <div className="flex justify-center">
                <StarRating value={rating} onChange={setRating} />
              </div>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Un commentaire ? (facultatif)"
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                loading={submitting}
                onClick={handleSubmit}
                className="w-full"
              >
                Envoyer mon avis
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
