import { cn } from "@/lib/utils"

type RsvpStatus = "CONFIRME" | "PROVAVEL" | "INCERTO" | "ABSENT"

const CONFIG: Record<RsvpStatus, { label: string; dot: string; classes: string }> = {
  CONFIRME: {
    label:   "J'y serai !",
    dot:     "bg-green-500",
    classes: "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400",
  },
  PROVAVEL: {
    label:   "Si possible",
    dot:     "bg-yellow-400",
    classes: "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-400",
  },
  INCERTO: {
    label:   "Peut-être",
    dot:     "bg-orange-400",
    classes: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-400",
  },
  ABSENT: {
    label:   "Je ne viens pas",
    dot:     "bg-red-500",
    classes: "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400",
  },
}

interface RsvpBadgeProps {
  rsvp:      RsvpStatus | string
  className?: string
}

export function RsvpBadge({ rsvp, className }: RsvpBadgeProps) {
  const cfg = CONFIG[rsvp as RsvpStatus]
  if (!cfg) return null

  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
      cfg.classes,
      className,
    )}>
      <span className={cn("size-1.5 rounded-full shrink-0", cfg.dot)} />
      {cfg.label}
    </span>
  )
}
