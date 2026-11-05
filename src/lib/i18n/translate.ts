import crypto from "crypto"
import { prisma } from "@/lib/prisma/client"
import { resolveAiConfig, type ResolvedAnyAiConfig } from "@/lib/ai/client"
import { completeText } from "@/lib/ai/complete"
import { rateLimit } from "@/lib/rate-limit"
import { writeActivityLog } from "@/lib/activity-log"
import { reportError } from "@/lib/monitoring"
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
// of risking a slow/hanging own-AI call in the hot path of an anonymous page load. Each call
// only ever carries one chunk (see AI_TRANSLATE_CHUNK_MAX_CHARS below), but a single field
// (e.g. a long CGU/conditions block) can't be split without risking broken HTML, so it still
// rides alone in its own oversized chunk — measured at ~30s for a 7 200-char conditions field
// on gpt-4o-mini, hence the generous margin here rather than tying this to the chunk cap.
const AI_TRANSLATE_TIMEOUT_MS = 60_000
const AI_TRANSLATE_MAX_TOKENS = 8000

// Keeps multiple small/medium fields from riding in one oversized call together — a single
// call covering every short field of a form (title + confirmation message + offline
// instructions, etc.) was regularly timing out on gpt-4o-mini even though none of them is
// individually large. Batches over this are split on text boundaries (never mid-string) and
// translated concurrently instead of in one call. A single field already larger than this
// (e.g. a long rich-text description or conditions block) still rides alone in its own
// chunk — AI_TRANSLATE_TIMEOUT_MS above is sized for that case, not this constant.
const AI_TRANSLATE_CHUNK_MAX_CHARS = 2_000

// Greedily groups texts into chunks no larger than maxChars, without ever splitting a single
// text across chunks — a text longer than maxChars on its own just becomes a one-item chunk.
function chunkTexts(texts: string[], maxChars: number): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let currentChars = 0
  for (const text of texts) {
    if (current.length > 0 && currentChars + text.length > maxChars) {
      chunks.push(current)
      current = []
      currentChars = 0
    }
    current.push(text)
    currentChars += text.length
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

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

const AZURE_DETECT_ENDPOINT = "https://api.cognitive.microsofttranslator.com/detect?api-version=3.0"

// Caps what's sent to the detect endpoint — a short sample is enough to identify the
// language reliably and keeps the call fast even for a long email body.
const DETECT_SAMPLE_MAX_CHARS = 1_000

// Below this confidence, treat the detection as unknown rather than trust it. A wrong "it's
// already in the target language" guess ships the wrong language straight to a real
// recipient with no review step; the fallback (treat as unknown, translate anyway) costs at
// most one redundant/no-op translation call. Short, ambiguous subjects (common for a quick
// reminder) are exactly the case this guards — Azure's own score drops noticeably on those.
const DETECT_CONFIDENCE_THRESHOLD = 0.5

// Returns the BCP-47/ISO code Azure detects (e.g. "fr", "pt", "en"), or null when detection
// is unavailable (no Azure credentials), fails, or comes back under-confident — callers must
// treat null as "unknown" and fall through to translating anyway, the same safe default this
// feature had before detection existed.
async function azureDetectLanguage(text: string): Promise<string | null> {
  const key    = process.env.AZURE_TRANSLATOR_KEY
  const region = process.env.AZURE_TRANSLATOR_REGION
  const sample = text.trim().slice(0, DETECT_SAMPLE_MAX_CHARS)
  if (!key || !region || !sample) return null

  try {
    const response = await fetch(AZURE_DETECT_ENDPOINT, {
      method:  "POST",
      headers: {
        "Ocp-Apim-Subscription-Key":    key,
        "Ocp-Apim-Subscription-Region": region,
        "Content-Type":                 "application/json",
      },
      body: JSON.stringify([{ text: sample }]),
    })
    if (!response.ok) return null

    const data   = (await response.json()) as { language: string; score: number }[]
    const result = data[0]
    if (!result || result.score < DETECT_CONFIDENCE_THRESHOLD) return null
    return result.language
  } catch {
    return null
  }
}

// Reserved pseudo-locale under which a detected source language is cached in the same
// Translation table real translations use — never a real BCP-47 tag, so it can't collide
// with an actual translation row for the same text.
const DETECTED_LANGUAGE_CACHE_LOCALE = "__detected_lang__"

// Detects the language an admin-composed email was actually written in — plain text only,
// so HTML tags/attributes don't skew the result. Exported so callers that fire one
// translateEmailContent per target locale (bulk-send.ts, automation-processor.ts) can detect
// once up front and pass the result to every call, instead of re-detecting per locale.
// Cached by exact text hash, same as a real translation would be: an AutomationRule's
// template is static between scheduled runs, so without this every run would re-spend an
// Azure /detect call identifying a source language that never changed.
export async function detectEmailSourceLanguage(subject: string, bodyHtml: string): Promise<string | null> {
  const plainBody = bodyHtml.replace(/<[^>]+>/g, " ")
  const sample     = `${subject}\n${plainBody}`.trim()
  if (!sample) return null

  const hash   = hashText(sample)
  const cached = await prisma.translation.findUnique({
    where: { hash_locale: { hash, locale: DETECTED_LANGUAGE_CACHE_LOCALE } },
  })
  if (cached) return cached.translated

  const detected = await azureDetectLanguage(sample)
  if (detected) {
    // Best-effort: a failed cache write still returns the real result to this call, just
    // without saving the next one a round trip.
    await prisma.translation.upsert({
      where:  { hash_locale: { hash, locale: DETECTED_LANGUAGE_CACHE_LOCALE } },
      create: { hash, locale: DETECTED_LANGUAGE_CACHE_LOCALE, translated: detected },
      update: {},
    }).catch(() => {})
  }
  return detected
}

// Compares only the base language (before any "-REGION" suffix) — Azure's detector doesn't
// distinguish "pt" from "pt-PT", so a strict tag match would never recognize a Brazilian
// Portuguese email as already matching a pt-PT recipient (or vice versa).
function sameBaseLanguage(a: string, b: string): boolean {
  return a.split("-")[0].toLowerCase() === b.split("-")[0].toLowerCase()
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
  locale: Locale,
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
    // Anthropic keys are skipped: a reasoning model with no JSON mode inside the timeout
    // budget below would mostly time out and log a spurious failure — Azure serves those directly.
    // Resolving it can itself throw (e.g. a stored BYOK key that fails to decrypt under the
    // current ENCRYPTION_KEY) — caught here so a broken own-AI config falls through to Azure
    // like every other failure in this function, instead of crashing the whole page. This
    // matters more now that translation runs automatically for every non-French visitor
    // rather than only after an explicit "Traduire cette page" click.
    let aiConfig: ResolvedAnyAiConfig | null = null
    try {
      aiConfig = await getCachedAiConfig(associationId)
    } catch (err) {
      reportError(err, { area: "ai", action: "translate.resolve-config", extra: { associationId, locale } })
    }
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
          const chunks       = chunkTexts(missTexts, AI_TRANSLATE_CHUNK_MAX_CHARS)
          const chunkResults = await Promise.all(chunks.map((chunk) => aiTranslate(chunk, locale, aiConfig)))
          translated = chunkResults.flat()
        } catch (err) {
          reportError(err, {
            area:   "ai",
            action: "translate.ai-fallback",
            extra:  { associationId, locale, provider: aiConfig.provider, model: aiConfig.model, textCount: missTexts.length },
          })
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
        // Failures aren't cached, so an Azure outage retries on every public page view —
        // one report per association per hour is enough to see it without burning the quota.
        if (await rateLimit(`translate-azure-fail-report:${associationId}`, 1, 60 * 60_000)) {
          reportError(err, {
            area:   "ai",
            action: "translate.azure",
            extra:  { associationId, locale, textCount: missTexts.length },
          })
        }
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

// Translates the named fields across a list of items in one batched call — pass a
// single-item array to translate one object's fields. A field may be a plain string
// (title, label) or a string array (e.g. CustomField.options, the SELECT/RADIO/CHECKBOX_MULTI
// choice list) — every other shape is left untouched. No-op for the default locale (source
// language) and for null/empty field values — every caller except translateEmailContent
// authors content in French, so DEFAULT_LOCALE as a target never needs translating. Pass
// allowDefaultLocaleTarget when the source language isn't guaranteed to be French (admin-
// composed email content, which can be written in any language).
export async function translateFields<T extends Record<string, unknown>>(
  items: T[],
  keys: (keyof T & string)[],
  locale: Locale,
  associationId: string,
  options?: { allowDefaultLocaleTarget?: boolean },
): Promise<T[]> {
  if ((locale === DEFAULT_LOCALE && !options?.allowDefaultLocaleTarget) || items.length === 0 || keys.length === 0) return items

  const texts = new Set<string>()
  for (const item of items) {
    for (const key of keys) {
      const value = item[key]
      if (typeof value === "string" && value.trim() !== "") {
        texts.add(value)
      } else if (Array.isArray(value)) {
        for (const entry of value) {
          if (typeof entry === "string" && entry.trim() !== "") texts.add(entry)
        }
      }
    }
  }
  if (texts.size === 0) return items

  const uniqueTexts     = [...texts]
  const translated      = await batchTranslate(uniqueTexts, locale, associationId)
  const translationMap  = new Map(uniqueTexts.map((t, i) => [t, translated[i]]))

  return items.map((item) => {
    const clone = { ...item }
    for (const key of keys) {
      const value = item[key]
      if (typeof value === "string" && translationMap.has(value)) {
        clone[key] = translationMap.get(value) as T[typeof key]
      } else if (Array.isArray(value)) {
        clone[key] = value.map((entry) =>
          typeof entry === "string" && translationMap.has(entry) ? translationMap.get(entry) : entry,
        ) as T[typeof key]
      }
    }
    return clone
  })
}

// Same {{word}} syntax as substituteVars in src/lib/automation.ts — duplicated (not
// imported) because that module pulls in the Prisma runtime via its callers' expectations
// and this one is meant to stay a small, self-contained i18n unit.
const VAR_TOKEN_PATTERN = /\{\{(\w+)\}\}/g

// Unnatural-looking "word" (no spaces, no punctuation) so both the AI prompt-based path and
// Azure's NMT engine copy it through untranslated rather than trying to render it as language
// — unlike wrapping the token's own name (e.g. "prenom"), which is a real French word an NMT
// engine can and does translate on its own.
const varPlaceholder = (index: number): string => `xvar${index}zqx`

function protectVarTokens(text: string): { text: string; tokens: string[] } {
  const tokens: string[] = []
  const protectedText = text.replace(VAR_TOKEN_PATTERN, (match) => {
    tokens.push(match)
    return varPlaceholder(tokens.length - 1)
  })
  return { text: protectedText, tokens }
}

// Fails closed: if a placeholder didn't survive translation as exactly one occurrence —
// dropped, split, or duplicated by the model (seen in practice with repetition-prone NMT/LLM
// output) — allRestored is false and the caller must not use this text — a merge-tag member
// email, or one with a stray "xvar0zqx" literally visible, is worse than an untranslated one.
function restoreVarTokens(text: string, tokens: string[]): { text: string; allRestored: boolean } {
  let result = text
  let allRestored = true
  tokens.forEach((token, index) => {
    const placeholder = varPlaceholder(index)
    const occurrences = result.split(placeholder).length - 1
    if (occurrences !== 1) { allRestored = false; return }
    result = result.replace(placeholder, token)
  })
  return { text: result, allRestored }
}

export type EmailTranslationResult = {
  subject:         string
  bodyHtml:        string
  // False covers two different situations — see `skipped` to tell them apart. subject/
  // bodyHtml are the untranslated originals either way.
  translated:      boolean
  // True when no translation was attempted because the detected source language already
  // matches the target locale (the expected, common case — nothing to review). False
  // alongside translated:false means a translation WAS attempted and failed (Azure/AI down,
  // or a {{var}} token got mangled) — same fail-safe fallback convention as translateFields.
  skipped:         boolean
}

// Admin-authored email content (SendEmailModal, MessageTemplate) has {{prenom}}-style merge
// tags that translateFields' plain string translation doesn't know to protect — this wraps
// it with the token-preservation + fail-safe-to-original guarantee those callers need.
//
// Unlike translateFields' other callers, the source language here isn't assumed to be
// French — the admin can write the email in any supported language. sourceLanguage lets a
// caller that's about to fire this once per distinct target locale (bulk-send.ts,
// automation-processor.ts) detect it a single time and pass the result to every call; leave
// it undefined to have this function detect it itself (e.g. the single-locale preview route).
export async function translateEmailContent(
  subject: string,
  bodyHtml: string,
  locale: Locale,
  associationId: string,
  sourceLanguage?: string | null,
): Promise<EmailTranslationResult> {
  const detectedLanguage = sourceLanguage !== undefined ? sourceLanguage : await detectEmailSourceLanguage(subject, bodyHtml)
  if (detectedLanguage && sameBaseLanguage(detectedLanguage, locale)) {
    return { subject, bodyHtml, translated: false, skipped: true }
  }

  const subjectProtected = protectVarTokens(subject)
  const bodyProtected    = protectVarTokens(bodyHtml)

  const [result] = await translateFields(
    [{ subject: subjectProtected.text, bodyHtml: bodyProtected.text }],
    ["subject", "bodyHtml"],
    locale,
    associationId,
    { allowDefaultLocaleTarget: true },
  )

  const subjectRestored = restoreVarTokens(result.subject, subjectProtected.tokens)
  const bodyRestored    = restoreVarTokens(result.bodyHtml, bodyProtected.tokens)

  // Azure/AI silently returning the source text unchanged (its own failure fallback) also
  // lands here as translated:false, which is correct — nothing was actually translated.
  const changed = result.subject !== subjectProtected.text || result.bodyHtml !== bodyProtected.text
  if (!changed || !subjectRestored.allRestored || !bodyRestored.allRestored) {
    return { subject, bodyHtml, translated: false, skipped: false }
  }

  return { subject: subjectRestored.text, bodyHtml: bodyRestored.text, translated: true, skipped: false }
}
