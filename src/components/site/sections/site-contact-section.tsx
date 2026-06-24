import type { ContactSection } from "@/types/site-config"
import { MapPinIcon } from "lucide-react"

type Props = {
  section: ContactSection
  city:    string | null
  country: string
}

export function SiteContactSection({ section, city, country }: Props) {
  return (
    <section className="py-16 px-4 bg-gray-50">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold mb-6 text-gray-900">{section.title || "Contact"}</h2>

        <div className="space-y-3 text-sm text-gray-600">
          {city && (
            <div className="flex items-center gap-2">
              <MapPinIcon className="size-4 shrink-0 text-gray-400" />
              <span>{city}, {country}</span>
            </div>
          )}
          {!city && (
            <p className="text-gray-400 italic">Ville non renseignée dans les Paramètres.</p>
          )}
        </div>
      </div>
    </section>
  )
}
