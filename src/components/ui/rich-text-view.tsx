import DOMPurify from "isomorphic-dompurify"
import { cn } from "@/lib/utils"

interface RichTextViewProps {
  content: string
  className?: string
}

export function RichTextView({ content, className }: RichTextViewProps) {
  if (!content) return null
  const clean = DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ["p", "br", "strong", "em", "u", "s", "ul", "ol", "li", "a", "h1", "h2", "h3", "h4", "blockquote", "hr"],
    ALLOWED_ATTR: ["href", "target", "rel"],
    FORCE_BODY:   true,
  })
  return (
    <div
      className={cn("prose prose-sm dark:prose-invert max-w-none", className)}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
