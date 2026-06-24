"use client"

import { MapPinIcon } from "lucide-react"
import type { SiteConfig, SiteSection } from "@/types/site-config"
import { isColorDark } from "@/lib/color"

type MembreType  = { id: string; name: string; color: string }
type PublicEvent = {
  id: string; title: string; date: string; endDate: string | null
  location: string | null; description: string | null; price: string | null; capacity: number | null
}

type PublicActualite = {
  id:          string
  title:       string
  content:     string
  imageUrl:    string | null
  pinned:      boolean
  publishedAt: string
}

type Props = {
  config:      SiteConfig | null
  name:        string
  slug:        string
  city:        string | null
  country:     string
  membreTypes: MembreType[]
  events:      PublicEvent[]
  actualites?: PublicActualite[]
}


export function SitePreviewPanel({ config, name, slug, city, country, membreTypes, events, actualites = [] }: Props) {
  const sections    = config?.sections ?? []
  const color       = config?.primaryColor ?? "#6366f1"
  const logoUrl     = config?.logoUrl
  const headerBg    = config?.headerBgColor || "#ffffff"
  const headerDark  = isColorDark(headerBg)
  const showMembres  = config?.headerShowMembres ?? true
  const showRegister = config?.headerShowRegister ?? false
  const footerBg    = config?.footerBgColor || "#ffffff"
  const footerDark  = isColorDark(footerBg)
  const footerLinks = (config?.footerLinks ?? []).filter(l => l.label && l.url)

  return (
    <div className="min-h-full bg-white text-gray-900" style={{ colorScheme: "light" }}>
      {/* Navbar */}
      <nav className="sticky top-0 z-10 backdrop-blur border-b border-black/5" style={{ background: headerBg }}>
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 font-semibold" style={{ color: headerDark ? "#fff" : "#111827" }}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={name} width={40} height={40} className="rounded size-10 object-contain" />
            ) : (
              <span
                className="size-10 rounded flex items-center justify-center text-white text-sm font-bold shrink-0"
                style={{ background: color }}
              >
                {name[0]?.toUpperCase()}
              </span>
            )}
            <span className="text-sm">{name || "Mon association"}</span>
          </div>
          {(showMembres || showRegister) && (
            <div className="flex items-center gap-1.5">
              {showRegister && (
                <span className="text-[10px] font-medium px-2 py-1 rounded border" style={{ color, borderColor: color }}>
                  S&apos;inscrire
                </span>
              )}
              {showMembres && (
                <span className="text-[10px] font-medium px-2 py-1 rounded text-white" style={{ background: color }}>
                  Se connecter
                </span>
              )}
            </div>
          )}
        </div>
      </nav>

      {/* Sections */}
      <main>
        {sections.length === 0 && (
          <div className="py-24 text-center text-sm text-gray-400">
            Aucune section — ajoutez-en une depuis le panneau de gauche.
          </div>
        )}
        {sections.map((section: SiteSection) => {
          switch (section.type) {
            case "hero": {
              const heightClass = section.heroHeight === "half"
                ? "min-h-[50vh]"
                : "min-h-[calc(100vh-3rem)]"
              return (
                <section
                  key={section.id}
                  className={`relative flex items-center justify-center ${heightClass} px-4 text-white text-center overflow-hidden`}
                  style={section.image ? undefined : { background: section.bgColor ?? color }}
                >
                  {section.image && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={section.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/50" />
                    </>
                  )}
                  <div className="relative z-10 max-w-2xl mx-auto space-y-3">
                    <h1 className="text-3xl font-bold leading-tight">{section.title || "Titre principal"}</h1>
                    {section.subtitle && <p className="text-base opacity-90">{section.subtitle}</p>}
                  </div>
                </section>
              )
            }

            case "about":
              return (
                <section key={section.id} className="py-12 px-4">
                  <div className="max-w-2xl mx-auto">
                    {section.title && <h2 className="text-xl font-bold mb-4 text-gray-900">{section.title}</h2>}
                    {"content" in section && section.content
                      ? <div className="text-gray-600 text-sm leading-relaxed prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: section.content }} />
                      : <p className="text-gray-300 italic text-sm">Contenu à renseigner…</p>
                    }
                  </div>
                </section>
              )

            case "events": {
              const limit     = "limit" in section ? section.limit ?? 6 : 6
              const displayed = events.slice(0, limit)
              return (
                <section key={section.id} className="py-12 px-4 bg-gray-50">
                  <div className="max-w-4xl mx-auto">
                    <h2 className="text-xl font-bold mb-6 text-gray-900">{section.title || "Prochains événements"}</h2>
                    {displayed.length === 0 ? (
                      <p className="text-gray-400 text-sm italic">Aucun événement à venir pour le moment.</p>
                    ) : (
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {displayed.map(event => (
                          <div key={event.id} className="bg-white rounded-xl border border-gray-100 p-4 space-y-2">
                            <div className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-block text-white" style={{ background: color }}>
                              {new Date(event.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
                            </div>
                            <p className="text-sm font-semibold text-gray-900 leading-snug">{event.title}</p>
                            {event.location && (
                              <div className="flex items-center gap-1 text-[10px] text-gray-500">
                                <MapPinIcon className="size-3 shrink-0" />
                                <span className="truncate">{event.location}</span>
                              </div>
                            )}
                            {event.price && Number(event.price) > 0 && (
                              <p className="text-xs font-medium" style={{ color }}>{Number(event.price).toFixed(2)} €</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )
            }

            case "actualites": {
              const limit     = "limit" in section ? section.limit ?? 6 : 6
              const displayed = actualites.slice(0, limit)
              return (
                <section key={section.id} className="py-12 px-4">
                  <div className="max-w-4xl mx-auto">
                    <h2 className="text-xl font-bold mb-6 text-gray-900">{section.title || "Actualités"}</h2>
                    {displayed.length === 0 ? (
                      <p className="text-gray-400 text-sm italic">Aucune actualité publiée pour le moment.</p>
                    ) : (
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {displayed.map(actu => (
                          <article key={actu.id} className="rounded-xl border border-gray-100 overflow-hidden">
                            {actu.imageUrl && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={actu.imageUrl} alt={actu.title} className="w-full h-32 object-cover" />
                            )}
                            <div className="p-3 space-y-1.5">
                              <div className="flex items-center gap-1.5">
                                {actu.pinned && (
                                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full text-white" style={{ background: color }}>
                                    À la une
                                  </span>
                                )}
                                <time className="text-[10px] text-gray-400">
                                  {new Date(actu.publishedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                                </time>
                              </div>
                              <p className="text-xs font-semibold text-gray-900 leading-snug line-clamp-2">{actu.title}</p>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )
            }

            case "membership":
              return (
                <section key={section.id} className="py-12 px-4 relative">
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-[1px]">
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-900 text-white">
                      Aperçu — formulaire non interactif
                    </span>
                  </div>
                  <div className="max-w-sm mx-auto pointer-events-none select-none">
                    <h2 className="text-xl font-bold mb-2 text-gray-900">{section.title || "Rejoindre l'association"}</h2>
                    {"body" in section && section.body && (
                      <p className="text-gray-500 text-sm mb-6">{section.body}</p>
                    )}
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="h-9 rounded-lg border border-gray-200 bg-gray-50" />
                        <div className="h-9 rounded-lg border border-gray-200 bg-gray-50" />
                      </div>
                      <div className="h-9 rounded-lg border border-gray-200 bg-gray-50" />
                      <div className="h-9 rounded-lg border border-gray-200 bg-gray-50" />
                      {membreTypes.length > 0 && <div className="h-9 rounded-lg border border-gray-200 bg-gray-50" />}
                      <div className="h-10 rounded-lg" style={{ background: color }} />
                    </div>
                  </div>
                </section>
              )

            case "contact":
              return (
                <section key={section.id} className="py-12 px-4 bg-gray-50">
                  <div className="max-w-2xl mx-auto">
                    <h2 className="text-xl font-bold mb-4 text-gray-900">{section.title || "Contact"}</h2>
                    {city ? (
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <MapPinIcon className="size-4 shrink-0 text-gray-400" />
                        <span>{city}, {country}</span>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">Ville non renseignée dans les Paramètres.</p>
                    )}
                  </div>
                </section>
              )
          }
        })}
      </main>

      {/* Footer */}
      <footer className="border-t border-black/5 py-6 mt-8" style={{ background: footerBg }}>
        <div className="max-w-5xl mx-auto px-4 space-y-3">
          {footerLinks.length > 0 && (
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-1.5">
              {footerLinks.map((link, idx) => (
                <span key={idx} className="text-xs hover:underline cursor-pointer" style={{ color: footerDark ? "#d1d5db" : "#374151" }}>
                  {link.label}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-3 text-xs" style={{ color: footerDark ? "#e5e7eb" : "#6b7280" }}>
            <span className="font-medium" style={{ color }}>{name}</span>
            <span>{config?.footerText || `© ${new Date().getFullYear()} ${name}`}</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
