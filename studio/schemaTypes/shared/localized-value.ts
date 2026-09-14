import { DEFAULT_LANGUAGE_ID } from "../../locales"

// sanity-plugin-internationalized-array v5: the language lives in `language`; `_key` is random.
// (`_key` is still checked so v4-shaped seed data keeps resolving.)
type LocalizedEntry<Value> = { _key?: string; language?: string; value?: Value }

// Reads the French entry of an internationalized array (title, question, ...),
// falling back to the first entry. Used by document previews and the slug source.
export function pickDefaultLanguageValue<Value>(entries: unknown): Value | undefined {
  if (!Array.isArray(entries)) return undefined
  const localizedEntries = entries as Array<LocalizedEntry<Value>>
  const defaultLanguageEntry = localizedEntries.find(
    (entry) => entry.language === DEFAULT_LANGUAGE_ID || (!entry.language && entry._key === DEFAULT_LANGUAGE_ID),
  )
  return (defaultLanguageEntry ?? localizedEntries[0])?.value
}
