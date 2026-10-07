import { translateFields } from "@/lib/i18n/translate"
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales"
import type { SitePuckData, SitePuckRootProps } from "@/lib/site-puck/site-puck-data"

// Translates the text an association typed into its Puck-built site (FORM-7) into a visitor's
// chosen locale, on top of the same BYOK-then-Azure pipeline and Translation cache already used
// for events/forms/emails (src/lib/i18n/translate.ts) — nothing new to provision or cache here.

type AnyPuckBlock = { type: string; props: Record<string, unknown> }

type BlockFieldMap = {
  // Top-level string props of the block to translate.
  flat?:   string[]
  // Array props of the block (e.g. "buttons", "items"): translated item by item.
  arrays?: Record<string, string[]>
}

// Which block props carry association-authored text, keyed by the same component name as
// sitePuckConfig.components (site-puck-config.tsx). A block with no entry here is passed
// through untouched: either a pure layout block (section, columns, spacer, map, socialLinks,
// video's url) or one where every string is a name/address/URL that must stay as typed —
// team/partners/testimonials member names, contact details, links.
const BLOCK_TRANSLATABLE_FIELDS: Record<string, BlockFieldMap> = {
  heading:      { flat: ["text"] },
  text:         { flat: ["content"] },
  image:        { flat: ["alt", "caption"] },
  buttons:      { arrays: { buttons: ["label"] } },
  video:        { flat: ["title"] },
  mediaText:    { flat: ["title", "imageAlt", "body"], arrays: { buttons: ["label"] } },
  banner:       { flat: ["eyebrow", "title", "subtitle"], arrays: { buttons: ["label"] } },
  ctaBanner:    { flat: ["title", "text"], arrays: { buttons: ["label"] } },
  stats:        { flat: ["title", "intro"], arrays: { items: ["label"] } },
  features:     { flat: ["title", "intro"], arrays: { items: ["title", "text"] } },
  testimonials: { flat: ["title"], arrays: { items: ["quote", "role"] } },
  team:         { flat: ["title", "intro"], arrays: { members: ["role"] } },
  faq:          { flat: ["title", "intro"], arrays: { items: ["question", "answer"] } },
  contactInfo:  { flat: ["title", "intro", "hours"] },
  partners:     { flat: ["title"] },
  gallery:      { flat: ["title"], arrays: { images: ["alt", "caption"] } },
  // Legacy sections (old builder blocks still renderable from the new one).
  hero:         { flat: ["title", "subtitle"] },
  about:        { flat: ["title", "content"] },
  events:       { flat: ["title", "intro"] },
  actualites:   { flat: ["title", "intro"] },
  boutique:     { flat: ["title", "intro"] },
  membership:   { flat: ["title", "body"] },
  dons:         { flat: ["title", "body", "buttonLabel"] },
  contact:      { flat: ["title"] },
}

// Union of every flat/array-item key named above, each computed once at module load. A page
// is translated in one translateFields call per shape (flat props, then array items) across
// *every* block, rather than one call per block: translateFields's own keys lookup silently
// skips a key a given item doesn't have, so sharing one wide key list across heterogeneous
// blocks is safe. Splitting it per block instead would multiply calls with the block count —
// each one spending from the association's own-AI rate limit (AI_TRANSLATE_RATE_LIMIT_MAX,
// 30/hour, in translate.ts) — and a long page would start losing blocks to the Azure fallback,
// or to silently-kept-original text, partway down.
const ALL_FLAT_KEYS       = [...new Set(Object.values(BLOCK_TRANSLATABLE_FIELDS).flatMap(fieldMap => fieldMap.flat ?? []))]
const ALL_ARRAY_ITEM_KEYS = [...new Set(
  Object.values(BLOCK_TRANSLATABLE_FIELDS).flatMap(fieldMap => Object.values(fieldMap.arrays ?? {}).flat()),
)]

async function translateRoot(
  root: SitePuckData["root"],
  locale: Locale,
  associationId: string,
): Promise<SitePuckData["root"]> {
  const rootProps = root.props as SitePuckRootProps | undefined
  if (!rootProps?.seo || (!rootProps.seo.title && !rootProps.seo.description)) return root
  const [seo] = await translateFields([rootProps.seo], ["title", "description"], locale, associationId)
  return { ...root, props: { ...rootProps, seo } }
}

// Translates only the SEO title/description of a published Puck page — for generateMetadata,
// which never renders the page's blocks, so translating them too would double the Translation
// cache reads (and any BYOK/Azure calls on a cache miss) on every single non-French page view,
// once here and once more in the page component itself.
export async function translateSitePuckSeo(
  data: SitePuckData,
  locale: Locale,
  associationId: string,
): Promise<SitePuckData> {
  if (locale === DEFAULT_LOCALE) return data
  return { ...data, root: await translateRoot(data.root, locale, associationId) }
}

// Translates every association-authored string in a published Puck page — block content and
// SEO title/description — into `locale`. No-op for the source language (French). Never throws
// on a translation failure: translateFields already falls back to the original text on its own.
export async function translateSitePuckData(
  data: SitePuckData,
  locale: Locale,
  associationId: string,
): Promise<SitePuckData> {
  if (locale === DEFAULT_LOCALE) return data

  // One clone per block (content + every zone), shared by reference between `content`/`zones`
  // below and the two translation passes, so writing a pass's result back onto a block updates
  // both at once.
  const contentBlocks = (data.content as unknown as AnyPuckBlock[]).map(block => ({ ...block }))
  const zoneEntries   = data.zones
    ? Object.entries(data.zones).map(([zoneKey, zoneBlocks]) =>
        [zoneKey, (zoneBlocks as unknown as AnyPuckBlock[]).map(block => ({ ...block }))] as const)
    : []
  const allBlocks = [...contentBlocks, ...zoneEntries.flatMap(([, blocks]) => blocks)]

  // Pass 1: every block's own flat string fields, batched into one call.
  const flatBlocks = allBlocks.filter(block => BLOCK_TRANSLATABLE_FIELDS[block.type]?.flat?.length)
  if (flatBlocks.length > 0) {
    const translatedProps = await translateFields(flatBlocks.map(block => block.props), ALL_FLAT_KEYS, locale, associationId)
    flatBlocks.forEach((block, i) => { block.props = translatedProps[i] })
  }

  // Pass 2: every array item (buttons, FAQ questions, team roles…) across every block, also
  // batched into one call — `arrayJobs` remembers where each item came from, to scatter the
  // translated items back into the right block's array afterwards.
  const arrayJobs: { block: AnyPuckBlock; arrayKey: string; start: number; length: number }[] = []
  const allArrayItems: Record<string, unknown>[] = []
  for (const block of allBlocks) {
    const arrayFields = BLOCK_TRANSLATABLE_FIELDS[block.type]?.arrays
    if (!arrayFields) continue
    for (const arrayKey of Object.keys(arrayFields)) {
      const items = block.props[arrayKey]
      if (Array.isArray(items) && items.length > 0) {
        arrayJobs.push({ block, arrayKey, start: allArrayItems.length, length: items.length })
        allArrayItems.push(...(items as Record<string, unknown>[]))
      }
    }
  }
  if (allArrayItems.length > 0) {
    const translatedItems = await translateFields(allArrayItems, ALL_ARRAY_ITEM_KEYS, locale, associationId)
    for (const job of arrayJobs) {
      job.block.props = { ...job.block.props, [job.arrayKey]: translatedItems.slice(job.start, job.start + job.length) }
    }
  }

  const content = contentBlocks as unknown as SitePuckData["content"]
  const zones   = data.zones
    ? Object.fromEntries(zoneEntries.map(([zoneKey, blocks]) => [zoneKey, blocks])) as SitePuckData["zones"]
    : undefined

  const root = await translateCookieMessage(
    await translateRoot(data.root, locale, associationId), locale, associationId,
  )

  return { ...data, content, zones, root } as SitePuckData
}

// The association's own custom cookie-banner message (rootProps.cookies.message) is
// association-authored text like any block field, just stored outside content/zones — kept
// out of translateSitePuckSeo (generateMetadata never shows the cookie banner, so translating
// it there would be wasted BYOK/Azure spend on every non-French page view).
async function translateCookieMessage(
  root: SitePuckData["root"],
  locale: Locale,
  associationId: string,
): Promise<SitePuckData["root"]> {
  const rootProps = root.props as SitePuckRootProps | undefined
  const message    = rootProps?.cookies?.message?.trim()
  if (!message) return root
  const [cookies] = await translateFields([{ message }], ["message"], locale, associationId)
  return { ...root, props: { ...rootProps!, cookies: { ...rootProps!.cookies, message: cookies.message } } }
}
