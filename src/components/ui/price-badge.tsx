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
      "inline-flex items-center rounded-full text-[11px] font-medium px-2 py-0.5",
      isFree
        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
        : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
      className,
    )}>
      {isFree
        ? "Gratuit"
        : amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
    </span>
  )
}
