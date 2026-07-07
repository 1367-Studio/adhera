"use client"

import { LightbulbIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { useTip } from "@/hooks/use-tip"
import { cn } from "@/lib/utils"

interface TipBannerProps {
  id: string
  children: React.ReactNode
  className?: string
}

export function TipBanner({ id, children, className }: TipBannerProps) {
  const { dismissed, dismiss } = useTip(id)

  if (dismissed) return null

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground animate-in fade-in slide-in-from-top-1 duration-300",
        className
      )}
    >
      <LightbulbIcon className="mt-0.5 size-4 shrink-0 text-primary" />
      <p className="flex-1 leading-relaxed text-muted-foreground">{children}</p>
      <button
        type="button"
        aria-label="Dispensar dica"
        onClick={dismiss}
        className="mt-0.5 shrink-0 rounded text-muted-foreground/60 hover:text-foreground transition-colors focus:outline-none"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  )
}
