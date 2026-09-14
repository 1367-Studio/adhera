import { keepPreviousData, skipToken, useMutation, useQuery } from "@tanstack/react-query"
import { apiError } from "@/lib/api-error"
import type { HelpModuleKey } from "@/lib/help/modules"
import type {
  ChangelogEntry,
  FaqEntry,
  HelpArticle,
  HelpArticleSummary,
  HelpModuleContent,
  HelpSearchHit,
  HelpSource,
  SupportReplySuggestion,
} from "@/sanity/types"

export type {
  ChangelogEntry,
  FaqEntry,
  HelpArticle,
  HelpArticleSummary,
  HelpModuleContent,
  HelpSearchHit,
  HelpSource,
  SupportReplySuggestion,
}

const QK = ["help"]

// Help content only changes when an editor publishes in the Studio — no reason to refetch it
// every time the panel opens.
const HELP_CONTENT_STALE_TIME = 5 * 60_000
const HELP_SEARCH_STALE_TIME  = 60_000
// Exported so the panel can decide "results mode" with the same threshold the query uses.
export const HELP_SEARCH_MIN_LENGTH = 3

// Error codes the help routes attach to their JSON errors — clients branch on these, never on
// the (untranslated, server-language) message text.
export const HELP_ERROR_CODES = {
  notFound:            "NOT_FOUND",
  aiKeyMissing:        "AI_KEY_MISSING",
  aiKeyInvalid:        "AI_KEY_INVALID",
  aiTimeout:           "AI_TIMEOUT",
  aiRateLimit:         "AI_RATE_LIMIT",
  aiProviderRateLimit: "AI_PROVIDER_RATE_LIMIT",
  aiProviderError:     "AI_PROVIDER_ERROR",
  aiUnexpected:        "AI_UNEXPECTED",
} as const

async function fetchHelpArticles(module: HelpModuleKey): Promise<HelpModuleContent> {
  const params = new URLSearchParams({ module })
  const res = await fetch(`/api/help/articles?${params}`)
  if (!res.ok) throw await apiError(res, "Erreur lors du chargement")
  return res.json()
}

async function fetchHelpArticle(slug: string): Promise<HelpArticle> {
  const res = await fetch(`/api/help/articles/${encodeURIComponent(slug)}`)
  if (!res.ok) throw await apiError(res, "Erreur lors du chargement")
  return res.json()
}

async function fetchHelpSearch(query: string): Promise<HelpSearchHit[]> {
  const params = new URLSearchParams({ q: query })
  const res = await fetch(`/api/help/search?${params}`)
  if (!res.ok) throw await apiError(res, "Erreur lors de la recherche")
  return res.json()
}

async function fetchHelpChangelog(): Promise<ChangelogEntry[]> {
  const res = await fetch("/api/help/changelog")
  if (!res.ok) throw await apiError(res, "Erreur lors du chargement")
  return res.json()
}

async function suggestSupportReply(ticketId: string): Promise<SupportReplySuggestion> {
  const res = await fetch(`/api/backoffice/support-tickets/${ticketId}/suggest-reply`, { method: "POST" })
  if (!res.ok) throw await apiError(res, "Erreur IA")
  return res.json()
}

export function useHelpArticles(module: HelpModuleKey) {
  return useQuery({
    queryKey:  [...QK, "articles", module],
    queryFn:   () => fetchHelpArticles(module),
    staleTime: HELP_CONTENT_STALE_TIME,
  })
}

export function useHelpArticle(slug: string | null) {
  return useQuery({
    queryKey:  [...QK, "article", slug],
    queryFn:   slug ? () => fetchHelpArticle(slug) : skipToken,
    staleTime: HELP_CONTENT_STALE_TIME,
  })
}

// Debouncing is the caller's job; this only refuses to fire below 3 characters and keeps the
// previous results on screen while the next query is in flight (no flash to empty).
export function useHelpSearch(query: string) {
  const trimmedQuery = query.trim()
  const enabled      = trimmedQuery.length >= HELP_SEARCH_MIN_LENGTH
  return useQuery({
    queryKey:        [...QK, "search", trimmedQuery],
    queryFn:         enabled ? () => fetchHelpSearch(trimmedQuery) : skipToken,
    placeholderData: enabled ? keepPreviousData : undefined,
    staleTime:       HELP_SEARCH_STALE_TIME,
  })
}

export function useHelpChangelog() {
  return useQuery({
    queryKey:  [...QK, "changelog"],
    queryFn:   fetchHelpChangelog,
    staleTime: HELP_CONTENT_STALE_TIME,
  })
}

export function useSuggestSupportReply(ticketId: string) {
  return useMutation<SupportReplySuggestion, Error, void>({ mutationFn: () => suggestSupportReply(ticketId) })
}
