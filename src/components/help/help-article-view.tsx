"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import {
  PortableText,
  type PortableTextBlock,
  type PortableTextComponents,
  type PortableTextMarkComponentProps,
  type PortableTextTypeComponentProps,
} from "@portabletext/react"
import { cn } from "@/lib/utils"

// Same wrapper as RichTextView (src/components/ui/rich-text-view.tsx) so a CMS article and an
// AI answer read as one typographic system inside the help panel.
const PROSE_WRAPPER = "prose prose-sm dark:prose-invert max-w-none"

type CalloutTone = "info" | "warning" | "tip"

// A left rule, no fill and no card: the tone is carried by the label first (colour alone
// never carries meaning), the border only reinforces it.
const CALLOUT_TONE_BORDERS: Record<CalloutTone, string> = {
  info:    "border-primary/60",
  tip:     "border-green-600/60 dark:border-green-500/60",
  warning: "border-amber-500/70",
}

type CalloutValue = {
  tone?: string
  text?: string
}

function isCalloutTone(value: unknown): value is CalloutTone {
  return value === "info" || value === "warning" || value === "tip"
}

interface HelpArticleViewProps {
  /** `helpBody` Portable Text — article bodies, FAQ answers and changelog entries. */
  value:      PortableTextBlock[] | null | undefined
  className?: string
}

export function HelpArticleView({ value, className }: HelpArticleViewProps) {
  const t = useTranslations("help")

  const components = useMemo<PortableTextComponents>(() => ({
    block: {
      normal:     ({ children }) => <p>{children}</p>,
      h2:         ({ children }) => <h2>{children}</h2>,
      h3:         ({ children }) => <h3>{children}</h3>,
      blockquote: ({ children }) => <blockquote>{children}</blockquote>,
    },
    list: {
      bullet: ({ children }) => <ul>{children}</ul>,
      number: ({ children }) => <ol>{children}</ol>,
    },
    listItem: {
      bullet: ({ children }) => <li>{children}</li>,
      number: ({ children }) => <li>{children}</li>,
    },
    marks: {
      strong: ({ children }) => <strong>{children}</strong>,
      em:     ({ children }) => <em>{children}</em>,
      code:   ({ children }) => <code>{children}</code>,
      link:   ({ value: linkValue, children }: PortableTextMarkComponentProps) => {
        const href          = typeof linkValue?.href === "string" ? linkValue.href : undefined
        const opensInNewTab = linkValue?.openInNewTab === true
        if (!href) return <>{children}</>
        return (
          <a
            href={href}
            className="underline underline-offset-4"
            target={opensInNewTab ? "_blank" : undefined}
            rel={opensInNewTab ? "noopener noreferrer" : undefined}
          >
            {children}
          </a>
        )
      },
    },
    types: {
      callout: ({ value: calloutValue }: PortableTextTypeComponentProps<CalloutValue>) => {
        const tone = isCalloutTone(calloutValue?.tone) ? calloutValue.tone : "info"
        if (!calloutValue?.text) return null
        return (
          <div className={cn("my-4 border-l-2 pl-3", CALLOUT_TONE_BORDERS[tone])}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t(`callout.${tone}`)}
            </p>
            <p className="mt-1 text-sm text-foreground">{calloutValue.text}</p>
          </div>
        )
      },
      // Help bodies can carry images, but the panel has no Sanity image-URL pipeline — a
      // broken <img> would be worse than no image at all.
      image: () => null,
    },
  }), [t])

  if (!value || value.length === 0) return null

  return (
    <div className={cn(PROSE_WRAPPER, className)}>
      <PortableText value={value} components={components} onMissingComponent={false} />
    </div>
  )
}
