import Link       from "next/link"
import type { Metadata } from "next"
import { prisma } from "@/lib/prisma/client"
import { Badge }  from "@/components/ui/badge"

export const metadata: Metadata = {
  title: "Associations — Backoffice Adhéra",
}

const subLabel: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  TRIAL:     { label: "Essai",     variant: "secondary"   },
  ACTIVE:    { label: "Actif",     variant: "default"     },
  PAST_DUE:  { label: "En retard", variant: "destructive" },
  SUSPENDED: { label: "Suspendu",  variant: "destructive" },
  CANCELLED: { label: "Annulé",    variant: "outline"     },
}

async function getAssociations() {
  return prisma.association.findMany({
    where:   { deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id:                 true,
      name:               true,
      slug:               true,
      city:               true,
      country:            true,
      subscriptionStatus: true,
      trialEndsAt:        true,
      sitePublished:      true,
      createdAt:          true,
      users: {
        where:  { role: { in: ["ADMIN", "PRESIDENT"] }, deletedAt: null },
        select: { email: true },
        take:   1,
      },
      _count: { select: { membres: true, evenements: true } },
    },
  })
}

export default async function AssociationsPage() {
  const assocs = await getAssociations()

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Associations</h2>
        <p className="text-sm text-muted-foreground">
          {assocs.length} association{assocs.length !== 1 ? "s" : ""} enregistrée{assocs.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-xs text-muted-foreground">
              <th className="text-left px-4 py-2.5 font-medium">Association</th>
              <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Admin</th>
              <th className="text-right px-4 py-2.5 font-medium">Membres</th>
              <th className="text-right px-4 py-2.5 font-medium hidden sm:table-cell">Événements</th>
              <th className="text-center px-4 py-2.5 font-medium">Abonnement</th>
              <th className="text-left px-4 py-2.5 font-medium hidden lg:table-cell">Créée le</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {assocs.map(assoc => {
              const sub  = subLabel[assoc.subscriptionStatus] ?? { label: assoc.subscriptionStatus, variant: "outline" as const }
              const href = `/backoffice/associations/${assoc.id}`
              return (
                <tr key={assoc.id} className="hover:bg-muted/30 transition-colors group">
                  <td className="px-0 py-0">
                    <Link href={href} className="flex flex-col px-4 py-3">
                      <span className="font-medium group-hover:underline">{assoc.name}</span>
                      <span className="text-xs text-muted-foreground">
                        /{assoc.slug} · {assoc.city ?? assoc.country}
                        {assoc.sitePublished && <span className="ml-1.5 text-green-600">● site actif</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="px-0 py-0 hidden md:table-cell">
                    <Link href={href} className="flex px-4 py-3 text-muted-foreground h-full">
                      {assoc.users[0]?.email ?? "—"}
                    </Link>
                  </td>
                  <td className="px-0 py-0">
                    <Link href={href} className="flex px-4 py-3 justify-end tabular-nums h-full">
                      {assoc._count.membres}
                    </Link>
                  </td>
                  <td className="px-0 py-0 hidden sm:table-cell">
                    <Link href={href} className="flex px-4 py-3 justify-end tabular-nums h-full">
                      {assoc._count.evenements}
                    </Link>
                  </td>
                  <td className="px-0 py-0">
                    <Link href={href} className="flex px-4 py-3 justify-center h-full">
                      <Badge variant={sub.variant}>{sub.label}</Badge>
                    </Link>
                  </td>
                  <td className="px-0 py-0 hidden lg:table-cell">
                    <Link href={href} className="flex px-4 py-3 text-muted-foreground text-xs h-full">
                      {new Date(assoc.createdAt).toLocaleDateString("fr-FR")}
                    </Link>
                  </td>
                </tr>
              )
            })}
            {assocs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  Aucune association enregistrée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
