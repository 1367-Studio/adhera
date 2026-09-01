"use client"

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

interface PriceBadgeProps {
  price: number | string | null | undefined
  className?: string
  // True when `price` is the cheapest of several ticket types rather than the event's only
  // price — prefixes "starting from" and skips the "free" tint (a 0€ tier doesn't mean the
  // whole event is free when other, paid, tiers exist).
  fromPrice?: boolean
}

export function PriceBadge({ price, className, fromPrice }: PriceBadgeProps) {
  const t = useTranslations("common")
  if (price == null) return null
  const amount = Number(price)
  const isFree = !fromPrice && amount === 0
  const formatted = amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  return (
    <span className={cn(
      // Matches Badge geometry (h-5 / rounded-md / text-xs); paid amounts stay neutral —
      // only "free" keeps a positive tint (CLAUDE.md §16: neutral UI stays neutral).
      "inline-flex h-5 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap",
      isFree
        ? "bg-green-600/10 text-green-700 dark:bg-green-500/20 dark:text-green-400"
        : "bg-secondary text-secondary-foreground",
      className,
    )}>
      {isFree ? t("free") : fromPrice ? t("startingFromPrice", { price: formatted }) : formatted}
    </span>
  )
}
