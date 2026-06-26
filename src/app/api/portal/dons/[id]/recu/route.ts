import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { generateRecuFiscal } from "@/lib/pdf/recu-fiscal"

type SessionUser = { id?: string; associationId?: string | null }

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const membre = await prisma.membre.findFirst({
    where:  { userId: u.id!, associationId: u.associationId!, deletedAt: null },
    select: { id: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const don = await prisma.don.findFirst({
    where: { id, membreId: membre.id, associationId: u.associationId!, paidAt: { not: null } },
  })
  if (!don) return NextResponse.json({ error: "Don introuvable" }, { status: 404 })

  const assoc = await prisma.association.findUnique({
    where:  { id: u.associationId! },
    select: {
      id: true, name: true, address: true, city: true,
      siren: true, rna: true, canIssueTaxReceipts: true,
    },
  })
  if (!assoc || !assoc.canIssueTaxReceipts)
    return NextResponse.json({ error: "Reçu fiscal non disponible" }, { status: 403 })

  const pdf  = await generateRecuFiscal(don, assoc)
  const name = `recu-fiscal-${don.receiptNumber ?? don.id}.pdf`

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  })
}
