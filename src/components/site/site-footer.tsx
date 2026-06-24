import { isColorDark } from "@/lib/color"

type FooterLink = { label: string; url: string }

type Props = {
  name:          string
  footerText?:   string
  footerBgColor?: string
  footerLinks?:  FooterLink[]
  color:         string
}

export function SiteFooter({ name, footerText, footerBgColor, footerLinks = [], color }: Props) {
  const bg      = footerBgColor || "#ffffff"
  const isDark  = isColorDark(bg)
  const textCol = isDark ? "#e5e7eb" : "#6b7280"
  const linkCol = isDark ? "#d1d5db" : "#374151"

  return (
    <footer className="border-t border-black/5 py-8 mt-16" style={{ background: bg }}>
      <div className="max-w-5xl mx-auto px-4 space-y-4">
        {footerLinks.length > 0 && (
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            {footerLinks.filter(l => l.label && l.url).map((link, idx) => (
              <a
                key={idx}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm hover:underline transition-colors"
                style={{ color: linkCol }}
              >
                {link.label}
              </a>
            ))}
          </div>
        )}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-sm" style={{ color: textCol }}>
          <span className="font-medium" style={{ color }}>{name}</span>
          <span>{footerText || `© ${new Date().getFullYear()} ${name}`}</span>
        </div>
      </div>
    </footer>
  )
}

