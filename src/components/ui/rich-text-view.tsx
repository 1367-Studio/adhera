"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

interface RichTextViewProps {
  content: string
  className?: string
}

const ALLOWED_TAGS = ["p", "br", "strong", "em", "u", "s", "ul", "ol", "li", "a", "h1", "h2", "h3", "h4", "blockquote", "hr", "table", "thead", "tbody", "tr", "th", "td"]
const ALLOWED_ATTR = ["href", "target", "rel"]

// Dynamically imported inside the effect (client-only) rather than statically at the top —
// `isomorphic-dompurify`'s eager server-side jsdom fallback crashes the whole route at
// module-evaluation time on Vercel's build (ERR_REQUIRE_ESM, via a transitive dependency of
// jsdom). This component only ever renders in the browser, so plain `dompurify` (no jsdom)
// loaded lazily on mount sidesteps that entirely.
export function RichTextView({ content, className }: RichTextViewProps) {
  const [clean, setClean] = useState<string | null>(null)

  useEffect(() => {
    if (!content) { setClean(null); return }
    let cancelled = false
    import("dompurify").then(({ default: DOMPurify }) => {
      if (cancelled) return
      setClean(DOMPurify.sanitize(content, { ALLOWED_TAGS, ALLOWED_ATTR, FORCE_BODY: true }))
    })
    return () => { cancelled = true }
  }, [content])

  if (!clean) return null
  return (
    <div
      // Tables scroll inside their own box so a wide one never scrolls the page or a panel.
      className={cn("prose prose-sm dark:prose-invert max-w-none [&_table]:block [&_table]:overflow-x-auto [&_table]:whitespace-nowrap", className)}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
