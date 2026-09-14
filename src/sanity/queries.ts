import { defineQuery } from "groq"

// Field-level localisation (sanity-plugin-internationalized-array v5): every localised field
// is stored as [{ _key: <random>, language: "<locale>", value }]. Always filter on
// `language` — `_key` is a random key, never the locale. Requested `$locale`, French fallback.
const LOCALIZED_TITLE    = `coalesce(title[language == $locale][0].value, title[language == "fr"][0].value)`
const LOCALIZED_SUMMARY  = `coalesce(summary[language == $locale][0].value, summary[language == "fr"][0].value)`
const LOCALIZED_BODY     = `coalesce(body[language == $locale][0].value, body[language == "fr"][0].value)`
const LOCALIZED_QUESTION = `coalesce(question[language == $locale][0].value, question[language == "fr"][0].value)`
const LOCALIZED_ANSWER   = `coalesce(answer[language == $locale][0].value, answer[language == "fr"][0].value)`

// helpArticle carries title/body, faqEntry carries question/answer — one expression for each
// that resolves whichever the document has, for the projections shared by both types.
const LOCALIZED_HEADING   = `select(_type == "helpArticle" => ${LOCALIZED_TITLE}, ${LOCALIZED_QUESTION})`
const LOCALIZED_RICH_TEXT = `coalesce(${LOCALIZED_BODY}, ${LOCALIZED_ANSWER})`

// Articles of one module + the FAQ entries shown on it (module-specific, plus the ones with
// no module or "general", which are shown everywhere). $module, $locale.
export const HELP_MODULE_CONTENT_QUERY = defineQuery(`{
  "articles": *[_type == "helpArticle" && module == $module]
    | order(coalesce(order, 100) asc, _createdAt asc) {
      "id": _id,
      "slug": slug.current,
      "title": ${LOCALIZED_TITLE},
      "summary": ${LOCALIZED_SUMMARY},
      module,
      "order": coalesce(order, 100)
    },
  "faq": *[_type == "faqEntry" && (module == $module || !defined(module) || module == "general")]
    | order(coalesce(order, 100) asc, _createdAt asc) {
      "id": _id,
      "question": ${LOCALIZED_QUESTION},
      "answer": coalesce(${LOCALIZED_ANSWER}, []),
      module
    }
}`)

// $slug, $locale.
export const HELP_ARTICLE_BY_SLUG_QUERY = defineQuery(`*[_type == "helpArticle" && slug.current == $slug][0] {
  "id": _id,
  "slug": slug.current,
  "title": ${LOCALIZED_TITLE},
  "summary": ${LOCALIZED_SUMMARY},
  module,
  "body": coalesce(${LOCALIZED_BODY}, []),
  "updatedAt": _updatedAt
}`)

// Latest 20 entries, newest first. $locale.
export const HELP_CHANGELOG_QUERY = defineQuery(`*[_type == "changelogEntry" && defined(publishedAt)]
  | order(publishedAt desc, _createdAt desc) [0...20] {
    "id": _id,
    "title": ${LOCALIZED_TITLE},
    publishedAt,
    kind,
    "modules": coalesce(modules, []),
    "body": ${LOCALIZED_BODY}
  }`)

// Search / AI retrieval share one result shape: `text` is the flattened localised body or
// answer (the search snippet and the AI passage are both cut from it in JS — GROQ has no
// substring function) and `score` is the score() total.
// Params: $q, $locale, $limit, $module (null when there is no current module — it is only a
// small boost, never a filter).
const HELP_SEARCH_PROJECTION = `{
  "id": _id,
  "type": _type,
  "title": ${LOCALIZED_HEADING},
  "slug": slug.current,
  module,
  "text": pt::text(${LOCALIZED_RICH_TEXT}),
  "score": _score
}`

// score() only accepts plain attribute paths on the left of `match` (no coalesce()/pt::text()
// calls), so the keyword terms walk the raw localised arrays across every language — a query
// typed in English still hits an English translation.
const HELP_SEARCH_KEYWORD_SCORES = `
    boost(title[].value match text::query($q), 1),
    boost(question[].value match text::query($q), 1),
    boost(summary[].value match text::query($q), 0.5),
    boost(keywords match text::query($q), 0.5),
    boost(body[].value[].children[].text match text::query($q), 0.5),
    boost(answer[].value[].children[].text match text::query($q), 0.5),
    boost(defined($module) && module == $module, 0.25)`

// Hybrid ranking: keyword boosts + dataset-embeddings semantic similarity. The semantic
// function is only valid inside score() and errors if embeddings are not enabled on the
// dataset — src/lib/help/retrieval.ts falls back to HELP_SEARCH_KEYWORD_QUERY then.
export const HELP_SEARCH_QUERY = defineQuery(`*[_type in ["helpArticle", "faqEntry"]]
  | score(${HELP_SEARCH_KEYWORD_SCORES},
    text::semanticSimilarity($q)
  )
  | order(_score desc) [0...$limit] ${HELP_SEARCH_PROJECTION}`)

// Keyword-only fallback: same boosts, no semantic term, so rows that match nothing (score 0)
// are dropped instead of being returned as noise.
export const HELP_SEARCH_KEYWORD_QUERY = defineQuery(`*[_type in ["helpArticle", "faqEntry"]]
  | score(${HELP_SEARCH_KEYWORD_SCORES}
  )
  | order(_score desc) [_score > 0] [0...$limit] ${HELP_SEARCH_PROJECTION}`)
