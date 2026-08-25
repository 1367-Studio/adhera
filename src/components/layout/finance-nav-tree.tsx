"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"
import { FINANCE_NAV, findActiveFinanceGroup, isFinanceLeafActive, type FinanceNavGroupKey } from "@/config/finance-nav"
import { SidebarMenuSubItem, SidebarMenuSubButton } from "@/components/ui/sidebar"
import {
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

interface FinanceNavTreeProps {
  pathname:   string
  isFlyout:   boolean
  onNavigate: () => void
}

export function FinanceNavTree({ pathname, isFlyout, onNavigate }: FinanceNavTreeProps) {
  const t = useTranslations("finances.nav")

  const activeGroup = findActiveFinanceGroup(pathname)
  // Lazily seeded from the active group on mount — this component only mounts once
  // the "Finances" category is already open, so arriving on e.g. /finances/categories
  // must show "Comptabilité" expanded on its very first paint, not a beat later via
  // an effect (which would read as a second, separate pop-open after the category's
  // own auto-expand already animated).
  const [openGroups, setOpenGroups] = useState<Set<FinanceNavGroupKey>>(() => new Set(activeGroup ? [activeGroup] : []))
  // Same auto-expand/manual-override idiom as the outer category accordion in
  // app-sidebar.tsx: only the group opened *because* it's active gets auto-closed
  // again when the active route moves elsewhere.
  const autoOpenedRef = useRef<FinanceNavGroupKey | null>(activeGroup)

  useEffect(() => {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (autoOpenedRef.current && autoOpenedRef.current !== activeGroup) {
        next.delete(autoOpenedRef.current)
      }
      if (activeGroup) next.add(activeGroup)
      return next
    })
    autoOpenedRef.current = activeGroup
  }, [activeGroup])

  useEffect(() => {
    function expandAll() { setOpenGroups(new Set(FINANCE_NAV.map(g => g.key))) }
    window.addEventListener("adhera:expand-all-nav", expandAll)
    return () => window.removeEventListener("adhera:expand-all-nav", expandAll)
  }, [])

  function toggleGroup(key: FinanceNavGroupKey) {
    if (autoOpenedRef.current === key) autoOpenedRef.current = null
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (isFlyout) {
    return (
      <>
        {FINANCE_NAV.map(group => (
          <DropdownMenuSub key={group.key}>
            <DropdownMenuSubTrigger>
              <group.icon />
              {t(`groups.${group.key}`)}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {group.items.map(leaf => (
                <DropdownMenuItem key={leaf.href} render={<Link href={leaf.href} />}>
                  <leaf.icon />
                  {t(leaf.key)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </>
    )
  }

  return (
    <SidebarMenuSubItem className="p-0" data-tour="nav-finances">
      <ul className="flex w-full flex-col gap-1">
        {FINANCE_NAV.map(group => {
          const isOpen        = openGroups.has(group.key)
          const isGroupActive = activeGroup === group.key

          return (
            <li key={group.key}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggleGroup(group.key)}
                title={t(`groups.${group.key}`)}
                className={cn(
                  "flex h-7 w-full items-center gap-2 rounded-sm px-2 text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
                  isGroupActive && !isOpen && "font-medium",
                )}
              >
                <group.icon className="size-3.5 shrink-0" />
                <span className="truncate">{t(`groups.${group.key}`)}</span>
                <CaretRightIcon className={cn("ml-auto size-3 shrink-0 transition-transform", isOpen && "rotate-90")} />
              </button>

              {isOpen && (
                <ul className="ml-3 flex flex-col gap-0.5 border-l border-sidebar-border py-0.5 pl-2.5">
                  {group.items.map(leaf => (
                    <li key={leaf.href}>
                      <SidebarMenuSubButton
                        size="sm"
                        render={<Link href={leaf.href} />}
                        isActive={isFinanceLeafActive(leaf.href, pathname)}
                        onClick={onNavigate}
                        title={t(leaf.key)}
                      >
                        <leaf.icon />
                        <span className="truncate">{t(leaf.key)}</span>
                        {leaf.comingSoon && (
                          <span className="shrink-0 text-xs text-muted-foreground/60">
                            {t("comingSoonTag")}
                          </span>
                        )}
                      </SidebarMenuSubButton>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </SidebarMenuSubItem>
  )
}
