"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

export function FinancesNav() {
  const t = useTranslations("finances.nav")
  const pathname = usePathname()

  const tabs = [
    { href: "/dashboard/finances",              label: t("overview") },
    { href: "/dashboard/finances/comptes",      label: t("accounts") },
    { href: "/dashboard/finances/recettes",     label: t("income") },
    { href: "/dashboard/finances/depenses",     label: t("expenses") },
    { href: "/dashboard/finances/import",       label: t("import") },
    { href: "/dashboard/finances/conciliation", label: t("reconciliation") },
    { href: "/dashboard/finances/categories",   label: t("categories") },
    { href: "/dashboard/finances/exercices",    label: t("exercices") },
    { href: "/dashboard/finances/rapports",     label: t("reports") },
  ]

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
