import type { AboutSection } from "@/types/site-config"
import { RichTextView } from "@/components/ui/rich-text-view"

type Props = { section: AboutSection }

function toHtml(content: string): string {
  if (!content) return ""
  // If it's already HTML (from a rich text editor), pass it through.
  // Otherwise convert plain-text line breaks to <br> so they're preserved.
  if (content.trimStart().startsWith("<")) return content
  return content.replace(/\n/g, "<br>")
}

export function SiteAboutSection({ section }: Props) {
  return (
    <section className="py-16 px-4">
      <div className="max-w-3xl mx-auto">
        {section.title && (
          <h2 className="text-2xl font-bold mb-6 text-gray-900">{section.title}</h2>
        )}
        <RichTextView content={toHtml(section.content)} className="text-gray-600" />
      </div>
    </section>
  )
}
