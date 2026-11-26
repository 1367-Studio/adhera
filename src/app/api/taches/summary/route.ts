import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { buildTacheWhere } from "@/lib/tache-query"

// Cards de résumé au-dessus de la liste (FORM-118, commentaire Emmanuelle) — chaque compteur
// réutilise buildTacheWhere, la même fonction qui filtre la liste, pour que cliquer sur un
// card affiche exactement le nombre qu'il annonçait. Les quatre compteurs ne sont pas une
// partition : une tâche "En cours" en retard compte dans les deux cards.
export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const membreId = new URL(req.url).searchParams.get("membreId")?.trim() || undefined

  const [aFaire, enCours, echeanceSous7Jours, enRetard] = await Promise.all([
    prisma.tache.count({ where: buildTacheWhere(associationId, { membreId, status: "A_FAIRE" }) }),
    prisma.tache.count({ where: buildTacheWhere(associationId, { membreId, status: "EN_COURS" }) }),
    prisma.tache.count({ where: buildTacheWhere(associationId, { membreId, dueFilter: "soon7" }) }),
    prisma.tache.count({ where: buildTacheWhere(associationId, { membreId, status: "EN_RETARD" }) }),
  ])

  return NextResponse.json({ aFaire, enCours, echeanceSous7Jours, enRetard })
}, { area: "taches" })
