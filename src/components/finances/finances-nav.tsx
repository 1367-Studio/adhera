"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const tabs = [
  { href: "/dashboard/finances",             label: "Vue d'ensemble" },
  { href: "/dashboard/finances/comptes",     label: "Comptes" },
  { href: "/dashboard/finances/recettes",    label: "Recettes" },
  { href: "/dashboard/finances/depenses",    label: "Dépenses" },
  { href: "/dashboard/finances/import",      label: "Importer" },
  { href: "/dashboard/finances/conciliation",label: "Conciliation" },
  { href: "/dashboard/finances/categories",  label: "Catégories" },
  { href: "/dashboard/finances/rapports",    label: "Rapports" },
]

export function FinancesNav() {
  const pathname = usePathname()

  return (
    <div className="border-b">
      <nav className="-mb-px flex gap-0 overflow-x-auto">
        {tabs.map(tab => {
          const active = tab.href === "/dashboard/finances"
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(tab.href + "/")
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40",
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
