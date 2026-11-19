"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { ClipboardTextIcon, ArrowRightIcon } from "@phosphor-icons/react/dist/ssr"
import { useCurrentUser, useModules } from "@/lib/user-context"
import { hasAccess } from "@/lib/permissions"
import { PENDING_COTISATION_STATUSES } from "@/lib/cotisation-filters"

type Props = {
  cotisationsEnAttente:  number | null
  donsEnAttenteCount:    number | null
  materielEnRetardCount: number | null
  isLoading: boolean
  isError:   boolean
}

type Shortcut = {
  key:   "cotisationsEnAttente" | "donsAEncaisser" | "materielEnRetard"
  count: number
  href:  string
}

// Fixed row, no trigger/toggle — replaces FORM-119's collapsible "Actions à faire" panel
// (removed) with the always-visible 3-shortcut bar from the FORM-120 mock. Superset of the
// panel's old coverage for cotisations (EN_ATTENTE+PARTIELLEMENT_PAYEE+EN_RETARD, not just
// EN_RETARD) and dons (all 3 offline methods, not just CHEQUE) — "adhésions à valider" has
// no equivalent here since the mock only lists these 3.
export function ATraiterBar({ cotisationsEnAttente, donsEnAttenteCount, materielEnRetardCount, isLoading, isError }: Props) {
  const t       = useTranslations("dashboard.aTraiter")
  const modules = useModules()
  const { permissions } = useCurrentUser()

  if (isLoading) return <div className="h-11 rounded-lg bg-muted/60 animate-pulse" />

  // Distinct from the empty state on purpose — counts are all null/0 on a failed fetch too
  // (see the `?? null` defaults in tableau-de-bord.tsx), and "Rien à traiter" on a request
  // that actually failed would tell the user the opposite of what's true.
  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-4 py-3 text-sm text-destructive">
        <ClipboardTextIcon className="size-4 shrink-0" />
        {t("loadError")}
      </div>
    )
  }

  const shortcuts: Shortcut[] = []

  if (modules.cotisations && hasAccess(permissions, "adhesions", "read") && cotisationsEnAttente) {
    shortcuts.push({
      key:   "cotisationsEnAttente",
      count: cotisationsEnAttente,
      // from=actions-todo flashes the matched rows on arrival — see useActionsTodoHighlight.
      href:  `/dashboard/cotisations?status=${PENDING_COTISATION_STATUSES}&from=actions-todo`,
    })
  }
  if (modules.dons && hasAccess(permissions, "dons", "read") && donsEnAttenteCount) {
    shortcuts.push({
      key:   "donsAEncaisser",
      count: donsEnAttenteCount,
      // No pendingMethod: the Dons page's "en attente" table already covers all 3 offline
      // methods by default — see /api/dons's fallback to { in: [ESPECES,CHEQUE,VIREMENT] }.
      href:  "/dashboard/dons?tab=dons&from=actions-todo",
    })
  }
  if (modules.materiel && hasAccess(permissions, "materiel", "read") && materielEnRetardCount) {
    shortcuts.push({
      key:   "materielEnRetard",
      count: materielEnRetardCount,
      href:  "/dashboard/materiel?overdue=1&from=actions-todo",
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-muted/60 px-4 py-3 text-sm">
      <span className="flex shrink-0 items-center gap-1.5 font-medium">
        <ClipboardTextIcon className="size-4" />
        {t("title")}
      </span>
      {shortcuts.length === 0 ? (
        <span className="text-muted-foreground">{t("empty")}</span>
      ) : (
        shortcuts.map(s => (
          <Link
            key={s.key}
            href={s.href}
            className="flex items-center gap-1 text-primary transition-colors hover:underline"
          >
            {t(`items.${s.key}`, { count: s.count })}
            <ArrowRightIcon className="size-3" />
          </Link>
        ))
      )}
    </div>
  )
}
