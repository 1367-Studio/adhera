import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"

// Historique de présence d'un membre à travers tous ses groupes, pour l'onglet "Groupes" de
// sa fiche — protégé par l'accès standard à la fiche membre (membres:read), pas par
// src/lib/grupos/access.ts : c'est la fiche du membre, pas une page de groupe.
export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const membre = await prisma.membre.findFirst({ where: { id, associationId } })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const presencas = await prisma.chamadaPresenca.findMany({
    where:   { membreId: id },
    include: { sessao: { select: { id: true, data: true, horario: true, atividade: true, grupo: { select: { id: true, nome: true } } } } },
    orderBy: { sessao: { data: "desc" } },
  })

  return NextResponse.json(presencas)
}, { area: "membres", module: "groupes" })
