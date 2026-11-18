// Backs the "version" recorded alongside a legal-document acceptance with the real, live
// publish date on formwise-latest (Sanity) instead of a string a developer has to remember to
// bump by hand whenever the wording changes. Cached for an hour (Next's fetch cache) so a
// signup never waits on a live Sanity round-trip, and falls back to the last known-good
// version if Sanity is briefly unreachable rather than failing account creation over it.
const SANITY_PROJECT_ID = "8c0ffzyk"
const SANITY_DATASET     = "production"
const SANITY_API_VERSION = "2026-10-05"

// Sanity's _updatedAt only moves on publish (draft edits in progress don't count), and
// querying by these published-document ids already excludes drafts (which live under a
// different `drafts.<id>` id) — no explicit perspective needed.
export async function latestSanityUpdateVersion(documentIds: readonly string[], fallback: string): Promise<string> {
  const query = `*[_id in $ids]|order(_updatedAt desc)[0]._updatedAt`
  const url = `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data/query/${SANITY_DATASET}` +
    `?query=${encodeURIComponent(query)}&$ids=${encodeURIComponent(JSON.stringify(documentIds))}`

  try {
    const res = await fetch(url, { next: { revalidate: 3600 } })
    if (!res.ok) return fallback
    const { result } = (await res.json()) as { result?: string }
    // Trimmed to the date — matches the existing "YYYY-MM-DD" version-string convention,
    // and avoids recording a new "version" every time a typo gets fixed within the same day.
    return typeof result === "string" ? result.slice(0, 10) : fallback
  } catch {
    return fallback
  }
}
