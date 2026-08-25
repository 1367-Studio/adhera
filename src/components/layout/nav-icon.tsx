import type { Icon } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

/**
 * Icône de navigation : contour au repos, pleine au survol et sur l'élément actif.
 *
 * Les icônes Phosphor importées depuis `/ssr` ne rendent que les tracés de la graisse
 * demandée (voir SSRBase : `weights.get(weight)`) — impossible donc de passer de
 * `regular` à `fill` en CSS sur un seul élément. Les deux graisses sont empilées et on
 * bascule l'opacité : pas d'état React, pas de re-rendu, et le survol répond
 * instantanément (un `onMouseEnter` sur chaque entrée coûterait un rendu par survol).
 *
 * Dépend du marqueur `group/nav-item` porté par SidebarMenuButton, SidebarMenuSubButton
 * et les en-têtes de groupe de finance-nav-tree — les noms de groupe doivent rester
 * littéraux pour que Tailwind génère les classes.
 */
export function NavIcon({ icon: IconCmp, className }: { icon: Icon; className?: string }) {
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)}>
      <IconCmp
        weight="regular"
        className="size-full transition-opacity group-hover/nav-item:opacity-0 group-data-active/nav-item:opacity-0"
      />
      {/* aria-hidden : doublon purement visuel de l'icône ci-dessus. */}
      <IconCmp
        weight="fill"
        aria-hidden
        className="absolute inset-0 size-full opacity-0 transition-opacity group-hover/nav-item:opacity-100 group-data-active/nav-item:opacity-100"
      />
    </span>
  )
}
