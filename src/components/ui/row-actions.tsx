"use client"

import { MoreHorizontalIcon } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Tip } from "@/components/ui/tip"

export type RowAction = {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  destructive?: boolean
  separator?: boolean // adds a separator BEFORE this item
  disabled?: boolean
}

interface RowActionsProps {
  actions: RowAction[]
  tip?: { id: string; label: string }
}

export function RowActions({ actions, tip }: RowActionsProps) {
  const trigger = (
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => e.stopPropagation()}
        />
      }
    >
      <MoreHorizontalIcon className="size-4" />
      <span className="sr-only">Ações</span>
    </DropdownMenuTrigger>
  )

  return (
    <DropdownMenu>
      {tip ? (
        <Tip id={tip.id} label={tip.label} side="left">
          {trigger}
        </Tip>
      ) : trigger}
      <DropdownMenuContent align="end">
        {actions.map((action, i) => (
          <DropdownMenuGroup key={i}>
            {action.separator && i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              variant={action.destructive ? "destructive" : "default"}
              disabled={action.disabled}
              onClick={(e) => { e.stopPropagation(); if (!action.disabled) action.onClick() }}
            >
              {action.icon && <span className="mr-2">{action.icon}</span>}
              {action.label}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
