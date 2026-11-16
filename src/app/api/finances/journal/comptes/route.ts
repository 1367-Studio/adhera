import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { ensureChartAccounts } from "@/lib/finance/journal/chart-accounts-seed"

// Plan de comptes de l'association — pour le sélecteur de compte du lançamento manual (FORM-107,
// rubricas restantes). `ensureChartAccounts` d'abord, sinon une association qui n'a encore jamais
// rien posté au journal n'aurait aucun ChartAccount à choisir.
export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx
  await ensureChartAccounts(associationId)

  const comptes = await prisma.chartAccount.findMany({
    where:   { associationId, archivedAt: null },
    select:  { id: true, code: true, label: true, nature: true },
    orderBy: { code: "asc" },
  })
  return NextResponse.json(comptes)
}, { area: "comptabilite", module: "finances" })
