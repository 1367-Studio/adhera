"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { UsersIcon, CalendarBlankIcon, CoinsIcon, BankIcon, TrendUpIcon, ArrowRightIcon, WarningCircleIcon, ShoppingBagIcon, PackageIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils"
import { useModules } from "@/lib/user-context"
import { usePalette, hexToRgba } from "@/lib/finance-palette"
import { FinanceCharts, IncomeByCategoryChart } from "@/components/dashboard/finance-charts"

type DashboardData = {
  membresActifs:         number
  evenementsMois:        number
  cotisationsEnAttente:  number
  cotisationsEncaissees: number
  solde:                 number
  materielEnRetardCount: number
  materielEmpruntsListe: { id: string; materialName: string; borrowerName: string; expectedReturnAt: string | null; isOverdue: boolean }[]
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

  // Bottom row is (up to) two independent columns: left stacks Prochain événement above
  // Cotisations, right stacks Commandes récentes above Matériel emprunté. Each column is
  // its own vertical stack (`space-y-4`), not a shared grid with row-for-row placement —
  // the two columns' cards have very different, unpredictable heights (a fixed title+date
  // vs. a variable-length list), so locking them into synced rows left one card stretched
  // (or, with `items-start`, just floating above a dead gap) whenever its counterpart was
  // taller. Stacking each column independently means a column's height is simply the sum
  // of its own cards, so neither ever has to accommodate the other's height.
  const hasLeftColumn  = modules.evenements || modules.cotisations
  const hasRightColumn = modules.boutique || modules.materiel

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
      {(modules.evenements || modules.cotisations || modules.boutique || modules.materiel) && (
        <div
          className={cn(
            "grid gap-4",
            // The right column is capped at 240–280px (not an equal 1fr share) — its cards
            // are meant to read as portrait/narrow, not balloon out to match the left
            // column's width on a wide monitor.
            hasRightColumn && hasLeftColumn && "sm:grid-cols-2 lg:grid-cols-[1fr_minmax(240px,280px)]",
          )}
        >
          {/* Left column: Prochain événement, Cotisations — stacked, each sized to its own
              content, independent of whatever height the right column ends up being. */}
          {hasLeftColumn && (
            <div className="space-y-4">
              {modules.evenements && (
                <div
                  className="rounded-xl border bg-card p-5 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
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

              {modules.cotisations && (
                <div
                  className="rounded-xl border bg-card p-5 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
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

              {modules.finances && <IncomeByCategoryChart />}
            </div>
          )}

          {/* Right column: Commandes récentes, Matériel emprunté — same idea, stacked and
              independently sized instead of row-synced with the left column. */}
          {hasRightColumn && (
            <div className="space-y-4">
              {modules.boutique && (
                <div
                  className="rounded-xl border bg-card p-5 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300 flex flex-col"
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
                        // The list is pre-sorted PENDING-block-then-PAID-block — a status
                        // change between two consecutive rows marks the boundary. Flagged
                        // rather than relying on the amber date text alone, which is easy
                        // to skim past in a mixed list and doesn't say *how many* of each
                        // are in view.
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

              {/* Matériel emprunté — portrait, same shape as Commandes récentes, stacked
                  below it in the right column. Every active loan, not just overdue ones
                  (per client feedback: they want to see what's out, not only what's late)
                  — overdue loans still sort first and stay visually flagged, mirroring how
                  Commandes récentes splits PENDING ahead of PAID above. */}
              {modules.materiel && (
                <div
                  className="rounded-xl border bg-card p-5 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300 flex flex-col"
                  style={{ animationDelay: "360ms", animationFillMode: "both" }}
                >
                  <div className="flex items-center gap-2">
                    <PackageIcon className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Matériel emprunté</span>
                  </div>
                  {isLoading ? (
                    <div className="h-12 rounded-lg bg-muted animate-pulse" />
                  ) : data?.materielEmpruntsListe.length ? (
                    <div className="space-y-2">
                      {data.materielEmpruntsListe.map((l, i) => {
                        const prev = data.materielEmpruntsListe[i - 1]
                        const startsNewGroup = i === 0 || prev.isOverdue !== l.isOverdue
                        // No cutoff on how old an overdue loan can be (unlike the 14-day
                        // window on pending boutique orders above), so a loan overdue
                        // since last year needs the year in the label — otherwise
                        // "3 janv." reads as this January, not a year-old forgotten loan.
                        const returnDate = l.expectedReturnAt ? new Date(l.expectedReturnAt) : null
                        const dateFmt = returnDate && returnDate.getFullYear() !== new Date().getFullYear() ? "d MMM yyyy" : "d MMM"
                        return (
                          <div key={l.id}>
                            {startsNewGroup && i > 0 && <div className="h-px bg-border my-2" />}
                            {startsNewGroup && l.isOverdue && (
                              <p className="text-[11px] font-medium uppercase tracking-wide text-red-600 dark:text-red-500 mb-1">
                                En retard ({data.materielEnRetardCount})
                              </p>
                            )}
                            {startsNewGroup && !l.isOverdue && i > 0 && (
                              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                                En cours
                              </p>
                            )}
                            <Link
                              href="/dashboard/materiel"
                              className={cn(
                                "flex items-center justify-between group -mx-1 px-1.5 py-0.5 rounded hover:bg-accent transition-colors",
                                l.isOverdue && "border-l-2 border-red-500",
                              )}
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                                  {l.materialName}
                                </p>
                                <p className="text-xs text-muted-foreground truncate">{l.borrowerName}</p>
                              </div>
                              <span className={cn("text-xs shrink-0 ml-2", l.isOverdue ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                                {returnDate ? format(returnDate, dateFmt, { locale: fr }) : "Sans échéance"}
                              </span>
                            </Link>
                          </div>
                        )
                      })}
                      <Link href="/dashboard/materiel" className="text-xs text-muted-foreground hover:underline flex items-center gap-1 pt-1">
                        Voir tout le matériel
                        <ArrowRightIcon className="size-3" />
                      </Link>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Aucun matériel actuellement emprunté.</p>
                  )}
                </div>
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
