import { notFound }    from "next/navigation"
import Link            from "next/link"
import type { Metadata } from "next"
import { prisma }      from "@/lib/prisma/client"
import { MembersTable } from "@/components/backoffice/members-table"
import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { APP_NAME } from "@/config/brand"
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const assoc  = await prisma.association.findUnique({ where: { id }, select: { name: true } })
  return { title: assoc ? `Membres — ${assoc.name} — Backoffice ${APP_NAME}` : `Membres — Backoffice ${APP_NAME}` }
}

export default async function AssociationMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const assoc = await prisma.association.findUnique({
    where:  { id, deletedAt: null },
    select: { id: true, name: true },
  })
  if (!assoc) notFound()

  const membres = await prisma.membre.findMany({
    where:   { associationId: id, deletedAt: null },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id:        true,
      firstName: true,
      lastName:  true,
      email:     true,
      status:    true,
      userId:    true,
      user: {
        select: { id: true, email: true, role: true },
      },
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/backoffice/associations/${id}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <CaretLeftIcon className="size-3.5" />
          {assoc.name}
        </Link>
        <h2 className="text-xl font-semibold tracking-tight">Membres</h2>
        <p className="text-sm text-muted-foreground">
          {membres.length} membre{membres.length !== 1 ? "s" : ""} · {membres.filter((m) => m.userId).length} avec compte
        </p>
      </div>

      <MembersTable associationId={id} initialMembers={membres} />
    </div>
  )
}
