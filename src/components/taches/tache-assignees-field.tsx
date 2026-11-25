"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { MagnifyingGlassIcon, CheckIcon, UsersIcon } from "@phosphor-icons/react/dist/ssr"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type Membre = { id: string; firstName: string; lastName: string; email: string | null }

interface Props {
  value:    string[]
  onChange: (ids: string[]) => void
}

// Aucun MultiSelect/Combobox générique n'existe dans le design system — même recette que
// src/components/actualites/actualite-form.tsx (recherche + liste de cases à cocher sur un
// tableau de membres) plutôt qu'un composant générique forcé.
export function TacheAssigneesField({ value, onChange }: Props) {
  const t = useTranslations("taches.form")
  const [search, setSearch] = useState("")

  const { data: membres = [] } = useQuery<Membre[]>({
    queryKey: ["membres", "all"],
    queryFn: async () => {
      const res = await fetch("/api/membres")
      return res.ok ? res.json() : []
    },
  })

  const filtered = membres.filter(m => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      m.firstName.toLowerCase().includes(q) ||
      m.lastName.toLowerCase().includes(q) ||
      (m.email ?? "").toLowerCase().includes(q)
    )
  })

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id])
  }

  return (
    <div className="space-y-1.5">
      <Label>{t("attribueeA")}</Label>
      <div className="rounded-lg border bg-muted/10 overflow-hidden">
        <div className="relative border-b">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder={t("searchMemberPlaceholder")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-transparent pl-8 pr-3 py-2 text-sm outline-none"
          />
        </div>

        <div className="max-h-48 overflow-y-auto divide-y">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
              <UsersIcon className="size-4" />
              {membres.length === 0 ? t("loading") : t("noResult")}
            </div>
          ) : (
            filtered.map(m => {
              const checked = value.includes(m.id)
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40",
                    checked && "bg-primary/5",
                  )}
                >
                  <div className={cn(
                    "size-4 rounded shrink-0 border flex items-center justify-center transition-colors",
                    checked ? "bg-primary border-primary" : "border-input",
                  )}>
                    {checked && <CheckIcon className="size-2.5 text-primary-foreground" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{m.firstName} {m.lastName}</p>
                    {m.email && <p className="text-xs text-muted-foreground truncate">{m.email}</p>}
                  </div>
                </button>
              )
            })
          )}
        </div>

        <div className="px-3 py-2 text-xs text-muted-foreground border-t">
          {value.length === 0 ? t("nonAttribuee") : t("selectedCount", { count: value.length })}
        </div>
      </div>
    </div>
  )
}
