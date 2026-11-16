"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useMembreChamadas } from "@/hooks/use-membre-chamadas"
import { dateOnlyToLocal } from "@/lib/date-format"

export function MembreGruposTab({ membreId }: { membreId: string }) {
  const t = useTranslations()
  const { data: presencas = [], isLoading } = useMembreChamadas(membreId)

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
  if (presencas.length === 0) {
    return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("groupes.detail.noAppel")}</p>
  }

  return (
    <div className="divide-y rounded-lg border">
      {presencas.map(p => (
        <Link
          key={p.id}
          href={`/dashboard/groupes/${p.sessao.grupo.id}/appels/${p.sessao.id}`}
          className="flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted/40"
        >
          <div>
            <p className="font-medium">{p.sessao.grupo.nome}</p>
            <p className="text-xs text-muted-foreground">
              {format(dateOnlyToLocal(p.sessao.data), "dd MMMM yyyy", { locale: fr })}
              {p.sessao.horario && ` · ${p.sessao.horario}`}
            </p>
          </div>
          <span className="text-xs text-muted-foreground">{t(`groupes.appel.status.${p.status}`)}</span>
        </Link>
      ))}
    </div>
  )
}
