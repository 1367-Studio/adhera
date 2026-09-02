import crypto from "crypto"
import { prisma } from "@/lib/prisma/client"
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales"

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

// Hash-keyed cache: identical text (even across associations) is translated once per
// locale and reused until the source text changes (new text → new hash → cache miss).
async function batchTranslate(texts: string[], locale: Exclude<Locale, typeof DEFAULT_LOCALE>): Promise<string[]> {
  const hashes = texts.map(hashText)

  const cached   = await prisma.translation.findMany({ where: { locale, hash: { in: hashes } } })
  const cacheMap = new Map(cached.map((r) => [r.hash, r.translated]))

  const misses = texts
    .map((text, i) => ({ text, hash: hashes[i], index: i }))
    .filter((item) => !cacheMap.has(item.hash))

  const results: string[] = texts.map((_, i) => cacheMap.get(hashes[i]) ?? "")

  if (misses.length > 0) {
    try {
      // Azure supports up to 1000 strings per request — all misses in one call.
      const translated = await azureTranslate(misses.map((m) => m.text), azureTag(locale))

      await prisma.translation.createMany({
        data: misses.map((m, i) => ({ hash: m.hash, locale, translated: translated[i] })),
        skipDuplicates: true,
      })

      for (let i = 0; i < misses.length; i++) results[misses[i].index] = translated[i]
    } catch (err) {
      console.error("[translate] Azure call failed, falling back to original text:", err)
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
  const translated      = await batchTranslate(uniqueTexts, locale as Exclude<Locale, typeof DEFAULT_LOCALE>)
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
