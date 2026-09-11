import type { Locale } from "@/i18n/locales"
import { isHelpModuleKey, type HelpModuleKey } from "@/lib/help/modules"
import { sanityFetchUncached } from "@/sanity/fetch"
import { HELP_SEARCH_KEYWORD_QUERY, HELP_SEARCH_QUERY } from "@/sanity/queries"
import type { HelpRetrievalHit, HelpSearchHit, HelpSource } from "@/sanity/types"

const MAX_HITS               = 20
const SNIPPET_LENGTH         = 160
const RETRIEVAL_TEXT_LENGTH  = 1500
// After the semantic query fails (dataset embeddings not enabled/ready yet), keyword-only is
// used for this long before the semantic query is tried again — instead of paying a failing
// round-trip on every single search until the next deploy.
const SEMANTIC_RETRY_DELAY_MS = 5 * 60_000

// What the GROQ projection returns: the DTO with every field possibly missing/null.
type HelpRawHit = { [Field in keyof HelpRetrievalHit]: HelpRetrievalHit[Field] | null }

type HybridQueryParams = { q: string; locale: Locale; module: HelpModuleKey | null; limit: number }

let semanticUnavailableUntil = 0

// Only the "embeddings not enabled / still computing" family of errors is worth degrading
// for; a transient 429/5xx must surface like any other Sanity error instead of silently
// switching search to keyword-only for five minutes. Those are 400-class query errors whose
// message names the missing capability.
function isSemanticUnavailableError(error: unknown): boolean {
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? Number((error as { statusCode: unknown }).statusCode) : NaN
  if (statusCode === 429 || statusCode >= 500) return false
  const message = error instanceof Error ? error.message : String(error)
  return /still being computed|not enabled|semanticSimilarity/i.test(message)
}

// Hybrid (keyword + semantic) first; keyword-only when the semantic function is unavailable.
// Rows come back normalised, so both callers work with complete HelpRetrievalHit values.
async function runHybridHelpQuery(params: HybridQueryParams): Promise<HelpRetrievalHit[]> {
  const rows = await runRawHelpQuery(params)
  return rows.map(normalizeHit)
}

async function runRawHelpQuery(params: HybridQueryParams): Promise<HelpRawHit[]> {
  if (Date.now() >= semanticUnavailableUntil) {
    try {
      return await sanityFetchUncached<HelpRawHit[]>({ query: HELP_SEARCH_QUERY, params })
    } catch (error) {
      if (!isSemanticUnavailableError(error)) throw error
      semanticUnavailableUntil = Date.now() + SEMANTIC_RETRY_DELAY_MS
      console.warn(
        "[help-search] semantic similarity unavailable (dataset embeddings not enabled or still computing) — keyword-only search for 5 minutes:",
        error instanceof Error ? error.message : error,
      )
    }
  }
  return sanityFetchUncached<HelpRawHit[]>({ query: HELP_SEARCH_KEYWORD_QUERY, params })
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength).trimEnd()}…`
}

function clampLimit(limit: number): number {
  return Math.min(MAX_HITS, Math.max(1, Math.floor(limit)))
}

function normalizeHit(hit: HelpRawHit): HelpRetrievalHit {
  return {
    id:     hit.id ?? "",
    type:   hit.type ?? "helpArticle",
    title:  hit.title?.trim() || "Sans titre",
    slug:   hit.slug ?? null,
    module: isHelpModuleKey(hit.module) ? hit.module : null,
    text:   hit.text?.trim() ?? "",
    score:  hit.score ?? 0,
  }
}

// Help-panel search results — one short snippet per hit.
export async function searchHelp(options: { query: string; locale: Locale; limit?: number }): Promise<HelpSearchHit[]> {
  const hits = await runHybridHelpQuery({
    q:      options.query,
    locale: options.locale,
    module: null,
    limit:  clampLimit(options.limit ?? 10),
  })
  return hits.map((hit) => {
    const snippet = collapseWhitespace(hit.text)
    return {
      id:      hit.id,
      type:    hit.type,
      title:   hit.title,
      slug:    hit.slug,
      module:  hit.module,
      snippet: snippet ? truncate(snippet, SNIPPET_LENGTH) : null,
    }
  })
}

// Passages handed to the AI prompts (help assistant, support reply suggestion). The current
// module only nudges the ranking, so an answer that lives on another screen is still found.
export async function retrieveHelpContext(options: {
  question: string
  locale:   Locale
  module?:  HelpModuleKey | null
  limit?:   number
}): Promise<HelpRetrievalHit[]> {
  const hits = await runHybridHelpQuery({
    q:      options.question,
    locale: options.locale,
    module: options.module ?? null,
    limit:  clampLimit(options.limit ?? 5),
  })
  return hits
    .filter((hit) => hit.text.length > 0)
    .map((hit) => ({ ...hit, text: truncate(hit.text, RETRIEVAL_TEXT_LENGTH) }))
}

// The passages as every AI prompt receives them — one format for each route that cites the docs.
export function formatHelpDocumentation(hits: HelpRetrievalHit[]): string {
  return hits.length > 0
    ? hits.map((hit, index) => `[${index + 1}] ${hit.title} — ${hit.text}`).join("\n\n")
    : "(aucune documentation pertinente trouvée)"
}

// Best-effort retrieval for the AI routes: with nothing to cite the model is told to say so,
// which is still a useful answer — a Sanity outage must not take the whole answer down.
export async function retrieveHelpContextOrEmpty(
  options:   Parameters<typeof retrieveHelpContext>[0],
  logPrefix: string,
): Promise<HelpRetrievalHit[]> {
  try {
    return await retrieveHelpContext(options)
  } catch (error) {
    console.error(`${logPrefix} retrieval failed, answering without documentation:`, error)
    return []
  }
}

// What the UI lists under an AI answer — the retrieved documents, de-duplicated by id.
export function helpSourcesFrom(hits: HelpRetrievalHit[]): HelpSource[] {
  const seenIds = new Set<string>()
  const sources: HelpSource[] = []
  for (const hit of hits) {
    if (seenIds.has(hit.id)) continue
    seenIds.add(hit.id)
    sources.push({ title: hit.title, slug: hit.slug, module: hit.module, type: hit.type })
  }
  return sources
}
