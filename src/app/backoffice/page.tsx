import type { Metadata } from "next"
import { prisma } from "@/lib/prisma/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BuildingsIcon, CheckCircleIcon, ClockIcon, WarningCircleIcon, CurrencyEurIcon } from "@phosphor-icons/react/dist/ssr";
export const metadata: Metadata = {
  title: "Vue d'ensemble — Backoffice Adhéra",
}

const MRR_PER_ACTIVE = 29.90

async function getStats() {
  const assocs = await prisma.association.findMany({
    where:  { deletedAt: null },
    select: { subscriptionStatus: true },
  })

  const total    = assocs.length
  const active   = assocs.filter(a => a.subscriptionStatus === "ACTIVE").length
  const trial    = assocs.filter(a => a.subscriptionStatus === "TRIAL").length
  const problem  = assocs.filter(a => ["PAST_DUE", "CANCELLED"].includes(a.subscriptionStatus)).length
  const monthly  = active * MRR_PER_ACTIVE

  return { total, active, trial, problem, monthly }
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
  const { total, active, trial, problem, monthly } = await getStats()

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map(kpi => (
          <StatCard key={kpi.title} {...kpi} />
        ))}
      </div>

      <StatCard
        title="Revenu mensuel estimé"
        value={`${monthly.toFixed(2)} €`}
        icon={CurrencyEurIcon}
        description={`associations actives × ${MRR_PER_ACTIVE.toFixed(2)} €/mois`}
        className="max-w-xs"
      />
    </div>
  )
}
