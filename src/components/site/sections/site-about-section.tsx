import type { AboutSection } from "@/types/site-config"
import { RichTextView } from "@/components/ui/rich-text-view"
import { toHtml } from "@/lib/site-content"

type Props = { section: AboutSection }

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
