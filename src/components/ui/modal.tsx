"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const sizes = {
  sm:  "sm:max-w-sm",
  md:  "sm:max-w-md",
  lg:  "sm:max-w-lg",
  xl:  "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
  "4xl": "sm:max-w-4xl",
  // Viewport-relative instead of a fixed rem step — for content (a block editor, a document
  // preview) that should keep scaling with the window rather than cap out at a fixed width.
  // Each caps at a px ceiling too so an ultra-wide monitor doesn't stretch the dialog absurdly.
  "60vw": "sm:max-w-[min(60vw,900px)]",
  "80vw": "sm:max-w-[min(80vw,1600px)]",
}

interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  size?: keyof typeof sizes
  // Blocks only an accidental backdrop click while a form has unsaved input — Escape and
  // the X still close it. This is the dozens of existing create/edit modals across the
  // app (bank accounts, cotisations, factures, membres…); don't change its meaning here,
  // add a new prop instead (see `locked`).
  dismissable?: boolean
  // Blocks EVERY dismissal path — backdrop, Escape, and the X button — leaving only an
  // explicit in-content action (which calls the caller's own onOpenChange/setOpen
  // directly, bypassing this entirely) as a way out. For a hard gate like the Formwise
  // subscription modal, never for an ordinary form the user should be able to back out of.
  locked?: boolean
  footer?: React.ReactNode
  children?: React.ReactNode
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  dismissable = true,
  locked = false,
  footer,
  children,
}: ModalProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (locked && !next) return
        onOpenChange(next)
      }}
      disablePointerDismissal={locked || !dismissable}
    >
      <DialogContent className={cn(sizes[size])} showCloseButton={!locked}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="overflow-y-auto min-h-0 flex-1 -mx-4 px-4">
          {children}
        </div>

        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
