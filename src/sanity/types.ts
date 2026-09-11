import type { PortableTextBlock } from "@portabletext/react"
import type { HelpModuleKey } from "@/lib/help/modules"

// Hand-written result DTOs for the queries in src/sanity/queries.ts — every field is
// projected explicitly there, and localised fields arrive already resolved to one string
// (requested locale, French fallback), never as the raw internationalized arrays.

export type HelpContentType = "helpArticle" | "faqEntry"
export type ChangelogKind   = "feature" | "improvement" | "fix"

export type HelpArticleSummary = {
  id:      string
  slug:    string
  title:   string
  summary: string | null
  module:  HelpModuleKey
  order:   number
}

export type HelpArticle = {
  id:        string
  slug:      string
  title:     string
  summary:   string | null
  module:    HelpModuleKey
  body:      PortableTextBlock[]
  updatedAt: string
}

export type FaqEntry = {
  id:       string
  question: string
  answer:   PortableTextBlock[]
  module:   HelpModuleKey | null
}

export type HelpModuleContent = {
  articles: HelpArticleSummary[]
  faq:      FaqEntry[]
}

export type ChangelogEntry = {
  id:          string
  title:       string
  publishedAt: string
  kind:        ChangelogKind
  modules:     HelpModuleKey[]
  body:        PortableTextBlock[] | null
}

export type HelpSearchHit = {
  id:      string
  type:    HelpContentType
  title:   string
  slug:    string | null
  module:  HelpModuleKey | null
  snippet: string | null
}

export type HelpSource = {
  title:  string
  slug:   string | null
  module: HelpModuleKey | null
  type:   HelpContentType
}

// One passage handed to the AI (help assistant / support reply suggestion) — `text` is the
// flattened Portable Text of the localised body/answer, capped in src/lib/help/retrieval.ts.
export type HelpRetrievalHit = {
  id:     string
  type:   HelpContentType
  title:  string
  slug:   string | null
  module: HelpModuleKey | null
  text:   string
  score:  number
}

export type SupportReplySuggestion = { suggestion: string; sources: HelpSource[] }
