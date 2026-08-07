import { fr, enUS, ptBR, es } from "date-fns/locale"
import type { Locale as DateFnsLocale } from "date-fns"
import type { Locale } from "@/i18n/locales"

// Every other date-fns usage in this codebase (51 files) hardcodes the French locale
// regardless of the active next-intl locale — a pre-existing, app-wide gap, not something
// new. This helper exists so components that *do* need to respect the viewer's actual
// language (see src/components/support/support-ticket-thread.tsx) have one place to pull a
// correctly-matched date-fns locale from, instead of adding a fifth hardcoded `fr` import.
const DATE_FNS_LOCALES: Record<Locale, DateFnsLocale> = {
  fr, en: enUS, pt: ptBR, es,
}

export function getDateFnsLocale(locale: Locale): DateFnsLocale {
  return DATE_FNS_LOCALES[locale] ?? fr
}
