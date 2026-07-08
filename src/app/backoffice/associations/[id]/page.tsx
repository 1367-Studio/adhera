import { notFound }  from "next/navigation"
import Link          from "next/link"
import type { Metadata } from "next"
import { prisma }    from "@/lib/prisma/client"
import { Badge }     from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AssociationNotes } from "@/components/backoffice/association-notes"
import { ModuleToggles }    from "@/components/backoffice/module-toggles"
import { parseModules }     from "@/lib/modules"
import { CaretLeftIcon, UsersIcon } from "@phosphor-icons/react/dist/ssr";
import { buttonVariants } from "@/components/ui/button"
import { APP_NAME } from "@/config/brand"

const subLabel: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  TRIAL:     { label: "Essai",      variant: "secondary"   },
  ACTIVE:    { label: "Actif",      variant: "default"     },
  PAST_DUE:  { label: "En retard",  variant: "destructive" },
  SUSPENDED: { label: "Suspendu",   variant: "destructive" },
  CANCELLED: { label: "Annulé",     variant: "outline"     },
}

async function getAssociation(id: string) {
  return prisma.association.findUnique({
    where:  { id, deletedAt: null },
    select: {
      id:                   true,
      name:                 true,
      slug:                 true,
      city:                 true,
      country:              true,
      subscriptionStatus:   true,
      trialEndsAt:          true,
      suspendedAt:          true,
      stripeCustomerId:     true,
      stripeSubscriptionId: true,
      sitePublished:        true,
      modules:              true,
      internalNotes:        true,
      createdAt:            true,
      users: {
        where:  { role: { in: ["ADMIN", "PRESIDENT"] }, deletedAt: null },
        select: { name: true, email: true, role: true },
        take:   1,
      },
      _count: {
        select: {
          membres:    true,
          evenements: true,
          actualites: true,
          cotisations: true,
        },
      },
    },
  })
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-40 shrink-0">{label}</span>
      <span className="break-all">{value || "—"}</span>
    </div>
  )
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const assoc  = await prisma.association.findUnique({ where: { id }, select: { name: true } })
  return { title: assoc ? `${assoc.name} — Backoffice ${APP_NAME}` : `Association — Backoffice ${APP_NAME}` }
}

export default async function AssociationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assoc  = await getAssociation(id)
  if (!assoc) notFound()

  const sub     = subLabel[assoc.subscriptionStatus] ?? { label: assoc.subscriptionStatus, variant: "outline" as const }
  const admin   = assoc.users[0]
  const modules = parseModules(assoc.modules)

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/backoffice/associations"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <CaretLeftIcon className="size-3.5" />
          Toutes les associations
        </Link>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight">{assoc.name}</h2>
            <Badge variant={sub.variant}>{sub.label}</Badge>
            {assoc.sitePublished && <Badge variant="outline" className="text-green-600 border-green-200">Site publié</Badge>}
          </div>
          <Link
            href={`/backoffice/associations/${assoc.id}/members`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <UsersIcon className="size-4" />
            Gérer les membres
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">/{assoc.slug} · {assoc.city ?? assoc.country}</p>
      </div>

      {/* Counters */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {[
          { label: "Membres",     value: assoc._count.membres    },
          { label: "Événements",  value: assoc._count.evenements  },
          { label: "Actualités",  value: assoc._count.actualites  },
          { label: "Cotisations", value: assoc._count.cotisations },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Info + Subscription */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Informations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Admin"      value={admin ? `${admin.name ?? ""} — ${admin.email}` : undefined} />
            <Row label="Ville"      value={assoc.city} />
            <Row label="Pays"       value={assoc.country} />
            <Row label="Slug"       value={`/${assoc.slug}`} />
            <Row label="Créée le"   value={new Date(assoc.createdAt).toLocaleDateString("fr-FR")} />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">Abonnement</CardTitle>
              <Badge variant={sub.variant}>{sub.label}</Badge>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {assoc.trialEndsAt && (
                <Row label="Essai jusqu'au" value={new Date(assoc.trialEndsAt).toLocaleDateString("fr-FR")} />
              )}
              {assoc.suspendedAt && (
                <Row label="Suspendu depuis" value={new Date(assoc.suspendedAt).toLocaleDateString("fr-FR")} />
              )}
              <Row label="Stripe Customer"      value={assoc.stripeCustomerId}     />
              <Row label="Stripe Subscription"  value={assoc.stripeSubscriptionId} />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Module toggles */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Modules activés</CardTitle>
        </CardHeader>
        <CardContent>
          <ModuleToggles associationId={assoc.id} initialModules={modules} />
        </CardContent>
      </Card>

      {/* Internal notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Notes internes</CardTitle>
        </CardHeader>
        <CardContent>
          <AssociationNotes associationId={assoc.id} initialNotes={assoc.internalNotes ?? ""} />
        </CardContent>
      </Card>
    </div>
  )
}
