import type { ActualitesSection } from "@/types/site-config"
import { RichTextView } from "@/components/ui/rich-text-view"

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
}

export function SiteActualitesSection({ section, actualites, color }: Props) {
  const displayed = actualites.slice(0, section.limit ?? 6)

  return (
    <section className="py-16 px-4">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold mb-8 text-gray-900">{section.title || "Actualités"}</h2>

        {displayed.length === 0 ? (
          <p className="text-gray-500">Aucune actualité publiée pour le moment.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayed.map(actu => (
              <article key={actu.id} className="rounded-xl border border-gray-100 overflow-hidden hover:shadow-sm transition-shadow">
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
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: color }}>
                        À la une
                      </span>
                    )}
                    <time className="text-xs text-gray-400">
                      {new Date(actu.publishedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                    </time>
                  </div>
                  <h3 className="font-semibold text-gray-900 leading-snug">{actu.title}</h3>
                  <RichTextView content={actu.content} className="text-sm text-gray-500 line-clamp-3" />
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
