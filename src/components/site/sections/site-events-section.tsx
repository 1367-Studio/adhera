import type { EventsSection } from "@/types/site-config"
import { CalendarIcon, MapPinIcon } from "lucide-react"
import { RichTextView } from "@/components/ui/rich-text-view"

function toHtml(content: string): string {
  if (!content) return ""
  if (content.trimStart().startsWith("<")) return content
  return content.replace(/\n/g, "<br>")
}

type PublicEvent = {
  id:          string
  title:       string
  date:        string
  endDate:     string | null
  location:    string | null
  description: string | null
  price:       string | null
  capacity:    number | null
}

type Props = {
  section: EventsSection
  events:  PublicEvent[]
  color:   string
}

export function SiteEventsSection({ section, events, color }: Props) {
  const displayed = events.slice(0, section.limit ?? 6)

  return (
    <section className="py-16 px-4 bg-gray-50">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold mb-8 text-gray-900">{section.title || "Prochains événements"}</h2>

        {displayed.length === 0 ? (
          <p className="text-gray-500">Aucun événement à venir pour le moment.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayed.map(event => (
              <div key={event.id} className="bg-white rounded-xl border border-gray-100 p-5 space-y-3 hover:shadow-sm transition-shadow">
                <div
                  className="text-xs font-semibold px-2 py-0.5 rounded-full inline-block text-white"
                  style={{ background: color }}
                >
                  {new Date(event.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                </div>

                <h3 className="font-semibold text-gray-900 leading-snug">{event.title}</h3>

                {event.description && (
                  <RichTextView content={toHtml(event.description)} className="text-sm text-gray-500 line-clamp-2" />
                )}

                <div className="space-y-1 text-xs text-gray-500">
                  <div className="flex items-center gap-1.5">
                    <CalendarIcon className="size-3.5 shrink-0" />
                    <span>
                      {new Date(event.date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      {event.endDate && ` — ${new Date(event.endDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}
                    </span>
                  </div>
                  {event.location && (
                    <div className="flex items-center gap-1.5">
                      <MapPinIcon className="size-3.5 shrink-0" />
                      <span className="truncate">{event.location}</span>
                    </div>
                  )}
                </div>

                {event.price && Number(event.price) > 0 && (
                  <p className="text-sm font-medium" style={{ color }}>{Number(event.price).toFixed(2)} €</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
