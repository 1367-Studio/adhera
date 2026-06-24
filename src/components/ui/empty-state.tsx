import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface EmptyStateProps {
  title:        ReactNode
  description?: ReactNode
  icon?:        ReactNode
  action?:      ReactNode
  className?:   string
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn("rounded-xl border border-dashed py-12 text-center space-y-2", className)}>
      {icon && (
        <div className="flex justify-center">{icon}</div>
      )}
      <p className="text-sm text-muted-foreground">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground/60">{description}</p>
      )}
      {action && (
        <div className="flex justify-center pt-1">{action}</div>
      )}
    </div>
  )
}
