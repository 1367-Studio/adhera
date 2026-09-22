import type { Metadata } from "next"
import { prisma } from "@/lib/prisma/client"
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
    select: { subscriptionStatus: true },
  })

  const total    = assocs.length
  const active   = assocs.filter(a => a.subscriptionStatus === "ACTIVE").length
  const trial    = assocs.filter(a => a.subscriptionStatus === "TRIAL").length
  const problem  = assocs.filter(a => ["PAST_DUE", "SUSPENDED", "CANCELLED"].includes(a.subscriptionStatus)).length

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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Vue d&apos;ensemble</h2>
        <p className="text-sm text-muted-foreground">Métriques SaaS de la plateforme</p>
      </div>

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
