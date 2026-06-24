"use client"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTip } from "@/hooks/use-tip"
import { cn } from "@/lib/utils"

interface TipProps {
  id: string
  label: string
  children: React.ReactNode
  side?: "top" | "bottom" | "left" | "right"
  className?: string
}

export function Tip({ id, label, children, side = "top", className }: TipProps) {
  const { dismissed, dismiss } = useTip(id)

  if (dismissed) return <>{children}</>

  return (
    <div className={cn("relative inline-flex", className)} onClick={dismiss}>
      {children}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Dispensar dica"
              className="absolute -top-1 -right-1 z-10 size-3.5 rounded-full focus:outline-none"
              onClick={(e) => { e.stopPropagation(); dismiss() }}
            />
          }
        >
          <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-60" />
          <span className="block size-3.5 rounded-full bg-primary" />
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-56 text-center leading-snug">
          {label}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
