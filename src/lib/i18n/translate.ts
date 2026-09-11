import crypto from "crypto"
import { prisma } from "@/lib/prisma/client"
import { resolveAiConfig, type ResolvedAnyAiConfig } from "@/lib/ai/client"
import { completeText } from "@/lib/ai/complete"
import { rateLimit } from "@/lib/rate-limit"
import { writeActivityLog } from "@/lib/activity-log"
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales"

// These public routes are anonymous and uncached-on-first-hit, unlike the other 3 AI
// features (which sit behind withAdminAuth) — an association's own key can otherwise be
// spent by anyone browsing the public site in enough locales, with no login required.
// Capped independently of the Azure path below, which only ever spends the platform's
// shared quota, not an individual association's money.
const AI_TRANSLATE_RATE_LIMIT_WINDOW_MS = 60 * 60_000
const AI_TRANSLATE_RATE_LIMIT_MAX       = 30

// A chat completion is far slower than Azure's dedicated translation endpoint for large
// batches, and public page responses shouldn't stall on it — skip straight to Azure instead
// of risking a slow/hanging own-AI call in the hot path of an anonymous page load.
const AI_TRANSLATE_TIMEOUT_MS = 10_000
const AI_TRANSLATE_MAX_TOKENS = 8000

// Same reasoning as the other 3 AI routes' MAX_TEXT_CHARS-style caps, sized generously
// enough to cover the largest legitimate batch (the portal event list combines title +
// description for ~20 events in one call) while still bounding the cost/latency of a
// pathological one. Skipped straight to Azure rather than attempted and risked truncated
// or malformed output.
const AI_TRANSLATE_MAX_CHARS = 20_000

// Memoizes the association lookup for a few seconds so that a single public page issuing
// several translateFields() calls back-to-back (e.g. content + tiers + customFields on the
// adhesion form) doesn't re-query the same association's AI config on every cache miss.
const aiConfigCache = new Map<string, { config: ResolvedAnyAiConfig | null; expires: number }>()

async function getCachedAiConfig(associationId: string): Promise<ResolvedAnyAiConfig | null> {
  const cached = aiConfigCache.get(associationId)
  if (cached && cached.expires > Date.now()) return cached.config

  const config = await resolveAiConfig(associationId)
  aiConfigCache.set(associationId, { config, expires: Date.now() + 5_000 })
  return config
}

// Order-preserving list of tag names (open/close) — used to catch a BYOK model corrupting
// HTML structure (dropped/reordered tags) in rich-text fields like event descriptions.
// Attributes are ignored on purpose: translating e.g. an <a href> shouldn't count as damage.
function extractTagSequence(html: string): string[] {
  return [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)]
    .map((m) => (m[0].startsWith("</") ? `/${m[1].toLowerCase()}` : m[1].toLowerCase()))
}

function htmlStructurePreserved(original: string, translated: string): boolean {
  const before = extractTagSequence(original)
  if (before.length === 0) return true // plain text (titles, labels) — nothing to preserve
  const after = extractTagSequence(translated)
  return before.length === after.length && before.every((tag, i) => tag === after[i])
}

const AZURE_ENDPOINT = "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&textType=html"

// Azure accepts the BCP-47 tag as-is for every EU language, so only the exceptions are
// listed. Written as an override table rather than an exhaustive map on purpose: enabling a
// new locale in SUPPORTED_LOCALES must not also require an edit here, or association-authored
// content would silently keep coming back in French for that language.
const AZURE_TAG_OVERRIDES: Record<string, string> = {
  "pt-PT": "pt-pt",
}
const azureTag = (locale: string): string => AZURE_TAG_OVERRIDES[locale] ?? locale

function hashText(text: string): string {
  return crypto.createHash("md5").update(text).digest("hex").slice(0, 16)
}

async function azureTranslate(texts: string[], targetLang: string): Promise<string[]> {
  const key    = process.env.AZURE_TRANSLATOR_KEY
  const region = process.env.AZURE_TRANSLATOR_REGION
  if (!key || !region) throw new Error("AZURE_TRANSLATOR_KEY or AZURE_TRANSLATOR_REGION not set")

  const response = await fetch(`${AZURE_ENDPOINT}&to=${targetLang}`, {
    method:  "POST",
    headers: {
      "Ocp-Apim-Subscription-Key":    key,
      "Ocp-Apim-Subscription-Region": region,
      "Content-Type":                 "application/json",
    },
    body: JSON.stringify(texts.map((text) => ({ text }))),
  })
  if (!response.ok) throw new Error(`Azure Translator error: ${response.status}`)

  const data = (await response.json()) as { translations: { text: string }[] }[]
  return data.map((item) => item.translations[0].text)
}

// Prompt-based translation via the association's own AI key (BYOK) — tried before Azure so
// an association with its own AI configured never touches the platform-shared Azure quota.
// Only ever called with an association's *own* key (see batchTranslate below) — never with
// the platform's shared Groq fallback, so translation doesn't compete with the Groq budget
// already shared by the PDF import/summarize/write features.
async function aiTranslate(texts: string[], targetLang: string, aiConfig: ResolvedAnyAiConfig): Promise<string[]> {
  const content = await completeText(aiConfig, {
    system:
      `You are a professional translator. Translate each string in the JSON array to the language ` +
      `identified by the BCP-47 tag "${targetLang}". Preserve any HTML tags and attributes exactly as-is, ` +
      `translating only the visible text nodes. Keep the same array order and length as the input — one ` +
      `translation per input string, never merged or split. Respond with a JSON object of the exact shape ` +
      `{"translations": ["...", "..."]} and nothing else.`,
    user:        JSON.stringify(texts),
    temperature: 0,
    maxTokens:   AI_TRANSLATE_MAX_TOKENS,
    json:        true,
    timeoutMs:   AI_TRANSLATE_TIMEOUT_MS,
  })

  const parsed = JSON.parse(content) as { translations?: unknown }
  if (!Array.isArray(parsed.translations) || parsed.translations.length !== texts.length) {
    throw new Error("AI translation returned a malformed or mismatched result")
  }

  const translated = parsed.translations.map((t) => String(t))
  if (!texts.every((text, i) => htmlStructurePreserved(text, translated[i]))) {
    throw new Error("AI translation altered the HTML structure of one or more fields")
  }
  return translated
}

// Hash-keyed cache: identical text (even across associations, and regardless of which engine
// produced it) is translated once per locale and reused until the source text changes (new
// text → new hash → cache miss).
async function batchTranslate(
  texts: string[],
  locale: Exclude<Locale, typeof DEFAULT_LOCALE>,
  associationId: string,
): Promise<string[]> {
  const hashes = texts.map(hashText)

  const cached   = await prisma.translation.findMany({ where: { locale, hash: { in: hashes } } })
  const cacheMap = new Map(cached.map((r) => [r.hash, r.translated]))

  const misses = texts
    .map((text, i) => ({ text, hash: hashes[i], index: i }))
    .filter((item) => !cacheMap.has(item.hash))

  const results: string[] = texts.map((_, i) => cacheMap.get(hashes[i]) ?? "")

  if (misses.length > 0) {
    const missTexts = misses.map((m) => m.text)
    let translated: string[] | null = null

    // Own AI first (BYOK) — never the platform's shared Groq fallback, only a real own key.
    // Anthropic keys are skipped: a reasoning model with no JSON mode inside the 10 s budget
    // below would mostly time out and log a spurious failure — Azure serves those directly.
    const aiConfig = await getCachedAiConfig(associationId)
    if (aiConfig && !aiConfig.usingPlatform && aiConfig.kind === "openai-compatible") {
      const totalChars = missTexts.reduce((sum, t) => sum + t.length, 0)
      // Both checks below are silent, expected skips (not failures) — an oversized batch or
      // a throttled association just falls through to Azure without anything to log.
      const withinSizeLimit = totalChars <= AI_TRANSLATE_MAX_CHARS
      const withinRateLimit = withinSizeLimit
        ? await rateLimit(`ai-translate:${associationId}`, AI_TRANSLATE_RATE_LIMIT_MAX, AI_TRANSLATE_RATE_LIMIT_WINDOW_MS)
        : false

      if (withinSizeLimit && withinRateLimit) {
        try {
          translated = await aiTranslate(missTexts, locale, aiConfig)
        } catch (err) {
          console.error("[translate] AI translation failed, falling back to Azure:", err)
          // Surfaces a genuine failure (bad model, dead key, malformed output) to the admin —
          // at most once a day per association, so a persistently broken key doesn't spam
          // the activity log on every single public page view.
          if (await rateLimit(`ai-translate-fail-log:${associationId}`, 1, 24 * 60 * 60_000)) {
            await writeActivityLog({
              associationId,
              action:   "AI_TRANSLATE_FAILED",
              entity:   "Association",
              metadata: { error: err instanceof Error ? err.message : String(err) },
            })
          }
        }
      }
    }

    if (!translated) {
      try {
        // Azure supports up to 1000 strings per request — all misses in one call.
        translated = await azureTranslate(missTexts, azureTag(locale))
      } catch (err) {
        console.error("[translate] Azure call failed, falling back to original text:", err)
      }
    }

    if (translated) {
      const final = translated
      await prisma.translation.createMany({
        data: misses.map((m, i) => ({ hash: m.hash, locale, translated: final[i] })),
        skipDuplicates: true,
      })
      for (let i = 0; i < misses.length; i++) results[misses[i].index] = final[i]
    } else {
      for (const miss of misses) results[miss.index] = miss.text
    }
  }

  return results
}

// Translates the named string fields across a list of items in one batched call —
// pass a single-item array to translate one object's fields. No-op for the default
// locale (source language) and for null/empty field values.
export async function translateFields<T extends Record<string, unknown>>(
  items: T[],
  keys: (keyof T & string)[],
  locale: Locale,
  associationId: string,
): Promise<T[]> {
  if (locale === DEFAULT_LOCALE || items.length === 0 || keys.length === 0) return items

  const texts = new Set<string>()
  for (const item of items) {
    for (const key of keys) {
      const value = item[key]
      if (typeof value === "string" && value.trim() !== "") texts.add(value)
    }
  }
  if (texts.size === 0) return items

  const uniqueTexts     = [...texts]
  const translated      = await batchTranslate(uniqueTexts, locale as Exclude<Locale, typeof DEFAULT_LOCALE>, associationId)
  const translationMap  = new Map(uniqueTexts.map((t, i) => [t, translated[i]]))

  return items.map((item) => {
    const clone = { ...item }
    for (const key of keys) {
      const value = item[key]
      if (typeof value === "string" && translationMap.has(value)) {
        clone[key] = translationMap.get(value) as T[typeof key]
      }
    }
    return clone
  })
}
