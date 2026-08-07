"use client"

import type { ReactNode } from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DotsSixIcon } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"

interface Props {
  id:       string
  span:     string
  editMode: boolean
  dragHint: string
  children: ReactNode
}

// Generic drag wrapper for every dashboard widget — dnd-kit plumbing lives here once
// instead of being copy-pasted onto each widget. `pointer-events-none` on the content
// wrapper (edit mode only) neutralizes each widget's own interactive elements (e.g. a
// stat tile's <Link>) without any widget needing to know about edit mode itself — the
// grip handle sits outside that wrapper so it stays clickable/draggable.
export function SortableWidget({ id, span, editMode, dragHint, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editMode,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        span,
        "relative",
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
      {/* `inert` (not just pointer-events-none) so edit mode also pulls each widget's own
          interactive elements (e.g. a stat tile's <Link>) out of the tab order and
          accessibility tree — pointer-events-none alone only stops mouse/touch, a
          keyboard or screen-reader user could still Tab into and activate them. */}
      <div inert={editMode}>
        {children}
      </div>
    </div>
  )
}
