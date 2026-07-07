"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { UsersIcon, CalendarBlankIcon, CoinsIcon, BankIcon, TrendUpIcon, ArrowRightIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils"
import { useModules } from "@/lib/user-context"
import { FinanceCharts } from "@/components/dashboard/finance-charts"

type DashboardData = {
  membresActifs:         number
  evenementsMois:        number
  cotisationsEnAttente:  number
  cotisationsEncaissees: number
  solde:                 number
  prochainEvenement:     { id: string; title: string; date: string; location: string | null } | null
}

function fmt(n: number) {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
}

export function TableauDeBord() {
  const modules = useModules()
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn:  async () => {
      const res = await fetch("/api/dashboard")
      if (!res.ok) throw new Error("Erreur")
      return res.json()
    },
  })

  const allStats = [
    {
      label:     "Membres actifs",
      value:     data?.membresActifs ?? "—",
      icon:      UsersIcon,
      href:      "/dashboard/membres",
      color:     "text-sky-600 dark:text-sky-400",
      bg:        "bg-sky-50 dark:bg-sky-950/30",
      moduleKey: null,
    },
    {
      label:     "Événements ce mois",
      value:     data?.evenementsMois ?? "—",
      icon:      CalendarBlankIcon,
      href:      "/dashboard/evenements",
      color:     "text-violet-600 dark:text-violet-400",
      bg:        "bg-violet-50 dark:bg-violet-950/30",
      moduleKey: "evenements" as const,
    },
    {
      label:     "Cotisations en attente",
      value:     data?.cotisationsEnAttente ?? "—",
      icon:      CoinsIcon,
      href:      "/dashboard/cotisations",
      color:     data?.cotisationsEnAttente ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
      bg:        data?.cotisationsEnAttente ? "bg-amber-50 dark:bg-amber-950/30" : "bg-muted/40",
      alert:     !!data?.cotisationsEnAttente,
      moduleKey: "cotisations" as const,
    },
    {
      label:     "Solde financier",
      value:     data ? fmt(data.solde) : "—",
      icon:      BankIcon,
      href:      "/dashboard/finances",
      color:     data && data.solde >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive",
      bg:        data && data.solde >= 0 ? "bg-green-50 dark:bg-green-950/30" : "bg-red-50 dark:bg-red-950/30",
      moduleKey: "finances" as const,
    },
  ]

  const stats = allStats.filter(s => !s.moduleKey || modules[s.moduleKey])

  return (
    <div className="space-y-6 py-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tableau de bord</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Vue d&apos;ensemble de votre association
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(stat => (
          <Link
            key={stat.label}
            href={stat.href}
            className="group rounded-xl border bg-card p-5 flex flex-col gap-3 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{stat.label}</span>
              <div className={cn("flex size-8 items-center justify-center rounded-lg", stat.bg)}>
                {stat.alert
                  ? <WarningCircleIcon className={cn("size-4", stat.color)} />
                  : <stat.icon className={cn("size-4", stat.color)} />
                }
              </div>
            </div>
            <div className="flex items-end justify-between">
              <span className={cn(
                "text-2xl font-bold tabular-nums",
                isLoading && "animate-pulse text-muted-foreground",
              )}>
                {isLoading ? "…" : stat.value}
              </span>
              <ArrowRightIcon className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
            </div>
          </Link>
        ))}
      </div>

      {/* Bottom row */}
      {(modules.evenements || modules.cotisations) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Prochain événement */}
          {modules.evenements && (
            <div className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex items-center gap-2">
                <CalendarBlankIcon className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">Prochain événement</span>
              </div>
              {isLoading ? (
                <div className="h-12 rounded-lg bg-muted animate-pulse" />
              ) : data?.prochainEvenement ? (
                <Link href="/dashboard/evenements" className="block group">
                  <p className="font-semibold group-hover:text-primary transition-colors">
                    {data.prochainEvenement.title}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(data.prochainEvenement.date), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })}
                  </p>
                  {data.prochainEvenement.location && (
                    <p className="text-xs text-muted-foreground">{data.prochainEvenement.location}</p>
                  )}
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">Aucun événement à venir.</p>
              )}
            </div>
          )}

          {/* Cotisations de l'année */}
          {modules.cotisations && (
            <div className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex items-center gap-2">
                <TrendUpIcon className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">Cotisations {new Date().getFullYear()}</span>
              </div>
              {isLoading ? (
                <div className="h-12 rounded-lg bg-muted animate-pulse" />
              ) : (
                <div className="space-y-1">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400 tabular-nums">
                    {fmt(data?.cotisationsEncaissees ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">encaissé cette année</p>
                  {(data?.cotisationsEnAttente ?? 0) > 0 && (
                    <Link
                      href="/dashboard/cotisations"
                      className="text-xs text-amber-600 hover:underline flex items-center gap-1 mt-1"
                    >
                      <WarningCircleIcon className="size-3" />
                      {data?.cotisationsEnAttente} en attente de paiement
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <FinanceCharts />
    </div>
  )
}
