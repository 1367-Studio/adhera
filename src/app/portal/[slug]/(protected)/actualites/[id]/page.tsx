"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { useParams } from "next/navigation"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { ArrowLeftIcon, CalendarIcon, MapPinIcon, PinIcon, ExternalLinkIcon } from "lucide-react"
import { RichTextView } from "@/components/ui/rich-text-view"
import { RsvpBadge } from "@/components/portal/rsvp-badge"
import { PriceBadge } from "@/components/ui/price-badge"

type EvenementRef = {
  id:          string
  title:       string
  date:        string
  endDate:     string | null
  location:    string | null
  lat:         number | null
  lng:         number | null
  price:       string | null
  description: string | null
}

type Actualite = {
  id:            string
  title:         string
  content:       string
  imageUrl:      string | null
  pinned:        boolean
  publishedAt:   string
  evenement:     EvenementRef | null
  evenementRsvp: string | null
}

function SkeletonDetail() {
  return (
    <div className="w-full space-y-6 animate-pulse">
      <div className="h-4 w-24 rounded bg-muted" />
      <div className="aspect-video w-full rounded-xl bg-muted" />
      <div className="space-y-3">
        <div className="h-7 w-3/4 rounded bg-muted" />
        <div className="h-3 w-32 rounded bg-muted" />
      </div>
      <div className="space-y-2">
        {[1,2,3,4,5].map(i => <div key={i} className="h-3 w-full rounded bg-muted" />)}
        <div className="h-3 w-2/3 rounded bg-muted" />
      </div>
    </div>
  )
}

export default function ActualiteDetailPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>()

  const { data: post, isLoading, isError } = useQuery<Actualite>({
    queryKey: ["portal-actualite", id],
    queryFn:  () => fetch(`/api/portal/actualites/${id}`).then(r => {
      if (!r.ok) throw new Error("Introuvable")
      return r.json()
    }),
  })

  if (isLoading) return <div className="space-y-6"><SkeletonDetail /></div>

  if (isError || !post) return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <p className="text-muted-foreground">Cette actualité est introuvable.</p>
      <Link href={`/portal/${slug}/actualites`} className="text-sm text-primary hover:underline flex items-center gap-1">
        <ArrowLeftIcon className="size-3.5" /> Retour aux actualités
      </Link>
    </div>
  )

  const ev = post.evenement
  const isUpcoming = ev ? new Date(ev.date) >= new Date() : false

  return (
    <div className="w-full space-y-6">
      <Link
        href={`/portal/${slug}/actualites`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeftIcon className="size-3.5" />
        Retour aux actualités
      </Link>

      {post.imageUrl && (
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border">
          <img src={post.imageUrl} aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60" />
          <img src={post.imageUrl} alt={post.title} className="relative z-10 w-full h-full object-contain" />
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {post.pinned && (
            <span className="inline-flex items-center gap-1.5 bg-orange-500/80 border border-orange-300/30 text-white text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
              <PinIcon className="size-2.5" /> Épinglé
            </span>
          )}
          <time className="text-xs text-muted-foreground">
            {format(new Date(post.publishedAt), "d MMMM yyyy", { locale: fr })}
          </time>
        </div>
        <h1 className="text-2xl font-bold leading-snug">{post.title}</h1>
      </div>

      <RichTextView content={post.content} className="prose prose-sm max-w-none" />

      {ev && (
        <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
              <CalendarIcon className="size-3.5" />
              Événement associé
            </p>
            {post.evenementRsvp && <RsvpBadge rsvp={post.evenementRsvp} />}
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold">{ev.title}</p>
              <PriceBadge price={ev.price} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CalendarIcon className="size-3" />
                {format(new Date(ev.date), "d MMM yyyy 'à' HH'h'mm", { locale: fr })}
                {ev.endDate && <> — {format(new Date(ev.endDate), "HH'h'mm", { locale: fr })}</>}
              </span>
              {ev.location && (
                <span className="flex items-center gap-1">
                  <MapPinIcon className="size-3" />
                  {ev.lat != null && ev.lng != null ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${ev.lat},${ev.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline inline-flex items-center gap-0.5"
                    >
                      {ev.location} <ExternalLinkIcon className="size-2.5" />
                    </a>
                  ) : ev.location}
                </span>
              )}
            </div>
            {ev.description && (
              <RichTextView content={ev.description} className="text-xs text-muted-foreground pt-1" />
            )}
          </div>

          {isUpcoming && (
            <Link
              href={`/portal/${slug}/evenements`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              Gérer ma participation <ExternalLinkIcon className="size-3" />
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
