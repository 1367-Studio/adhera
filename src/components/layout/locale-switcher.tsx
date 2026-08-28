"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { useLocale } from "next-intl"
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { setLocale } from "@/lib/i18n/actions"
import { SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locales"

export function LocaleSwitcher() {
  const locale = useLocale() as Locale
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleSelect(next: Locale) {
    if (next === locale) return
    startTransition(async () => {
      await setLocale(next)
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
