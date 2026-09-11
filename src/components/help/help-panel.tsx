"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { format, parseISO } from "date-fns"
import { HelpArticleView } from "@/components/help/help-article-view"
import { HelpAssistant } from "@/components/help/help-assistant"
import { canAccessDashboardRoute } from "@/components/layout/app-sidebar"
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion"
import { BackLink } from "@/components/ui/back-link"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/ui/search-input"
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { useSidebar } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  HELP_ERROR_CODES, HELP_SEARCH_MIN_LENGTH,
  useHelpArticle, useHelpArticles, useHelpChangelog, useHelpSearch,
  type HelpSearchHit,
} from "@/hooks/use-help"
import type { Locale } from "@/i18n/locales"
import { ApiError } from "@/lib/api-error"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import { helpModuleFromPathname, type HelpModuleKey } from "@/lib/help/modules"
import { getRouteLabels } from "@/lib/route-labels"
import { useCurrentUser } from "@/lib/user-context"

const SEARCH_DEBOUNCE_MS  = 300
// Same cap as the /api/help/search validation, so a long paste is trimmed instead of rejected.
const SEARCH_MAX_LENGTH   = 200
const DATE_FORMAT         = "d MMM yyyy"

type HelpTabKey = "guide" | "assistant" | "changelog"

// The Aide tab is either browsing/searching the list, or reading one piece of content.
type HelpGuideView =
  | { kind: "browse" }
  | { kind: "article"; slug: string }
  | { kind: "faq";     id: string; module: HelpModuleKey }

// Module labels are the same route labels the header breadcrumbs use (src/lib/route-labels.ts);
// only the catch-all "general" needs a help-specific label.
function useHelpModuleLabel() {
  const t           = useTranslations("help")
  const translate   = useTranslations()
  const routeLabels = useMemo(() => getRouteLabels(translate), [translate])
  return (moduleKey: HelpModuleKey | null): string =>
    !moduleKey || moduleKey === "general" ? t("moduleGeneral") : (routeLabels[moduleKey] ?? moduleKey)
}

interface HelpPanelProps {
  open:            boolean
  onOpenChange:    (open: boolean) => void
  /** Asks HelpButton to close the panel and launch the guided tour once it has closed. */
  onStartTour:     () => void
  /** Fires after the close transition has fully finished (backdrop and focus trap gone). */
  onCloseComplete: () => void
}

export function HelpPanel({ open, onOpenChange, onStartTour, onCloseComplete }: HelpPanelProps) {
  const t           = useTranslations("help")
  const pathname    = usePathname()
  const moduleLabel = useHelpModuleLabel()
  const currentUser = useCurrentUser()
  const { isMobile } = useSidebar()

  const currentModule = helpModuleFromPathname(pathname)

  const [activeTab, setActiveTab]                       = useState<HelpTabKey>("guide")
  const [searchQuery, setSearchQuery]                   = useState("")
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("")
  const [guideView, setGuideView]                       = useState<HelpGuideView>({ kind: "browse" })

  const searchInputRef    = useRef<HTMLInputElement>(null)
  const guideScrollRef    = useRef<HTMLDivElement>(null)
  const previousModuleRef = useRef(currentModule)

  useEffect(() => {
    const debounceTimer = window.setTimeout(() => setDebouncedSearchQuery(searchQuery), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(debounceTimer)
  }, [searchQuery])

  // Navigating to another module while the panel is open: the article being read belongs to
  // the screen the user just left, so fall back to the list. Tab and search are kept.
  useEffect(() => {
    if (previousModuleRef.current === currentModule) return
    previousModuleRef.current = currentModule
    setGuideView({ kind: "browse" })
  }, [currentModule])

  // Entering an article (and coming back out of one) starts at the top of the panel.
  useEffect(() => {
    guideScrollRef.current?.scrollTo({ top: 0 })
  }, [guideView])

  function clearSearch() {
    setSearchQuery("")
    setDebouncedSearchQuery("")
  }

  function openArticleFromAssistant(slug: string) {
    setActiveTab("guide")
    setGuideView({ kind: "article", slug })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} onOpenChangeComplete={isOpen => { if (!isOpen) onCloseComplete() }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md flex flex-col gap-0 p-0 overflow-hidden"
        // Desktop opens straight into the search field; on mobile the default focus keeps
        // the on-screen keyboard down.
        initialFocus={isMobile ? undefined : searchInputRef}
      >
        <Tabs
          value={activeTab}
          onValueChange={value => setActiveTab(value as HelpTabKey)}
          className="flex h-full min-h-0 flex-col gap-0"
        >
          <SheetHeader className="shrink-0 gap-0.5 border-b px-4 pt-10 pb-3">
            <SheetTitle>{t("title")}</SheetTitle>
            {currentModule !== "general" && (
              <SheetDescription>{moduleLabel(currentModule)}</SheetDescription>
            )}
            <TabsList className="mt-3 w-full">
              <TabsTrigger value="guide">{t("tabs.guide")}</TabsTrigger>
              <TabsTrigger value="assistant">{t("tabs.assistant")}</TabsTrigger>
              <TabsTrigger value="changelog">{t("tabs.changelog")}</TabsTrigger>
            </TabsList>
          </SheetHeader>

          <TabsContent value="guide" ref={guideScrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <HelpGuideTab
              module={currentModule}
              searchQuery={searchQuery}
              debouncedSearchQuery={debouncedSearchQuery}
              onSearchQueryChange={setSearchQuery}
              onClearSearch={clearSearch}
              guideView={guideView}
              onGuideViewChange={setGuideView}
              searchInputRef={searchInputRef}
            />
          </TabsContent>

          {/* keepMounted: the conversation must survive a trip to the Aide tab and back.
              overflow-hidden, not overflow-y-auto: the tab pins its own composer and lets the
              transcript region inside it scroll. */}
          <TabsContent value="assistant" keepMounted className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <HelpAssistant
              module={currentModule}
              isActive={activeTab === "assistant"}
              onOpenArticle={openArticleFromAssistant}
              onClosePanel={() => onOpenChange(false)}
            />
          </TabsContent>

          <TabsContent value="changelog" className="min-h-0 flex-1 overflow-y-auto">
            <HelpChangelogTab />
          </TabsContent>

          <SheetFooter className="shrink-0 flex-row items-center justify-between border-t px-4 py-2">
            <Button variant="ghost" size="sm" onClick={onStartTour}>
              {t("footer.tour")}
            </Button>
            {canAccessDashboardRoute(currentUser.role, "/dashboard/suporte") && (
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<Link href="/dashboard/suporte" onClick={() => onOpenChange(false)} />}
              >
                {t("footer.contactSupport")}
              </Button>
            )}
          </SheetFooter>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ Aide tab */

interface HelpGuideTabProps {
  module:               HelpModuleKey
  searchQuery:          string
  debouncedSearchQuery: string
  onSearchQueryChange:  (value: string) => void
  onClearSearch:        () => void
  guideView:            HelpGuideView
  onGuideViewChange:    (view: HelpGuideView) => void
  searchInputRef:       React.RefObject<HTMLInputElement | null>
}

function HelpGuideTab({
  module, searchQuery, debouncedSearchQuery, onSearchQueryChange, onClearSearch,
  guideView, onGuideViewChange, searchInputRef,
}: HelpGuideTabProps) {
  const t           = useTranslations("help")
  const locale      = useLocale() as Locale
  const pathname    = usePathname()
  const moduleLabel = useHelpModuleLabel()

  // FAQ entries have no detail endpoint — they are resolved through the module listing they
  // came from (which also carries the "general" entries). Same key as the browse query
  // whenever the FAQ hit belongs to the current module, so that costs no extra request.
  const faqModule        = guideView.kind === "faq" ? guideView.module : module
  const moduleContent    = useHelpArticles(module)
  const faqModuleContent = useHelpArticles(faqModule)
  const articleQuery     = useHelpArticle(guideView.kind === "article" ? guideView.slug : null)
  const searchResults    = useHelpSearch(debouncedSearchQuery)

  const isResultsMode = debouncedSearchQuery.trim().length >= HELP_SEARCH_MIN_LENGTH

  function backToList(event: React.MouseEvent<HTMLAnchorElement>) {
    // Stays a real <Link> (BackLink's contract) but the navigation happens inside the panel.
    event.preventDefault()
    onGuideViewChange({ kind: "browse" })
  }

  function openSearchHit(hit: HelpSearchHit) {
    if (hit.type === "helpArticle" && hit.slug) {
      onGuideViewChange({ kind: "article", slug: hit.slug })
      return
    }
    onGuideViewChange({ kind: "faq", id: hit.id, module: hit.module ?? "general" })
  }

  if (guideView.kind === "article") {
    if (articleQuery.isPending) return <HelpArticleDetailSkeleton />

    if (articleQuery.isError) {
      const isNotFound = articleQuery.error instanceof ApiError && articleQuery.error.code === HELP_ERROR_CODES.notFound
      return (
        <div className="px-4 py-4">
          <BackLink href={pathname} onClick={backToList}>{t("back")}</BackLink>
          {isNotFound ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("articleNotFound")}</p>
          ) : (
            <div className="mt-3 flex flex-col items-start gap-2">
              <p className="text-sm text-destructive">{t("loadError")}</p>
              <Button variant="ghost" size="sm" onClick={() => articleQuery.refetch()}>{t("retry")}</Button>
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="px-4 py-4">
        <BackLink href={pathname} onClick={backToList}>{t("back")}</BackLink>
        <h2 className="mt-3 text-lg font-semibold leading-snug">{articleQuery.data.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("updatedOn", {
            date: format(parseISO(articleQuery.data.updatedAt), DATE_FORMAT, { locale: getDateFnsLocale(locale) }),
          })}
        </p>
        <HelpArticleView value={articleQuery.data.body} className="mt-4" />
      </div>
    )
  }

  if (guideView.kind === "faq") {
    if (faqModuleContent.isPending) return <HelpArticleDetailSkeleton />

    const faqEntry = faqModuleContent.data?.faq.find(entry => entry.id === guideView.id)
    return (
      <div className="px-4 py-4">
        <BackLink href={pathname} onClick={backToList}>{t("back")}</BackLink>
        {faqEntry ? (
          <>
            <h2 className="mt-3 text-lg font-semibold leading-snug">{faqEntry.question}</h2>
            <HelpArticleView value={faqEntry.answer} className="mt-4" />
          </>
        ) : faqModuleContent.isError ? (
          <div className="mt-3 flex flex-col items-start gap-2">
            <p className="text-sm text-destructive">{t("loadError")}</p>
            <Button variant="ghost" size="sm" onClick={() => faqModuleContent.refetch()}>{t("retry")}</Button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{t("articleNotFound")}</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 py-4">
      <div className="px-4">
        <SearchInput
          ref={searchInputRef}
          value={searchQuery}
          onValueChange={onSearchQueryChange}
          onClear={onClearSearch}
          containerClassName="w-full"
          placeholder={t("searchPlaceholder")}
          maxLength={SEARCH_MAX_LENGTH}
        />
      </div>

      {isResultsMode ? (
        searchResults.isPending ? (
          <HelpListSkeleton rows={3} />
        ) : searchResults.isError ? (
          <p className="px-4 py-6 text-sm text-destructive">{t("searchError")}</p>
        ) : (searchResults.data ?? []).length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {t("searchNoResults", { query: debouncedSearchQuery.trim() })}
          </p>
        ) : (
          <div>
            <p className="px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("searchResultsCount", { count: (searchResults.data ?? []).length })}
            </p>
            <ul className="mt-1 divide-y divide-border/60">
              {(searchResults.data ?? []).map(hit => (
                <li key={`${hit.type}-${hit.id}`}>
                  <button
                    type="button"
                    onClick={() => openSearchHit(hit)}
                    className="flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-1 focus-visible:outline-ring"
                  >
                    <span className="flex w-full items-baseline justify-between gap-3">
                      <span className="min-w-0 text-sm font-medium text-foreground">{hit.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{moduleLabel(hit.module)}</span>
                    </span>
                    {hit.snippet && (
                      <span className="text-xs text-muted-foreground line-clamp-2">{hit.snippet}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : moduleContent.isPending ? (
        <HelpListSkeleton rows={4} />
      ) : moduleContent.isError ? (
        <div className="flex flex-col items-start gap-2 px-4 py-6">
          <p className="text-sm text-destructive">{t("loadError")}</p>
          <Button variant="ghost" size="sm" onClick={() => moduleContent.refetch()}>{t("retry")}</Button>
        </div>
      ) : moduleContent.data.articles.length === 0 && moduleContent.data.faq.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{t("noContent")}</p>
      ) : (
        <>
          <div>
            <p className="px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("articlesSection")}
            </p>
            {moduleContent.data.articles.length === 0 ? (
              <p className="mt-1 px-4 text-sm text-muted-foreground">{t("noArticles")}</p>
            ) : (
              <ul className="mt-1 divide-y divide-border/60">
                {moduleContent.data.articles.map(article => (
                  <li key={article.id}>
                    <button
                      type="button"
                      onClick={() => onGuideViewChange({ kind: "article", slug: article.slug })}
                      className="flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-1 focus-visible:outline-ring"
                    >
                      <span className="text-sm font-medium text-foreground">{article.title}</span>
                      {article.summary && (
                        <span className="text-xs text-muted-foreground line-clamp-2">{article.summary}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {moduleContent.data.faq.length > 0 && (
            <div>
              <p className="px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("faqSection")}
              </p>
              <Accordion multiple variant="plain" className="mt-1">
                {moduleContent.data.faq.map(entry => (
                  <AccordionItem key={entry.id} value={entry.id}>
                    <AccordionTrigger>{entry.question}</AccordionTrigger>
                    <AccordionPanel>
                      <HelpArticleView value={entry.answer} />
                    </AccordionPanel>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------- Nouveautés tab */

function HelpChangelogTab() {
  const t      = useTranslations("help")
  const locale = useLocale() as Locale

  const changelogQuery = useHelpChangelog()

  if (changelogQuery.isPending) {
    return (
      <div>
        {[0, 1, 2].map(row => (
          <div key={row} className="space-y-2 px-4 py-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    )
  }

  if (changelogQuery.isError) {
    return (
      <div className="flex flex-col items-start gap-2 px-4 py-6">
        <p className="text-sm text-destructive">{t("changelog.loadError")}</p>
        <Button variant="ghost" size="sm" onClick={() => changelogQuery.refetch()}>{t("retry")}</Button>
      </div>
    )
  }

  const entries = changelogQuery.data
  if (entries.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">{t("changelog.empty")}</p>
  }

  return (
    <Accordion multiple variant="plain">
      {entries.map(entry => {
        const hasBody = !!entry.body && entry.body.length > 0
        return (
          <AccordionItem key={entry.id} value={entry.id}>
            {/* An entry with no body cannot expand: the caret would promise a panel that
                never opens, so it is hidden and the trigger disabled. */}
            <AccordionTrigger disabled={!hasBody} className={hasBody ? undefined : "[&>svg]:hidden"}>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                {/* `publishedAt` is a date-only value: parseISO keeps it on the editor's calendar
                    day instead of shifting it through UTC midnight for viewers west of UTC. */}
                <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                  <time dateTime={entry.publishedAt}>
                    {format(parseISO(entry.publishedAt), DATE_FORMAT, { locale: getDateFnsLocale(locale) })}
                  </time>
                  <span aria-hidden>·</span>
                  <span>{t(`changelog.kind.${entry.kind}`)}</span>
                </span>
                <span className="text-sm font-medium text-foreground">{entry.title}</span>
              </span>
            </AccordionTrigger>
            {hasBody && (
              <AccordionPanel>
                <HelpArticleView value={entry.body} />
              </AccordionPanel>
            )}
          </AccordionItem>
        )
      })}
    </Accordion>
  )
}

/* ------------------------------------------------------------- Loading */

function HelpListSkeleton({ rows }: { rows: number }) {
  return (
    <div>
      {Array.from({ length: rows }, (_unused, row) => (
        <div key={row} className="space-y-2 px-4 py-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  )
}

function HelpArticleDetailSkeleton() {
  return (
    <div className="space-y-3 px-4 py-4">
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}
