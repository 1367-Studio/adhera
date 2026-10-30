"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useLocale, useTranslations } from "next-intl"
import { PushPinIcon } from "@phosphor-icons/react/dist/ssr"
import { SitePublicChrome, type PublicSiteInfo } from "@/components/site/site-public-chrome"
import { plainTextExcerpt, formatLongDate } from "@/components/site/blocks/site-block-listing"
import { BASE_PATH } from "@/lib/env"

type PublicActualiteSummary = {
  id:          string
  title:       string
  content:     string
  imageUrl:    string | null
  pinned:      boolean
  publishedAt: string
}

type ApiResponse = { actualites?: PublicActualiteSummary[]; site?: PublicSiteInfo; error?: string }

const LOADING_ROW_KEYS = ["first", "second", "third"]

export function PublicActualitesListView({ slug }: { slug: string }) {
  const t      = useTranslations("actualites.publicView")
  const locale = useLocale()
  // Mirrors the "Traduire cette page" toggle (PublicSiteLocaleSwitcher) on this page's own
  // URL — the admin's original text is shown until the visitor explicitly asks for a translation.
  const isTranslate = useSearchParams().get("translate") === "1"

  // BASE_PATH prefix: the app is served under /app, and a bare "/api/…" from the browser
  // resolves against the origin root, where Next has no route.
  const { data, isLoading } = useQuery<ApiResponse>({
    queryKey: ["public-association-actualites", slug, isTranslate],
    queryFn:  () => fetch(`${BASE_PATH}/api/public/${slug}/actualites${isTranslate ? "?translate=1" : ""}`).then(response => response.json()),
  })

  const site       = data?.site ?? { name: "", config: null }
  const actualites = data?.actualites ?? []
  // The route answers without `site` when the slug matches no association (or the site/module
  // is off) — without this check that reads as "published nothing", a confusing state to debug.
  const associationMissing = !isLoading && !data?.site

  return (
    <SitePublicChrome site={site} slug={slug}>
      <div className="mx-auto w-full max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-bold tracking-tight">{t("listTitle")}</h1>

        <div className="mt-8">
          {associationMissing ? (
            <p className="text-sm text-gray-500">{t("associationNotFound")}</p>
          ) : isLoading ? (
            <div className="divide-y divide-gray-200 border-y border-gray-200">
              {LOADING_ROW_KEYS.map(rowKey => (
                <div key={rowKey} className="space-y-2 py-5">
                  <div className="h-4 w-1/2 animate-pulse rounded bg-gray-100" />
                  <div className="h-3 w-32 animate-pulse rounded bg-gray-100" />
                </div>
              ))}
            </div>
          ) : actualites.length === 0 ? (
            <p className="text-sm text-gray-500">{t("listEmpty")}</p>
          ) : (
            <div className="divide-y divide-gray-200 border-y border-gray-200">
              {actualites.map(actualite => (
                <Link
                  key={actualite.id}
                  href={`/${slug}/actualites/${actualite.id}`}
                  className="flex items-start gap-4 py-5 transition-colors hover:bg-gray-50"
                >
                  {actualite.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={actualite.imageUrl}
                      alt=""
                      loading="lazy"
                      className="aspect-[4/3] w-24 shrink-0 rounded-md object-cover sm:w-32"
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {actualite.pinned && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-orange-500/80 px-2 py-0.5 text-xs font-medium text-white">
                          <PushPinIcon className="size-2.5" /> {t("pinned")}
                        </span>
                      )}
                      <time className="text-xs text-gray-400">{formatLongDate(actualite.publishedAt, locale)}</time>
                    </div>
                    <h2 className="truncate text-base font-semibold text-gray-900">{actualite.title}</h2>
                    <p className="line-clamp-2 text-sm text-gray-500">{plainTextExcerpt(actualite.content)}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </SitePublicChrome>
  )
}
