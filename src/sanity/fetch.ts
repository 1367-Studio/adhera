import type { QueryParams } from "@sanity/client"
import { sanityClient } from "@/sanity/client"

type SanityFetchOptions = {
  query:   string
  params?: QueryParams
  // Next data-cache tags. Always the Sanity `_type` names (plus "_type:slug" / "_type:kind"),
  // the exact strings the Sanity webhook sends to /api/revalidate, so an editor publishing in
  // the Studio invalidates precisely the reads that showed that document.
  tags:    string[]
}

// Cached read: kept in Next's data cache indefinitely (`revalidate: false`) and only ever
// refreshed by `revalidateTag()` from the Sanity webhook.
export function sanityFetch<Result>({ query, params = {}, tags }: SanityFetchOptions): Promise<Result> {
  return sanityClient.fetch<Result>(query, params, { next: { revalidate: false, tags } })
}

// Uncached read for search + AI retrieval: every call is a distinct user query, so Next's
// cache would never get a useful hit.
export function sanityFetchUncached<Result>({ query, params = {} }: Omit<SanityFetchOptions, "tags">): Promise<Result> {
  return sanityClient.fetch<Result>(query, params, { cache: "no-store" })
}
