import type { HeroSection } from "@/types/site-config"

type Props = { section: HeroSection; color: string }

export function SiteHeroSection({ section, color }: Props) {
  const heightClass = section.heroHeight === "half"
    ? "min-h-[50vh]"
    : "min-h-[calc(100vh-3.5rem)]"

  return (
    <section
      className={`relative flex items-center justify-center ${heightClass} px-4 text-white text-center overflow-hidden`}
      style={section.image ? undefined : { background: section.bgColor ?? color }}
    >
      {section.image && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={section.image}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/50" />
        </>
      )}
      <div className="relative z-10 max-w-3xl mx-auto space-y-4">
        <h1 className="text-4xl sm:text-5xl font-bold leading-tight">{section.title}</h1>
        {section.subtitle && (
          <p className="text-lg sm:text-xl opacity-90">{section.subtitle}</p>
        )}
      </div>
    </section>
  )
}
