import { cn } from "@/lib/utils"

const COLOR_MAP: Record<string, { badge: string; dot: string }> = {
  gray:   { badge: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300",       dot: "bg-gray-400" },
  blue:   { badge: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",    dot: "bg-blue-500" },
  green:  { badge: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400", dot: "bg-green-500" },
  yellow: { badge: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400", dot: "bg-yellow-500" },
  orange: { badge: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400", dot: "bg-orange-500" },
  red:    { badge: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",        dot: "bg-red-500" },
  purple: { badge: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400", dot: "bg-purple-500" },
  pink:   { badge: "bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400",    dot: "bg-pink-500" },
  indigo: { badge: "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400", dot: "bg-indigo-500" },
}

export function getTypeColor(color: string) {
  return COLOR_MAP[color] ?? COLOR_MAP.gray
}

interface MembreTypeBadgeProps {
  name:      string
  color:     string
  className?: string
}

export function MembreTypeBadge({ name, color, className }: MembreTypeBadgeProps) {
  const { badge, dot } = getTypeColor(color)
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full text-[11px] font-medium px-2 py-0.5",
      badge,
      className,
    )}>
      <span className={cn("size-1.5 rounded-full shrink-0", dot)} />
      {name}
    </span>
  )
}
