"use client"

import { useState } from "react"
import { Modal } from "@/components/ui/modal"
import { cn } from "@/lib/utils"

interface ImageThumbnailProps {
  src: string
  alt: string
  className?: string
}

// Self-contained: the thumbnail is its own trigger, so callers just drop it into a list
// row without wiring up open/onOpenChange state themselves.
export function ImageThumbnail({ src, alt, className }: ImageThumbnailProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={alt}
        className={cn(
          "size-10 rounded-md overflow-hidden bg-muted shrink-0 cursor-zoom-in hover:opacity-80",
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="w-full h-full object-cover" />
      </button>

      <Modal open={open} onOpenChange={setOpen} title={alt} size="lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="w-full max-h-[70vh] object-contain rounded-md" />
      </Modal>
    </>
  )
}
