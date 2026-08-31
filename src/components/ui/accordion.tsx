"use client"

import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"

function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("rounded-lg border bg-card divide-y", className)}
      {...props}
    />
  )
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("group/accordion-item", className)}
      {...props}
    />
  )
}

function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "flex flex-1 items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-left transition-colors hover:bg-muted/40 focus-visible:outline-1 focus-visible:outline-ring",
          className
        )}
        {...props}
      >
        {children}
        <CaretDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-in-out group-data-[panel-open]/accordion-item:rotate-180" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionPanel({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-panel"
      className={cn(
        // Duration scales with panel height (tan(atan2()) strips the px unit) so tall panels
        // don't fly open at the fixed-duration speed; clamped to 250–500ms.
        "overflow-hidden text-sm data-[starting-style]:h-0 data-[ending-style]:h-0 h-[var(--accordion-panel-height)] transition-[height] ease-in-out [transition-duration:clamp(250ms,calc(150ms+tan(atan2(var(--accordion-panel-height,400px),1px))*0.25ms),500ms)]",
        className
      )}
      {...props}
    >
      <div className="px-4 pb-4 pt-1">{children}</div>
    </AccordionPrimitive.Panel>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionPanel }
