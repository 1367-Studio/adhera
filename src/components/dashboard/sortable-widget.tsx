"use client"

import { useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DotsSixIcon, ArrowsOutSimpleIcon } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import { MAX_WIDGET_W, MAX_WIDGET_H } from "@/lib/dashboard-widgets"

// Static class maps rather than `col-span-${w}` — Tailwind only emits classes it can find
// as literal strings, so an interpolated name silently produces no CSS at all. They also
// carry the responsive story a bare span number can't: below sm the grid is a single
// column and every widget is full width, at sm it's two columns so nothing may exceed 2,
// and only at lg does the chosen width apply as-is.
const COL_SPAN: Record<number, string> = {
  1: "col-span-1",
  2: "col-span-1 sm:col-span-2",
  3: "col-span-1 sm:col-span-2 lg:col-span-3",
  4: "col-span-1 sm:col-span-2 lg:col-span-4",
}

const ROW_SPAN: Record<number, string> = {
  1: "row-span-1",
  2: "row-span-2",
  3: "row-span-3",
  4: "row-span-4",
}

function clamp(value: number, max: number) {
  return Math.min(Math.max(value, 1), max)
}

interface Props {
  id:          string
  w:           number
  h:           number
  editMode:    boolean
  dragHint:    string
  resizeHint:  string
  onResize:    (size: { w: number; h: number }) => void
  children:    ReactNode
}

// Generic drag wrapper for every dashboard widget — dnd-kit plumbing lives here once
// instead of being copy-pasted onto each widget, and edit mode's resize grip rides along
// so no widget has to know it can be resized.
export function SortableWidget({ id, w, h, editMode, dragHint, resizeHint, onResize, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editMode,
  })

  // Second ref alongside dnd-kit's: resizing needs to measure the live grid (column width,
  // gap, row height) and dnd-kit only hands back a setter, not the node.
  const nodeRef = useRef<HTMLDivElement | null>(null)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  // Reads the geometry off the grid itself rather than hardcoding it, so the drag stays
  // truthful if the column count, the gap or the row unit ever change — and so it follows
  // the breakpoint the user is actually on.
  function gridMetrics() {
    const grid = nodeRef.current?.parentElement
    if (!grid) return null
    const cs   = getComputedStyle(grid)
    const cols = cs.gridTemplateColumns.split(" ").filter(Boolean).length
    const gap  = parseFloat(cs.columnGap) || 0
    const rowGap = parseFloat(cs.rowGap) || gap
    const colW = (grid.getBoundingClientRect().width - gap * (cols - 1)) / cols
    const rowH = parseFloat(cs.gridAutoRows) || 0
    if (!colW || !rowH) return null
    return { cols, gap, rowGap, colW, rowH }
  }

  function handleResizeStart(e: ReactPointerEvent<HTMLButtonElement>) {
    // Keeps the grip out of dnd-kit's way and stops the browser turning the drag into a
    // text selection.
    e.preventDefault()
    e.stopPropagation()

    const metrics = gridMetrics()
    if (!metrics) return
    const { cols, gap, rowGap, colW, rowH } = metrics

    const startX = e.clientX
    const startY = e.clientY
    const startW = w
    const startH = h
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)

    let last = { w: startW, h: startH }

    function onMove(ev: PointerEvent) {
      // Distance dragged, converted into whole cells — the card itself re-renders at the new
      // size on every step, so the live card *is* the preview; there's no ghost to keep in
      // sync with it.
      const nextW = clamp(startW + Math.round((ev.clientX - startX) / (colW + gap)), Math.min(MAX_WIDGET_W, cols))
      const nextH = clamp(startH + Math.round((ev.clientY - startY) / (rowH + rowGap)), MAX_WIDGET_H)
      if (nextW === last.w && nextH === last.h) return
      last = { w: nextW, h: nextH }
      onResize(last)
    }

    function onUp() {
      handle.removeEventListener("pointermove", onMove)
      handle.removeEventListener("pointerup", onUp)
      handle.removeEventListener("pointercancel", onUp)
    }

    handle.addEventListener("pointermove", onMove)
    handle.addEventListener("pointerup", onUp)
    handle.addEventListener("pointercancel", onUp)
  }

  // A grip you can only drag would put resizing out of reach of anyone not using a mouse.
  // The same control answers the arrow keys, so the feature stays operable from the
  // keyboard without adding a second visible control to all twelve cards.
  function handleResizeKey(e: ReactKeyboardEvent<HTMLButtonElement>) {
    const cols = gridMetrics()?.cols ?? MAX_WIDGET_W
    const maxW = Math.min(MAX_WIDGET_W, cols)
    if (e.key === "ArrowRight")      onResize({ w: clamp(w + 1, maxW), h })
    else if (e.key === "ArrowLeft")  onResize({ w: clamp(w - 1, maxW), h })
    else if (e.key === "ArrowDown")  onResize({ w, h: clamp(h + 1, MAX_WIDGET_H) })
    else if (e.key === "ArrowUp")    onResize({ w, h: clamp(h - 1, MAX_WIDGET_H) })
    else return
    e.preventDefault()
  }

  return (
    <div
      ref={node => { nodeRef.current = node; setNodeRef(node) }}
      style={style}
      className={cn(
        COL_SPAN[w] ?? COL_SPAN[1],
        ROW_SPAN[h] ?? ROW_SPAN[1],
        "relative min-h-0",
        editMode && "rounded-xl ring-1 ring-dashed ring-border",
        isDragging && "opacity-40",
      )}
    >
      {editMode && (
        <button
          type="button"
          aria-label={dragHint}
          title={dragHint}
          {...attributes}
          {...listeners}
          className="absolute right-2 top-2 z-10 flex size-6 cursor-grab items-center justify-center rounded-md bg-background/80 text-muted-foreground backdrop-blur-sm outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
        >
          <DotsSixIcon className="size-4" weight="bold" />
        </button>
      )}

      {editMode && (
        // Hidden below lg on purpose: under that breakpoint the grid collapses to one or two
        // columns and every card is forced full width anyway, so a width dragged on a phone
        // would show no effect there while quietly rewriting the desktop layout.
        <button
          type="button"
          aria-label={resizeHint}
          title={resizeHint}
          onPointerDown={handleResizeStart}
          onKeyDown={handleResizeKey}
          className="absolute bottom-1.5 right-1.5 z-10 hidden size-6 cursor-nwse-resize items-center justify-center rounded-md bg-background/80 text-muted-foreground backdrop-blur-sm outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 lg:flex"
        >
          <ArrowsOutSimpleIcon className="size-3.5 -rotate-90" weight="bold" />
        </button>
      )}

      {/* `inert` (not just pointer-events-none) so edit mode also pulls each widget's own
          interactive elements (e.g. a stat tile's <Link>) out of the tab order and
          accessibility tree — pointer-events-none alone only stops mouse/touch, a
          keyboard or screen-reader user could still Tab into and activate them.
          `[&>*]:h-full` stretches whatever the widget renders to the box the grid gave it,
          without every card component needing its own h-full — a genuine layout
          requirement of the fixed-row grid, not decoration. */}
      <div inert={editMode} className="h-full overflow-hidden [&>*]:h-full">
        {children}
      </div>
    </div>
  )
}
