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
}

interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  size?: keyof typeof sizes
  dismissable?: boolean
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
  footer,
  children,
}: ModalProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      disablePointerDismissal={!dismissable}
    >
      <DialogContent className={cn(sizes[size])}>
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
