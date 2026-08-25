// Typé `Icon` et non `ElementType` : la nav rend ces icônes en deux graisses
// (contour/pleine) via NavIcon, ce qui exige la prop `weight` de Phosphor.
import type { Icon } from "@phosphor-icons/react"
import {
  GaugeIcon, ChartLineIcon, ArrowsLeftRightIcon, TrendUpIcon, TrendDownIcon,
  UploadSimpleIcon, CalculatorIcon, BankIcon, TagIcon, CalendarBlankIcon,
  ChartBarIcon, ChartPieIcon, FileTextIcon, SlidersIcon,
} from "@phosphor-icons/react/dist/ssr"

export type FinanceNavGroupKey = "synthese" | "transactions" | "comptabilite" | "rapports"

export interface FinanceNavLeaf {
  key:         string
  href:        string
  icon:        Icon
  comingSoon?: boolean
}

export interface FinanceNavGroup {
  key:   FinanceNavGroupKey
  icon:  Icon
  items: FinanceNavLeaf[]
}

export const FINANCE_NAV: FinanceNavGroup[] = [
  { key: "synthese", icon: ChartLineIcon, items: [
    { key: "overview",     href: "/dashboard/finances",              icon: GaugeIcon },
    { key: "previsionnel", href: "/dashboard/finances/previsionnel",  icon: ChartLineIcon, comingSoon: true },
  ]},
  { key: "transactions", icon: ArrowsLeftRightIcon, items: [
    { key: "income",         href: "/dashboard/finances/recettes",     icon: TrendUpIcon },
    { key: "expenses",       href: "/dashboard/finances/depenses",     icon: TrendDownIcon },
    { key: "reconciliation", href: "/dashboard/finances/conciliation", icon: ArrowsLeftRightIcon },
    { key: "import",         href: "/dashboard/finances/import",       icon: UploadSimpleIcon },
  ]},
  { key: "comptabilite", icon: CalculatorIcon, items: [
    { key: "accounts",   href: "/dashboard/finances/comptes",    icon: BankIcon },
    { key: "categories", href: "/dashboard/finances/categories", icon: TagIcon },
    { key: "exercices",  href: "/dashboard/finances/exercices",  icon: CalendarBlankIcon },
  ]},
  { key: "rapports", icon: ChartBarIcon, items: [
    { key: "bilan",                  href: "/dashboard/finances/rapports/bilan",              icon: ChartPieIcon, comingSoon: true },
    { key: "compteResultat",         href: "/dashboard/finances/rapports/compte-de-resultat",  icon: FileTextIcon },
    { key: "rapportsPersonnalises",  href: "/dashboard/finances/rapports/personnalises",       icon: SlidersIcon, comingSoon: true },
  ]},
]

// "/dashboard/finances" (the "overview" leaf) is a prefix of every other finance
// route, so it needs an exact match only — same special case as "/dashboard" itself
// in app-sidebar.tsx's isActive — otherwise every finance page would also match
// "overview" via the prefix rule below and win as the first item in FINANCE_NAV.
export function isFinanceLeafActive(href: string, pathname: string): boolean {
  if (href === "/dashboard/finances") return pathname === href
  return pathname === href || pathname.startsWith(href + "/")
}

export function findFinanceNavLeaf(pathname: string) {
  for (const group of FINANCE_NAV) {
    const leaf = group.items.find(item => isFinanceLeafActive(item.href, pathname))
    if (leaf) return { group, leaf }
  }
  return null
}

export function findActiveFinanceGroup(pathname: string): FinanceNavGroupKey | null {
  return FINANCE_NAV.find(group => group.items.some(item => isFinanceLeafActive(item.href, pathname)))?.key ?? null
}
