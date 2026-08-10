import { cn } from "@/lib/utils"

interface PriceBadgeProps {
  price: number | string | null | undefined
  className?: string
}

export function PriceBadge({ price, className }: PriceBadgeProps) {
  if (price == null) return null
  const amount = Number(price)
  const isFree = amount === 0
  return (
    <span className={cn(
      // Matches Badge geometry (h-5 / rounded-md / text-xs); paid amounts stay neutral —
      // only "Gratuit" keeps a positive tint (CLAUDE.md §16: neutral UI stays neutral).
      "inline-flex h-5 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap",
      isFree
        ? "bg-green-600/10 text-green-700 dark:bg-green-500/20 dark:text-green-400"
        : "bg-secondary text-secondary-foreground",
      className,
    )}>
      {isFree
        ? "Gratuit"
        : amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
    </span>
  )
}
