import type { ContactSection } from "@/types/site-config"
import { MapPinIcon } from "@phosphor-icons/react/dist/ssr";
import { SITE_UI_STRINGS, type SiteUiStrings } from "@/lib/site-puck/site-ui-strings"

type Props = {
  section: ContactSection
  city:    string | null
  country: string
  ui?:     SiteUiStrings
}

export function SiteContactSection({ section, city, country, ui = SITE_UI_STRINGS }: Props) {
  return (
    <section className="py-16 px-4 bg-gray-50">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold mb-6 text-gray-900">{section.title || ui.contactDefaultTitle}</h2>

        <div className="space-y-3 text-sm text-gray-600">
          {city && (
            <div className="flex items-center gap-2">
              <MapPinIcon className="size-4 shrink-0 text-gray-400" />
              <span>{city}, {country}</span>
            </div>
          )}
          {!city && (
            <p className="text-gray-400 italic">{ui.contactCityMissing}</p>
          )}
        </div>
      </div>
    </section>
  )
}
