import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { generateRecuFiscalForParticipation } from "@/lib/pdf/recu-fiscal"
import { withAdminAuth } from "@/lib/api-wrapper"
import { hasAccess } from "@/lib/permissions"

export const GET = withAdminAuth<{ id: string; participationId: string }>(async (_req, ctx, { id: evenementId, participationId }) => {
  // A tax receipt is an accounting document — and assigns the next sequential receipt number
  // on first view, like the cotisation receipt route — so Comptabilité "edit" is required, not
  // just the event area (the Secrétaire edits events but has no access to accounting — was
  // ADMIN/PRESIDENT/TRESORIER) and not just "read".
  if (!hasAccess(ctx.permissions, "comptabilite", "edit"))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const participation = await prisma.participation.findFirst({
    where: { id: participationId, evenementId, associationId: ctx.associationId, ticketPaidAt: { not: null } },
  })
  if (!participation) return NextResponse.json({ error: "Billet introuvable ou non payé" }, { status: 404 })
  // Snapshotted onto the Participation at payment time (see schema.prisma) — a ticket whose
  // tier never opted into fiscal receipts has no receipt to generate.
  if (!participation.receiptMode || participation.receiptMode === "NONE")
    return NextResponse.json({ error: "Ce billet n'émet pas de reçu fiscal" }, { status: 403 })

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: {
      id: true, name: true, address: true, city: true,
      siren: true, rna: true, canIssueTaxReceipts: true,
      objet: true, organismeCategory: true, organismeCategoryDetail: true,
    },
  })
  if (!assoc || !assoc.canIssueTaxReceipts)
    return NextResponse.json({ error: "Reçu fiscal non activé pour cette association" }, { status: 403 })

  const pdf  = await generateRecuFiscalForParticipation(participation, assoc)
  const name = `recu-fiscal-${participation.receiptNumber ?? participation.id}.pdf`

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  })
}, { area: "evenements" })
