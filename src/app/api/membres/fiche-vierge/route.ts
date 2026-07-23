import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { buildFicheMembreViergePdf } from "@/lib/pdf/fiche-membre-vierge"
import { resolveDocumentBranding } from "@/lib/plan-limits"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
  })
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const branding = resolveDocumentBranding(association)
  const pdf = await buildFicheMembreViergePdf({
    association: { name: association.name, logoUrl: branding.logoUrl, primaryColor: branding.primaryColor },
  })

  const slug = association.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="fiche_membre_vierge_${slug}.pdf"`,
    },
  })
}, { roles: MANAGERS })
