import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { requiredDocuments } from "@/lib/legal/acceptance"

// The documents an association requires agreement to, with the revision in force. One shared
// endpoint rather than the same list bolted onto each public form's own GET: adhesion, dons,
// evenements, boutique and portal registration all need exactly this, and a single source
// keeps them from drifting apart.
//
// `revisionId` is what the form sends back on submit, so the server can tell agreement to the
// wording actually displayed from agreement to something rewritten since.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const assoc = await prisma.association.findUnique({ where: { slug }, select: { id: true } })
  if (!assoc) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({ documents: await requiredDocuments(assoc.id) })
}
