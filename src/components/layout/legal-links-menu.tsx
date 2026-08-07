"use client"

import { useTranslations } from "next-intl"
import { ScalesIcon, ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"

// Adhera runs embedded under formwise.fr/app — these legal pages live on the parent
// formwise-app site itself (single platform-wide set, not per-association), so we link
// out instead of duplicating the content here. Collapsed into one menu (rather than a
// row of footer text links) so it stays reachable when the sidebar is icon-collapsed,
// and doesn't wrap awkwardly at the sidebar's width.
const LEGAL_LINKS = [
  { key: "mentionsLegales",             href: "https://www.formwise.fr/mentions-legales" },
  { key: "cgu",                         href: "https://www.formwise.fr/cgu" },
  { key: "cgs",                         href: "https://www.formwise.fr/cgs" },
  { key: "politiqueConfidentialite",    href: "https://www.formwise.fr/politique-de-confidentialite" },
] as const

function openLegalLink(href: string) {
  window.open(href, "_blank", "noopener,noreferrer")
}

export function LegalLinksMenuItem() {
  const t = useTranslations("layout.legalLinksMenu")
  // On mobile the sidebar renders as a full-width Sheet, so opening the menu to the
  // "right" of the trigger pushes it past the viewport edge — mirror the side/align
  // shadcn's own NavUser footer menu uses, same as the rest of this sidebar's
  // isMobile-driven behavior.
  const { isMobile, setOpenMobile } = useSidebar()

  function handleSelect(href: string) {
    openLegalLink(href)
    if (isMobile) setOpenMobile(false)
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton tooltip={t("trigger")} />}>
            <ScalesIcon />
            <span>{t("trigger")}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end">
            {LEGAL_LINKS.map(link => (
              <DropdownMenuItem key={link.href} onClick={() => handleSelect(link.href)}>
                <span className="flex-1">{t(link.key)}</span>
                <ArrowSquareOutIcon className="size-3.5 text-muted-foreground" aria-label={t("opensNewTab")} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
