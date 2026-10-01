import type { SitePuckData, SitePuckRootProps } from "@/lib/site-puck/site-puck-data"

// Reads Association.sitePuckPublished (the page published from the new builder) for the public
// site. It is stored JSON: anything that is not a usable Puck page returns null, and the caller
// falls back to the old builder's rendering — a broken publish must never take a site down.
// Server-safe: no editor config imported.

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isRenderableBlock(value: unknown): boolean {
  return isPlainObject(value) && typeof value.type === "string" && isPlainObject(value.props)
}

/** The published page, or null when missing or malformed. */
export function readPublishedPuckData(storedValue: unknown): SitePuckData | null {
  if (!isPlainObject(storedValue)) return null
  const { content, root, zones } = storedValue
  if (!Array.isArray(content) || !content.every(isRenderableBlock)) return null

  const rootProps = isPlainObject(root) && isPlainObject(root.props) ? root.props : {}
  const publishedData: Record<string, unknown> = { content, root: { props: rootProps } }
  if (isPlainObject(zones)) {
    const zonesAreValid = Object.values(zones).every(
      zoneBlocks => Array.isArray(zoneBlocks) && zoneBlocks.every(isRenderableBlock),
    )
    if (!zonesAreValid) return null
    publishedData.zones = zones
  }
  return publishedData as SitePuckData
}

/** Site-wide settings (theme, header, footer, SEO) of the published page. */
export function publishedRootProps(publishedData: SitePuckData): SitePuckRootProps {
  return (publishedData.root.props ?? {}) as SitePuckRootProps
}
