import type { Metadata } from "next"
import { prisma } from "@/lib/prisma/client"
import { subscriptionsPaymentPending } from "@/lib/stripe"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BuildingsIcon, CheckCircleIcon, ClockIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { APP_NAME } from "@/config/brand"
import { RecentAdhesionsChart } from "@/components/backoffice/recent-adhesions-chart"
import { RevenueChart } from "@/components/backoffice/revenue-chart"
export const metadata: Metadata = {
  title: `Vue d'ensemble — Backoffice ${APP_NAME}`,
}

async function getStats() {
  const assocs = await prisma.association.findMany({
    where:  { deletedAt: null },
    select: { subscriptionStatus: true, stripeSubscriptionId: true },
  })

  const total    = assocs.length
  const active   = assocs.filter(a => a.subscriptionStatus === "ACTIVE").length
  const trial    = assocs.filter(a => a.subscriptionStatus === "TRIAL").length

  // A PAST_DUE association whose SEPA debit is just mid-settlement (see
  // subscriptionPaymentPending in src/lib/stripe.ts) needs no admin attention — only a
  // genuinely stuck PAST_DUE, plus SUSPENDED/CANCELLED, should count toward this KPI. Bounded
  // to PAST_DUE rows only (typically a handful at most), not every association, since this
  // page is the one every backoffice session passes through first.
  const pastDue           = assocs.filter(a => a.subscriptionStatus === "PAST_DUE")
  const pendingByStripeId = await subscriptionsPaymentPending(pastDue.flatMap(a => a.stripeSubscriptionId ? [a.stripeSubscriptionId] : []))
  // No stripeSubscriptionId at all (a data anomaly — PAST_DUE should always have one) fails
  // toward "still counts as a problem", same as subscriptionsPaymentPending's own .catch(false).
  const stuckPastDue      = pastDue.filter(a => !(a.stripeSubscriptionId && pendingByStripeId.get(a.stripeSubscriptionId))).length
  const problem = stuckPastDue + assocs.filter(a => a.subscriptionStatus === "SUSPENDED" || a.subscriptionStatus === "CANCELLED").length

  return { total, active, trial, problem }
}

function StatCard({
  title, value, icon: Icon, description, className,
}: {
  title:       string
  value:       string | number
  icon:        React.ElementType
  description: string
  className?:  string
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  )
}

export default async function BackofficePage() {
  const { total, active, trial, problem } = await getStats()

  const kpis = [
    { title: "Associations",  value: total,   icon: BuildingsIcon,     description: "enregistrées sur la plateforme" },
    { title: "Actives",       value: active,  icon: CheckCircleIcon,  description: "abonnement actif"               },
    { title: "En essai",      value: trial,   icon: ClockIcon,        description: "période d'évaluation"           },
    { title: "Attention",     value: problem, icon: WarningCircleIcon,  description: "en retard ou annulées"          },
  ]

  // Security audit M1 follow-up — the only way to know these alerts are silently inert (both
  // only ever console.error, never surfaced anywhere a human would look) was to read the code.
  // This is the one page every session of this backoffice passes through, so a stale/missing
  // env var doesn't quietly stay unnoticed indefinitely. Shown only when actually missing, not
  // as a permanent fixture once configured.
  const securityAlertsConfigured = !!process.env.SECURITY_ALERT_EMAIL

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Vue d&apos;ensemble</h2>
        <p className="text-sm text-muted-foreground">Métriques SaaS de la plateforme</p>
      </div>

      {!securityAlertsConfigured && (
        <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <WarningCircleIcon className="size-3.5" />
          SECURITY_ALERT_EMAIL n&apos;est pas configurée — les alertes de sécurité (force brute, changement de droits administrateur) sont désactivées.
        </p>
      )}

      <RevenueChart />

      <RecentAdhesionsChart />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map(kpi => (
          <StatCard key={kpi.title} {...kpi} />
        ))}
      </div>
    </div>
  )
}
