import { fr, enUS, ptBR, pt as ptPT, es, bg, cs, da, de, el, et, fi, hr, hu, it, lt, lv, mt, nl, pl, ro, sk, sl, sv } from "date-fns/locale"
import type { Locale as DateFnsLocale } from "date-fns"
import type { Locale } from "@/i18n/locales"

// Every other date-fns usage in this codebase (51 files) hardcodes the French locale
// regardless of the active next-intl locale — a pre-existing, app-wide gap, not something
// new. This helper exists so components that *do* need to respect the viewer's actual
// language (see src/components/support/support-ticket-thread.tsx) have one place to pull a
// correctly-matched date-fns locale from, instead of adding a fifth hardcoded `fr` import.
//
// Enabling a locale in SUPPORTED_LOCALES (src/i18n/locales.ts) means adding it here too —
// tsc catches a missing entry (this is a Record over every Locale), but a same-tag date-fns
// export isn't guaranteed to exist, so check date-fns/locale's own exports first. Irish (ga)
// has no date-fns locale at all — English is the substitute, not a random pick: Ireland's
// other official language, and the one date-fns itself falls back to for Irish-market
// formatting elsewhere.
const DATE_FNS_LOCALES: Record<Locale, DateFnsLocale> = {
  fr, en: enUS, pt: ptBR, "pt-PT": ptPT, es, bg, cs, da, de, el, et, fi, ga: enUS, hr, hu, it, lt, lv, mt, nl, pl, ro, sk, sl, sv,
}

export function getDateFnsLocale(locale: Locale): DateFnsLocale {
  return DATE_FNS_LOCALES[locale] ?? fr
}
