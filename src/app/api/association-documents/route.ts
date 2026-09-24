import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { associationDocumentSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { syncDocumentRevision } from "@/lib/legal/revisions"
import { MANAGER_ROLES } from "@/lib/roles"
import { isAssociationDocumentFileUrl } from "@/lib/legal/document-file"

// The list never carries `content` — a document's HTML can run to 200 000 characters and
// the list view only needs enough to render one row per document. The PDF's URL and name are
// short, so they ride along.
const SUMMARY_SELECT = {
  id:                 true,
  title:              true,
  fileUrl:            true,
  fileName:           true,
  visibleToMembers:   true,
  visibleToPublic:    true,
  requiresAcceptance: true,
  createdAt:          true,
  updatedAt:          true,
} as const

const DOCUMENT_SELECT = { ...SUMMARY_SELECT, content: true } as const

export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const documents = await prisma.associationDocument.findMany({
    where:   { associationId, deletedAt: null },
    orderBy: { title: "asc" },
    select:  SUMMARY_SELECT,
  })

  return NextResponse.json(documents)
}, { roles: MANAGER_ROLES })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = associationDocumentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { title, content, fileUrl, visibleToMembers, requiresAcceptance } = parsed.data
  // The schema only checks the URL's shape; this checks it is a PDF /api/upload stored for
  // legal documents, not an arbitrary link.
  if (fileUrl !== null && !isAssociationDocumentFileUrl(fileUrl)) {
    return NextResponse.json({ error: "Fichier PDF invalide" }, { status: 422 })
  }
  // A name without a file would describe nothing.
  const fileName = fileUrl === null ? null : parsed.data.fileName
  // A document people must agree to has to be readable by the person agreeing, who has no
  // account at that point — so requiring acceptance publishes it, whatever the switch said.
  const visibleToPublic = parsed.data.visibleToPublic || requiresAcceptance

  const document = await prisma.$transaction(async tx => {
    const created = await tx.associationDocument.create({
      data:   { associationId, title, content, fileUrl, fileName, visibleToMembers, visibleToPublic, requiresAcceptance },
      select: DOCUMENT_SELECT,
    })
    // Freezes the wording in force so acceptances can point at it — no-op unless the document
    // requires acceptance.
    await syncDocumentRevision(tx, created)
    return created
  })

  await writeActivityLog({ associationId, actorId: userId, action: "ASSOCIATION_DOCUMENT_CREATED", entity: "AssociationDocument", entityId: document.id, label: document.title })

  return NextResponse.json(document, { status: 201 })
}, { roles: MANAGER_ROLES })
