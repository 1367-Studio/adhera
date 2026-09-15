"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useTranslations, useFormatter } from "next-intl"
import { ArrowLeftIcon, CalendarBlankIcon, PushPinIcon } from "@phosphor-icons/react/dist/ssr";
import { RichTextView } from "@/components/ui/rich-text-view"
import { SiteNavbar } from "@/components/site/site-navbar"
import { SiteFooter } from "@/components/site/site-footer"
import type { SiteConfig } from "@/types/site-config"
import { getSiteColorVars } from "@/lib/site-theme"

type EvenementRef = { id: string; title: string; date: string }

type ActualiteDetail = {
  id:          string
  title:       string
  content:     string
  imageUrl:    string | null
  pinned:      boolean
  // Only null in preview mode, for a draft an admin hasn't published yet.
  publishedAt: string | null
  evenement:   EvenementRef | null
}

type SiteInfo = { name: string; config: SiteConfig | null }

// The route always returns `site` when the association/site itself is reachable, even when
// the specific actualite 404s — so a stale/bad link can still render the site's nav/footer
// around a "not found" message instead of stranding the visitor on a bare page.
type ApiResponse = { actualite?: ActualiteDetail; site?: SiteInfo; error?: string; previewMode?: boolean }

type Props = { slug: string; id: string }

// The site's own "Actualités" section is the one place a visitor could have come from — send
// them back to its anchor, not just the top of the homepage, so they don't lose their place
// in the list. Falls back to the plain homepage when the section isn't on the page (or the
// site config couldn't be read at all).
function backHref(slug: string, site?: SiteInfo) {
  const sectionId = site?.config?.sections.find(s => s.type === "actualites")?.id
  return sectionId ? `/${slug}#${sectionId}` : `/${slug}`
}

function Chrome({ site, slug, children }: { site: SiteInfo; slug: string; children: React.ReactNode }) {
  const config = site.config
  const color  = "var(--site-primary)"
  return (
    <div
      className="min-h-screen flex flex-col bg-white text-gray-900"
      style={{ colorScheme: "light", ...getSiteColorVars(config) }}
    >
      <SiteNavbar
        name={site.name}
        logoUrl={config?.logoUrl}
        color={color}
        secondaryColor="var(--site-secondary)"
        portalSlug={slug}
        headerBgColor={config?.headerBgColor}
        headerShowMembres={config?.headerShowMembres}
        headerShowRegister={config?.headerShowRegister}
        membershipCta={null}
      />
      <main className="flex-1">{children}</main>
      <SiteFooter
        name={site.name}
        footerText={config?.footerText}
        footerBgColor={config?.footerBgColor}
        footerLinks={config?.footerLinks}
        color={color}
      />
    </div>
  )
}

export function ActualiteDetailView({ slug, id }: Props) {
  const t             = useTranslations("actualites.publicView")
  const format        = useFormatter()
  const searchParams  = useSearchParams()
  const isPreview     = searchParams.get("preview") === "1"

  // Never throws on a non-2xx — a 404 still carries `site` in its body, which the render
  // below needs to keep the page's chrome up even when the post itself can't be found.
  const { data, isLoading } = useQuery<ApiResponse>({
    queryKey: ["public-actualite", slug, id, isPreview],
    queryFn:  () => fetch(`/api/public/${slug}/actualites/${id}${isPreview ? "?preview=1" : ""}`).then(r => r.json()),
  })

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-white py-10 px-4">
        <div className="max-w-3xl mx-auto space-y-6 animate-pulse">
          <div className="h-4 w-24 rounded bg-gray-100" />
          <div className="aspect-video w-full rounded-lg bg-gray-100" />
          <div className="space-y-3">
            <div className="h-7 w-3/4 rounded bg-gray-100" />
            <div className="h-3 w-32 rounded bg-gray-100" />
          </div>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-3 w-full rounded bg-gray-100" />)}
          </div>
        </div>
      </div>
    )
  }

  const { actualite: post, site } = data

  if (!post) {
    const notFoundBody = (
      <div className="flex flex-col items-center justify-center text-center px-4 py-24 gap-4">
        <p className="text-lg font-semibold">{t("notFound")}</p>
        <Link href={backHref(slug, site)} className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline">
          <ArrowLeftIcon className="size-3.5" />
          {t("backToSite")}
        </Link>
      </div>
    )
    // No `site` at all means the association/site itself isn't reachable (unpublished,
    // module off) — nothing to build chrome from, so fall back to the bare centered message.
    return site ? <Chrome site={site} slug={slug}>{notFoundBody}</Chrome> : <div className="min-h-screen">{notFoundBody}</div>
  }

  const color = "var(--site-primary)"
  const ev    = post.evenement

  return (
    <Chrome site={site!} slug={slug}>
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        <Link
          href={backHref(slug, site)}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeftIcon className="size-3.5" />
          {t("backToSite")}
        </Link>

        {data.previewMode && (
          <p className="rounded-md border border-dashed border-gray-300 px-3 py-2 text-center text-xs text-gray-500">
            {t("previewNotice")}
          </p>
        )}

        {post.imageUrl && (
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-gray-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.imageUrl} aria-hidden alt="" className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.imageUrl} alt={post.title} className="relative z-10 w-full h-full object-contain" />
          </div>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {post.pinned && (
              <span className="inline-flex items-center gap-1.5 bg-orange-500/80 text-white rounded-md px-2 py-0.5 text-xs font-medium">
                <PushPinIcon className="size-2.5" /> {t("pinned")}
              </span>
            )}
            {post.publishedAt ? (
              <time className="text-xs text-gray-400">
                {format.dateTime(new Date(post.publishedAt), { day: "numeric", month: "long", year: "numeric" })}
              </time>
            ) : (
              <span className="text-xs text-gray-400">{t("draft")}</span>
            )}
          </div>
          <h1 className="text-2xl font-bold leading-snug text-gray-900">{post.title}</h1>
        </div>

        <RichTextView content={post.content} className="prose prose-sm max-w-none" />

        {ev && (
          <Link
            href={`/${slug}/evenements/${ev.id}`}
            className="block rounded-lg border border-gray-100 p-4 space-y-1 hover:bg-gray-50 transition-colors"
          >
            <p className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color }}>
              <CalendarBlankIcon className="size-3.5" />
              {t("relatedEvent")}
            </p>
            <p className="font-semibold text-gray-900">{ev.title}</p>
            <p className="text-xs text-gray-500">
              {format.dateTime(new Date(ev.date), { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "numeric" })}
            </p>
          </Link>
        )}
      </div>
    </Chrome>
  )
}
