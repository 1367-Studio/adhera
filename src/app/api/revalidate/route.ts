import { revalidateTag } from "next/cache"
import { NextResponse } from "next/server"
import { SIGNATURE_HEADER_NAME, isValidSignature } from "@sanity/webhook"

export const dynamic = "force-dynamic"

// Called by the Sanity webhook on every publish/unpublish of help-center content. Its
// projection is { "tags": [_type, _type + ":" + coalesce(slug.current, kind)] } — exactly
// the tags src/sanity/fetch.ts reads are cached under, so nothing here maps or guesses.
type RevalidateWebhookBody = { tags?: unknown }

// "_type" or "_type:slug-or-kind" — anything else did not come from that projection.
const TAG_PATTERN = /^[a-zA-Z]+(?::[a-zA-Z0-9-]+)?$/
const MAX_TAGS    = 20

function tagsFrom(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return []
  const { tags } = body as RevalidateWebhookBody
  if (!Array.isArray(tags)) return []
  return tags
    .filter((tag): tag is string => typeof tag === "string" && TAG_PATTERN.test(tag))
    .slice(0, MAX_TAGS)
}

export async function POST(req: Request) {
  const secret = process.env.SANITY_REVALIDATE_SECRET
  if (!secret) {
    console.error("[revalidate] SANITY_REVALIDATE_SECRET is not set — Sanity webhook calls are rejected until it is.")
    return NextResponse.json({ error: "Revalidation non configurée" }, { status: 500 })
  }

  // The signature covers the raw bytes — verify the text exactly as received, never a
  // re-serialised JSON.parse() round-trip of it.
  const signature = req.headers.get(SIGNATURE_HEADER_NAME)
  const rawBody   = await req.text()
  if (!signature || !(await isValidSignature(rawBody, signature, secret))) {
    return NextResponse.json({ error: "Signature invalide" }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 })
  }

  const tags = tagsFrom(body)
  if (tags.length === 0) return NextResponse.json({ error: "Aucun tag à revalider" }, { status: 400 })

  // No settle delay: src/sanity/client.ts reads the live API, not the eventually-consistent
  // CDN, so the next fetch after this invalidation sees the published document.
  // Next 16: the second argument is required; "max" is the on-demand invalidation profile.
  for (const tag of tags) revalidateTag(tag, "max")

  return NextResponse.json({ revalidated: true, tags, now: Date.now() })
}
