// Walks every block of a Puck page — top-level content, blocks nested in slot fields (Section,
// Colonnes) and legacy zones — without importing the editor config, so server code (public page,
// API routes) can use it. Puck data is stored JSON: everything is checked, nothing assumed.

export type PuckBlock = { type: string; props: Record<string, unknown> & { id?: unknown } }

function isPuckBlock(value: unknown): value is PuckBlock {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as { type?: unknown; props?: unknown }
  return typeof candidate.type === "string" && typeof candidate.props === "object" && candidate.props !== null
}

function isPuckBlockList(value: unknown): value is PuckBlock[] {
  return Array.isArray(value) && value.length > 0 && value.every(isPuckBlock)
}

function collectBlocks(blocks: unknown, collected: PuckBlock[]) {
  if (!Array.isArray(blocks)) return
  for (const block of blocks) {
    if (!isPuckBlock(block)) continue
    collected.push(block)
    // Slot fields hold nested block lists directly in the props.
    for (const propValue of Object.values(block.props)) {
      if (isPuckBlockList(propValue)) collectBlocks(propValue, collected)
    }
  }
}

/** Every block of the page, depth-first, in reading order. */
export function listPuckBlocks(puckData: unknown): PuckBlock[] {
  if (typeof puckData !== "object" || puckData === null) return []
  const page = puckData as { content?: unknown; zones?: unknown }
  const collected: PuckBlock[] = []
  collectBlocks(page.content, collected)
  if (typeof page.zones === "object" && page.zones !== null) {
    for (const zoneBlocks of Object.values(page.zones)) collectBlocks(zoneBlocks, collected)
  }
  return collected
}

/** The id of a block (its Puck item id), or null when malformed. */
export function puckBlockId(block: PuckBlock): string | null {
  return typeof block.props.id === "string" && block.props.id !== "" ? block.props.id : null
}

/** Blocks of one type, e.g. "membership" or "dons" — the ones forms can be attached to. */
export function listPuckBlocksOfType(puckData: unknown, blockType: string): PuckBlock[] {
  return listPuckBlocks(puckData).filter(block => block.type === blockType)
}

/** Ids of every block of the page. */
export function collectPuckBlockIds(puckData: unknown): Set<string> {
  const blockIds = new Set<string>()
  for (const block of listPuckBlocks(puckData)) {
    const blockId = puckBlockId(block)
    if (blockId) blockIds.add(blockId)
  }
  return blockIds
}
