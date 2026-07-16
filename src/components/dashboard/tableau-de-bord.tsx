"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { UsersIcon, CalendarBlankIcon, CoinsIcon, BankIcon, TrendUpIcon, ArrowRightIcon, WarningCircleIcon, ShoppingBagIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils"
import { useModules } from "@/lib/user-context"
import { usePalette, hexToRgba } from "@/lib/finance-palette"
import { FinanceCharts } from "@/components/dashboard/finance-charts"

type DashboardData = {
  membresActifs:         number
  evenementsMois:        number
  cotisationsEnAttente:  number
  cotisationsEncaissees: number
  solde:                 number
  prochainEvenement:     { id: string; title: string; date: string; location: string | null } | null
  // Pending orders first (need action), then recent PAID sales fill out the rest — up to
  // 5 total. Each row carries its own status since the list can be a mix of both.
  ventesRecentes:        {
    id:          string
    totalAmount: number
    date:        string
    guestName:   string | null
    membre:      { firstName: string; lastName: string } | null
    status:      "PENDING" | "PAID"
  }[]
}

function fmt(n: number) {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
}

export function TableauDeBord() {
  const modules = useModules()
  const pal = usePalette()
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn:  async () => {
      const res = await fetch("/api/dashboard")
      if (!res.ok) throw new Error("Erreur")
      return res.json()
    },
  })

  const cotisationsAlert = !!data?.cotisationsEnAttente
  const soldePositive    = !data || data.solde >= 0

  // Membres/Événements are plain counts with no real financial meaning, so they get no
  // accent color (null → neutral rendering below) instead of an arbitrary one each.
  // Cotisations and Solde reuse the exact same palette as the charts just below
  // (usePalette) — same yellow for "en attente", same green/red for paid/negative —
  // instead of unrelated Tailwind shades, so a color means the same thing everywhere on
  // this screen.
  const allStats = [
    {
      label:     "Membres actifs",
      value:     data?.membresActifs ?? "—",
      icon:      UsersIcon,
      href:      "/dashboard/membres",
      accent:    null as string | null,
      moduleKey: null,
    },
    {
      label:     "Événements ce mois",
      value:     data?.evenementsMois ?? "—",
      icon:      CalendarBlankIcon,
      href:      "/dashboard/evenements",
      accent:    null as string | null,
      moduleKey: "evenements" as const,
    },
    {
      label:     "Cotisations en attente",
      value:     data?.cotisationsEnAttente ?? "—",
      icon:      CoinsIcon,
      href:      "/dashboard/cotisations",
      accent:    cotisationsAlert ? pal.enAttente : null,
      alert:     cotisationsAlert,
      moduleKey: "cotisations" as const,
    },
    {
      label:     "Solde financier",
      value:     data ? fmt(data.solde) : "—",
      icon:      BankIcon,
      href:      "/dashboard/finances",
      accent:    soldePositive ? pal.recettes : pal.depenses,
      moduleKey: "finances" as const,
    },
  ]

  const stats = allStats.filter(s => !s.moduleKey || modules[s.moduleKey])

  return (
    <div className="space-y-6 py-4">
      <div
        className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationFillMode: "both" }}
      >
        <h1 className="text-2xl font-bold tracking-tight">Tableau de bord</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Vue d&apos;ensemble de votre association
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            className="animate-in fade-in slide-in-from-bottom-3 duration-300"
            style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
          >
            <Link
              href={stat.href}
              className="group rounded-xl border bg-card p-5 flex flex-col gap-3 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{stat.label}</span>
                <div
                  className={cn("flex size-8 items-center justify-center rounded-lg", !stat.accent && "bg-accent")}
                  style={stat.accent ? { backgroundColor: hexToRgba(stat.accent, pal.dark ? 0.2 : 0.12) } : undefined}
                >
                  {stat.alert
                    ? <WarningCircleIcon className="size-4" style={stat.accent ? { color: stat.accent } : undefined} />
                    : <stat.icon
                        className={cn("size-4", !stat.accent && "text-accent-foreground")}
                        style={stat.accent ? { color: stat.accent } : undefined}
                      />
                  }
                </div>
              </div>
              <div className="flex items-end justify-between">
                <span
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    isLoading && "animate-pulse text-muted-foreground",
                  )}
                  style={!isLoading && stat.accent ? { color: stat.accent } : undefined}
                >
                  {isLoading ? "…" : stat.value}
                </span>
                <ArrowRightIcon className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
              </div>
            </Link>
          </div>
        ))}
      </div>

      {/* Bottom row */}
      {(modules.evenements || modules.cotisations || modules.boutique) && (
        <div
          className={cn(
            "grid gap-4",
            // Boutique gets its own portrait column (narrower, spans both rows) beside
            // évenement/cotisations stacked on top of each other — only worth the explicit
            // row-span when there's something on the left to stack against; otherwise fall
            // back to the plain side-by-side layout. No `grid-rows-*` here on purpose:
            // that utility forces equal-height (1fr) rows, which would inflate évenement/
            // cotisations to match half of boutique's (much taller) content instead of
            // sizing each row to its own content — implicit auto rows (the default when
            // grid-template-rows is left unset) do that correctly on their own.
            //
            // Every card below gets an EXPLICIT col-start/row-start — sparse auto-placement
            // (CSS Grid's default) advances its placement cursor forward and never backfills
            // an earlier row, so a row-span-2 item placed after two col-span-2 items above it
            // lands in row 2 (not row 1), leaving row 1's cell empty and creating a stray
            // implicit row 3. Verified live: without explicit placement the boutique card
            // rendered flush with "Cotisations" instead of spanning up to "Prochain événement".
            // The right column is capped at 240–280px (not an equal 1fr share) — évenement
            // and cotisations are each short (a title+date, or a percentage+bar), so their
            // combined stacked height rarely clears ~300px; 280px is a deliberately tight
            // ceiling to stay under that even when content is short, keeping the card
            // narrower than it is tall. minmax (not a flat px value) still keeps it from
            // looking orphaned on an ultra-wide monitor, where the two 1fr columns would
            // otherwise balloon far past a fixed-width sibling — just capped low enough
            // that it can't grow past the point of reading as landscape instead of portrait.
            modules.boutique && (modules.evenements || modules.cotisations)
              ? "sm:grid-cols-2 lg:grid-cols-[1fr_1fr_minmax(240px,280px)]"
              : "sm:grid-cols-2",
          )}
        >
          {/* Prochain événement */}
          {modules.evenements && (
            <div
              className={cn(
                "rounded-xl border bg-card p-5 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300",
                modules.boutique && "lg:col-span-2 lg:col-start-1 lg:row-start-1",
              )}
              style={{ animationDelay: "240ms", animationFillMode: "both" }}
            >
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
            <div
              className={cn(
                "rounded-xl border bg-card p-5 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300",
                modules.boutique && cn("lg:col-span-2 lg:col-start-1", modules.evenements ? "lg:row-start-2" : "lg:row-start-1"),
              )}
              style={{ animationDelay: "300ms", animationFillMode: "both" }}
            >
              <div className="flex items-center gap-2">
                <TrendUpIcon className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">Cotisations {new Date().getFullYear()}</span>
              </div>
              {isLoading ? (
                <div className="h-12 rounded-lg bg-muted animate-pulse" />
              ) : (
                <div className="space-y-1">
                  <p className="text-2xl font-bold tabular-nums" style={{ color: pal.payees }}>
                    {fmt(data?.cotisationsEncaissees ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">encaissé cette année</p>
                  {(data?.cotisationsEnAttente ?? 0) > 0 && (
                    <Link
                      href="/dashboard/cotisations"
                      className="text-xs hover:underline flex items-center gap-1 mt-1"
                      style={{ color: pal.enAttente }}
                    >
                      <WarningCircleIcon className="size-3" />
                      {data?.cotisationsEnAttente} en attente de paiement
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Commandes récentes — portrait: narrower, spans both rows on the left's height */}
          {modules.boutique && (
            <div
              className={cn(
                "rounded-xl border bg-card p-5 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300 flex flex-col",
                (modules.evenements || modules.cotisations) && "lg:col-start-3 lg:row-start-1 lg:row-span-2",
              )}
              style={{ animationDelay: "330ms", animationFillMode: "both" }}
            >
              <div className="flex items-center gap-2">
                <ShoppingBagIcon className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">Commandes récentes</span>
              </div>
              {isLoading ? (
                <div className="h-12 rounded-lg bg-muted animate-pulse" />
              ) : data?.ventesRecentes.length ? (
                <div className="space-y-2">
                  {data.ventesRecentes.map((v, i) => {
                    // The list is pre-sorted PENDING-block-then-PAID-block — a status change
                    // between two consecutive rows marks the boundary. Flagged rather than
                    // relying on the amber date text alone, which is easy to skim past in a
                    // mixed list and doesn't say *how many* of each are in view.
                    const prev = data.ventesRecentes[i - 1]
                    const startsNewGroup = i === 0 || prev.status !== v.status
                    return (
                      <div key={v.id}>
                        {startsNewGroup && i > 0 && <div className="h-px bg-border my-2" />}
                        {startsNewGroup && v.status === "PENDING" && (
                          <p className="text-[11px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-500 mb-1">
                            En attente ({data.ventesRecentes.filter(x => x.status === "PENDING").length})
                          </p>
                        )}
                        {startsNewGroup && v.status === "PAID" && i > 0 && (
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                            Ventes récentes
                          </p>
                        )}
                        <Link
                          href={`/dashboard/boutique?tab=commandes&commandeId=${v.id}`}
                          className={cn(
                            "flex items-center justify-between group -mx-1 px-1.5 py-0.5 rounded hover:bg-accent transition-colors",
                            v.status === "PENDING" && "border-l-2 border-amber-500",
                          )}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                              {v.membre ? `${v.membre.firstName} ${v.membre.lastName}` : (v.guestName ?? "Invité")}
                            </p>
                            <p className={cn("text-xs", v.status === "PENDING" ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground")}>
                              {format(new Date(v.date), "d MMM 'à' HH:mm", { locale: fr })}
                            </p>
                          </div>
                          <span className="text-sm font-semibold tabular-nums shrink-0 ml-2">{fmt(v.totalAmount / 100)}</span>
                        </Link>
                      </div>
                    )
                  })}
                  <Link href="/dashboard/boutique?tab=commandes" className="text-xs text-muted-foreground hover:underline flex items-center gap-1 pt-1">
                    Voir toutes les commandes
                    <ArrowRightIcon className="size-3" />
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Aucune vente pour le moment.</p>
              )}
            </div>
          )}
        </div>
      )}

      <div
        className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: "360ms", animationFillMode: "both" }}
      >
        <FinanceCharts />
      </div>
    </div>
  )
}
