"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { setSiteLocale } from "@/lib/i18n/actions"
import { SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locales"

// Public-site equivalent of src/components/layout/locale-switcher.tsx — same look (a ghost
// icon button inherits whatever text colour the surrounding section already resolved to, so
// it stays legible on any of the site's custom background colours without extra styling), but
// writes the SITE_LOCALE cookie instead of NEXT_LOCALE. `locale` is the server-resolved value
// (SitePuckMetadata.locale / src/lib/i18n/public-locale.ts), not next-intl's useLocale(): this
// component renders on pages whose own next-intl locale is deliberately unrelated (see the
// comment on SITE_LOCALE_COOKIE), so it can't read its current state from that context.
type Props = { locale: Locale }

export function PublicSiteLocaleSwitcher({ locale }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleSelect(next: Locale) {
    if (next === locale) return
    startTransition(async () => {
      await setSiteLocale(next)
      router.refresh()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            loading={isPending}
                      />
        }
      >
        <GlobeIcon className="size-4" />
        <span className="sr-only">{LOCALE_LABELS[locale]}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUPPORTED_LOCALES.map((code) => (
          <DropdownMenuItem key={code} onClick={() => handleSelect(code)} disabled={code === locale}>
            {LOCALE_LABELS[code]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
