"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
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
  // Only meaningful when alreadySubmitted.
  publicationAgreed: boolean
  anonymous:         boolean
}

type ConsentFieldsProps = {
  t:                  ReturnType<typeof useTranslations>
  publicationAgreed:  boolean | null
  anonymous:          boolean | null
  onPublicationAgreedChange: (value: boolean) => void
  onAnonymousChange:         (value: boolean) => void
}

// Shared by the first submission and the later "change my mind" flow below, so the two can
// never drift apart.
function ConsentFields({ t, publicationAgreed, anonymous, onPublicationAgreedChange, onAnonymousChange }: ConsentFieldsProps) {
  return (
    <div className="space-y-4 text-left">
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("publicationQuestion")}</p>
        <div className="space-y-1.5">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="publicationAgreed"
              className="mt-1"
              checked={publicationAgreed === true}
              onChange={() => onPublicationAgreedChange(true)}
            />
            {t("publicationYes")}
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="publicationAgreed"
              className="mt-1"
              checked={publicationAgreed === false}
              onChange={() => onPublicationAgreedChange(false)}
            />
            {t("publicationNo")}
          </label>
        </div>
      </div>

      {publicationAgreed && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("identificationQuestion")}</p>
          <div className="space-y-1.5">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="anonymous"
                className="mt-1"
                checked={anonymous === false}
                onChange={() => onAnonymousChange(false)}
              />
              {t("identificationNamed")}
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="anonymous"
                className="mt-1"
                checked={anonymous === true}
                onChange={() => onAnonymousChange(true)}
              />
              {t("identificationAnonymous")}
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ReviewPage() {
  const { token } = useParams<{ token: string }>()
  const t   = useTranslations("avis")
  const loc = useLocale()

  const [info, setInfo]         = useState<ReviewInfo | null>(null)
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [done, setDone]         = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [savingConsent, setSavingConsent] = useState(false)
  const [rating, setRating]     = useState(0)
  const [comment, setComment]   = useState("")
  // null = not yet answered — never pre-selected on first submission. Pre-filled from the
  // participant's own current choice when they're revisiting the link later (see the effect
  // below), since re-showing a blank form for an already-answered question would be confusing.
  const [publicationAgreed, setPublicationAgreed] = useState<boolean | null>(null)
  const [anonymous, setAnonymous]                 = useState<boolean | null>(null)

  useEffect(() => {
    fetch(`/api/public/review/${token}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: ReviewInfo) => setInfo(d))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    if (info?.alreadySubmitted) {
      setPublicationAgreed(info.publicationAgreed)
      setAnonymous(info.publicationAgreed ? info.anonymous : null)
    }
  }, [info])

  async function handleSubmit() {
    if (rating < 1) { toast.error(t("ratingRequired")); return }
    if (publicationAgreed === null) { toast.error(t("publicationRequired")); return }
    if (publicationAgreed && anonymous === null) { toast.error(t("identificationRequired")); return }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/public/review/${token}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          rating,
          comment:           comment.trim() || undefined,
          publicationAgreed,
          anonymous:         publicationAgreed ? !!anonymous : false,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? t("genericError")); return }
      setDone(true)
    } catch {
      toast.error(t("networkError"))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUpdateConsent() {
    if (publicationAgreed === null) { toast.error(t("publicationRequired")); return }
    if (publicationAgreed && anonymous === null) { toast.error(t("identificationRequired")); return }

    setSavingConsent(true)
    try {
      const res = await fetch(`/api/public/review/${token}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ publicationAgreed, anonymous: publicationAgreed ? !!anonymous : false }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? t("genericError")); return }
      toast.success(t("consentUpdated"))
    } catch {
      toast.error(t("networkError"))
    } finally {
      setSavingConsent(false)
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
        <p className="text-muted-foreground">{t("invalidLink")}</p>
      </div>
    )
  }

  const dateStr = new Date(info.eventDate).toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric" })
  const hasSubmitted = done || info.alreadySubmitted

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
          {hasSubmitted ? (
            <div className="space-y-5">
              <p className="font-medium">{t("thanks")}</p>
              <div className="space-y-3 border-t pt-4">
                <p className="text-sm font-medium">{t("manageConsentTitle")}</p>
                <ConsentFields
                  t={t}
                  publicationAgreed={publicationAgreed}
                  anonymous={anonymous}
                  onPublicationAgreedChange={value => { setPublicationAgreed(value); if (!value) setAnonymous(null) }}
                  onAnonymousChange={setAnonymous}
                />
                <Button
                  variant="outline"
                  loading={savingConsent}
                  onClick={handleUpdateConsent}
                  className="w-full"
                >
                  {t("updateConsent")}
                </Button>
              </div>
            </div>
          ) : !info.eligible ? (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <WarningCircleIcon className="size-5" />
              <p>{t("notEligible")}</p>
            </div>
          ) : (
            <>
              <p className="text-sm">{t("greeting", { firstName: info.firstName })}</p>
              <div className="flex justify-center">
                <StarRating value={rating} onChange={setRating} />
              </div>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder={t("commentPlaceholder")}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />

              {rating > 0 && (
                <ConsentFields
                  t={t}
                  publicationAgreed={publicationAgreed}
                  anonymous={anonymous}
                  onPublicationAgreedChange={value => { setPublicationAgreed(value); if (!value) setAnonymous(null) }}
                  onAnonymousChange={setAnonymous}
                />
              )}

              <Button
                loading={submitting}
                onClick={handleSubmit}
                className="w-full"
              >
                {t("submit")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
