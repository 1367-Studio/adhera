import type { ReactNode } from "react"
import { NextIntlClientProvider } from "next-intl"
import { resolvePublicLocale } from "@/lib/i18n/public-locale"
import { loadMessagesForLocale } from "@/i18n/request"

// /avis/[token] is an anonymous, no-login public page reached via an emailed link — same
// category as the event registration/adhesion/dons pages, so it must follow the visitor's own
// SITE_LOCALE choice (resolvePublicLocale), never the portal's NEXT_LOCALE that the root
// layout's own NextIntlClientProvider uses. See src/app/[slug]/layout.tsx, which this mirrors.
export default async function AvisLayout({ children }: { children: ReactNode }) {
  const locale   = await resolvePublicLocale()
  const messages = await loadMessagesForLocale(locale)

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  )
}
