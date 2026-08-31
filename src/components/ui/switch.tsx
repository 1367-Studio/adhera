"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "@/lib/utils"

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-5 w-8 shrink-0 items-center rounded-full border border-transparent p-0.5 transition-colors outline-none select-none",
        "data-unchecked:bg-input data-checked:bg-primary dark:data-unchecked:bg-input/50",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="size-4 rounded-full bg-background transition-transform data-checked:translate-x-3"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
