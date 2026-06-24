"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useState, useEffect } from "react"
import { format, differenceInDays } from "date-fns"
import { fr } from "date-fns/locale"
import { PinIcon, CalendarIcon, MapPinIcon, ArrowRightIcon, ImageIcon, ChevronRightIcon, Loader2Icon } from "lucide-react"
import { RichTextView } from "@/components/ui/rich-text-view"
import { RsvpBadge } from "@/components/portal/rsvp-badge"
import { PriceBadge } from "@/components/ui/price-badge"
import { stripHtml } from "@/lib/utils"
import { cn } from "@/lib/utils"

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

function isNew(publishedAt: string) {
  return differenceInDays(new Date(), new Date(publishedAt)) <= 7
}

function FeedCard({ post, slug, index }: { post: Actualite; slug: string; index: number }) {
  const nouveau = isNew(post.publishedAt)
  const excerpt = stripHtml(post.content)

  return (
    <article
      className="group rounded-xl border bg-card overflow-hidden flex flex-col transition-all hover:-translate-y-0.5 hover:shadow-md animate-in fade-in-0 slide-in-from-bottom-3 duration-300"
      style={{ animationDelay: `${index * 60}ms`, animationFillMode: "both" }}
    >
      <Link href={`/portal/${slug}/actualites/${post.id}`} className="block relative aspect-video w-full overflow-hidden">
        {post.imageUrl ? (
          <>
            <img src={post.imageUrl} aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60" />
            <img src={post.imageUrl} alt={post.title} className="relative z-10 w-full h-full object-contain transition-transform duration-500 group-hover:scale-[1.03]" />
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/40">
            <ImageIcon className="size-10 text-muted-foreground/20" />
          </div>
        )}

        <div className="absolute top-2.5 left-2.5 z-20 flex gap-1.5">
          {post.pinned && (
            <span className="inline-flex items-center gap-1.5 bg-orange-500/80 backdrop-blur-md border border-orange-300/30 text-white text-[11px] font-semibold px-2.5 py-0.5 rounded-full shadow-lg">
              <PinIcon className="size-2.5" /> Épinglé
            </span>
          )}
          {nouveau && (
            <span className="inline-flex items-center gap-1.5 bg-black/50 backdrop-blur-md border border-white/20 text-white text-[11px] font-semibold px-2.5 py-0.5 rounded-full shadow-lg">
              <span className="size-1.5 bg-emerald-300 rounded-full animate-pulse" />
              Nouveau
            </span>
          )}
        </div>
      </Link>

      <div className="flex flex-col flex-1 p-3.5 gap-2">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/portal/${slug}/actualites/${post.id}`} className="hover:underline underline-offset-2">
            <h2 className="font-semibold text-sm leading-snug line-clamp-2">{post.title}</h2>
          </Link>
          <time className="text-[11px] text-muted-foreground/60 shrink-0 mt-0.5">
            {format(new Date(post.publishedAt), "d MMM yyyy", { locale: fr })}
          </time>
        </div>

        {excerpt && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{excerpt}</p>
        )}

        <Link
          href={`/portal/${slug}/actualites/${post.id}`}
          className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline self-start"
        >
          Lire la suite <ChevronRightIcon className="size-3.5" />
        </Link>

        {post.evenement && (
          <div className="rounded-xl border bg-muted/30 p-3 space-y-2 mt-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-primary uppercase tracking-wider flex items-center gap-1">
                <CalendarIcon className="size-3.5" /> Événement associé
              </p>
              {post.evenementRsvp && <RsvpBadge rsvp={post.evenementRsvp} />}
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-sm">{post.evenement.title}</p>
                <PriceBadge price={post.evenement.price} />
              </div>
              <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CalendarIcon className="size-3" />
                  {format(new Date(post.evenement.date), "d MMM yyyy 'à' HH'h'mm", { locale: fr })}
                </span>
                {post.evenement.location && (
                  <span className="flex items-center gap-1">
                    <MapPinIcon className="size-3" />
                    {post.evenement.lat != null && post.evenement.lng != null ? (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${post.evenement.lat},${post.evenement.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline inline-flex items-center gap-0.5"
                      >
                        {post.evenement.location}
                      </a>
                    ) : post.evenement.location}
                  </span>
                )}
              </div>
              {post.evenement.description && (
                <RichTextView content={post.evenement.description} className="text-xs text-muted-foreground line-clamp-2 pt-0.5" />
              )}
            </div>
            <Link
              href={`/portal/${slug}/evenements`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              Voir les événements <ArrowRightIcon className="size-3" />
            </Link>
          </div>
        )}
      </div>
    </article>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border bg-card overflow-hidden animate-pulse">
      <div className="aspect-video bg-muted w-full" />
      <div className="p-3.5 space-y-2.5">
        <div className="flex justify-between gap-4">
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="h-3 w-12 rounded bg-muted" />
        </div>
        <div className="space-y-1.5">
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-3 w-4/5 rounded bg-muted" />
        </div>
      </div>
    </div>
  )
}

type ActualitesResponse = { data: Actualite[]; total: number; page: number; limit: number; hasMore: boolean }

export default function ActualitesPortalPage() {
  const { slug }       = useParams<{ slug: string }>()
  const [page, setPage] = useState(1)
  const [allPosts, setAllPosts] = useState<Actualite[]>([])

  const { data, isLoading, isFetching } = useQuery<ActualitesResponse>({
    queryKey: ["portal-actualites", page],
    queryFn:  () => fetch(`/api/portal/actualites?page=${page}&limit=20`).then(r => r.json()),
    placeholderData: (prev) => prev,
  })

  const hasMore = data?.hasMore ?? false

  useEffect(() => {
    if (!data?.data) return
    setAllPosts(prev => {
      if (page === 1) return data.data
      const seen = new Set(prev.map(p => p.id))
      const newOnes = data.data.filter(p => !seen.has(p.id))
      return newOnes.length > 0 ? [...prev, ...newOnes] : prev
    })
  }, [data, page])

  const displayed = allPosts

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Actualités</h1>
        <p className="text-muted-foreground text-sm mt-1">Les dernières nouvelles de votre association.</p>
      </div>

      {isLoading && page === 1 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : displayed.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/10 py-20 flex flex-col items-center gap-3 text-center">
          <ImageIcon className="size-8 text-muted-foreground/40" />
          <p className="text-muted-foreground text-sm">Aucune actualité pour le moment.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {displayed.map((post, i) => (
              <FeedCard key={post.id} post={post} slug={slug} index={i} />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => setPage(p => p + 1)}
                disabled={isFetching}
                className="flex items-center gap-2 rounded-lg border bg-card px-5 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
              >
                {isFetching ? <Loader2Icon className="size-4 animate-spin" /> : null}
                Charger plus
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
