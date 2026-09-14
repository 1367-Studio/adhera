import type { Locale } from "@/i18n/locales"
import type { AssocModules } from "@/lib/modules"
import type { HelpRetrievalHit, HelpSource } from "@/sanity/types"

// Everything a tool needs to run on behalf of the signed-in user. `associationId` comes from
// the server session only — no tool ever accepts it as model input. `today` is captured once
// per request so every tool and the system prompt agree on "now".
export type ToolContext = {
  associationId: string
  role:          string
  modules:       AssocModules
  locale:        Locale
  today:         Date
  // Sink the search_help_docs tool appends its hits to, so the route can list the help
  // articles that were consulted under the answer (see helpSourcesFrom in run-assistant).
  collectedHelpHits: HelpRetrievalHit[]
}

export type AssistantMode = "copilot" | "docs"

export type AssistantMessage = { role: "user" | "assistant"; content: string }

// inputTokens counts every input token the provider processed (uncached, cache writes and
// cache reads together); cachedInputTokens is the cache-read share of that figure.
export type AssistantUsage = {
  inputTokens:       number
  cachedInputTokens: number
  outputTokens:      number
}

export type AssistantReply = {
  mode:      AssistantMode
  answer:    string
  sources:   HelpSource[]
  toolsUsed: string[]
  usage:     AssistantUsage
}
