import { createClient } from "@sanity/client"

// Public identifiers of the help-center CMS — the env vars exist so a staging dataset can be
// pointed at without a code change, not because these values are secret (the dataset is
// public and read-only from here).
export const SANITY_PROJECT_ID  = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "uxyclro2"
export const SANITY_DATASET     = process.env.NEXT_PUBLIC_SANITY_DATASET    || "production"
export const SANITY_API_VERSION = "2026-09-11"

// Optional: only ever set if the dataset is made private one day.
const readToken = process.env.SANITY_API_READ_TOKEN || undefined

// Single client, live query API (`useCdn: false`) on purpose: content reads are cached by
// Next's data cache and invalidated by tag from /api/revalidate (src/sanity/fetch.ts), so the
// API CDN would add nothing but its eventual-consistency window — the read fired right after
// a publish must see the published document, or the stale one gets cached again. Search and
// AI retrieval hit the live engine anyway (`text::semanticSimilarity()`).
export const sanityClient = createClient({
  projectId:   SANITY_PROJECT_ID,
  dataset:     SANITY_DATASET,
  apiVersion:  SANITY_API_VERSION,
  useCdn:      false,
  perspective: "published",
  token:       readToken,
})
