import Link from "next/link"
import type { ActualitesSection } from "@/types/site-config"

type PublicActualite = {
  id:          string
  title:       string
  content:     string
  imageUrl:    string | null
  pinned:      boolean
  publishedAt: string
}

type Props = {
  section:    ActualitesSection
  actualites: PublicActualite[]
  color:      string
  slug:       string
}

// A plain-text teaser, not RichTextView — the whole card is a <Link>, and rich content can
// contain its own <a> (the editor supports inserting links), which would nest an anchor
// inside an anchor and break the card's click target in some browsers.
function excerpt(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
}

export function SiteActualitesSection({ section, actualites, color, slug }: Props) {
  const displayed = actualites.slice(0, section.limit ?? 6)

  return (
    // scroll-mt-16 offsets for SiteNavbar's sticky h-16 header when the detail page's "back to
    // site" link lands here via #<section.id>, so the section title isn't hidden behind it.
    <section id={section.id} className="py-16 px-4 scroll-mt-16">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold mb-8 text-gray-900">{section.title || "Actualités"}</h2>

        {displayed.length === 0 ? (
          <p className="text-gray-500">Aucune actualité publiée pour le moment.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayed.map(actu => (
              <Link
                key={actu.id}
                href={`/${slug}/actualites/${actu.id}`}
                className="block rounded-lg border border-gray-100 overflow-hidden transition-colors hover:bg-gray-50"
              >
                {actu.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={actu.imageUrl}
                    alt={actu.title}
                    className="w-full h-44 object-cover"
                  />
                )}
                <div className="p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    {actu.pinned && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: color }}>
                        À la une
                      </span>
                    )}
                    <time className="text-xs text-gray-400">
                      {new Date(actu.publishedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                    </time>
                  </div>
                  <h3 className="font-semibold text-gray-900 leading-snug">{actu.title}</h3>
                  <p className="text-sm text-gray-500 line-clamp-3">{excerpt(actu.content)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
