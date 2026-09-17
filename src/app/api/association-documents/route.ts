import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { associationDocumentSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { MANAGER_ROLES } from "@/lib/roles"

// The list never carries `content` — a document's HTML can run to 200 000 characters and
// the list view only needs enough to render one row per document.
const SUMMARY_SELECT = {
  id:               true,
  title:            true,
  visibleToMembers: true,
  createdAt:        true,
  updatedAt:        true,
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

  const { title, content, visibleToMembers } = parsed.data

  const document = await prisma.associationDocument.create({
    data:   { associationId, title, content, visibleToMembers },
    select: DOCUMENT_SELECT,
  })

  await writeActivityLog({ associationId, actorId: userId, action: "ASSOCIATION_DOCUMENT_CREATED", entity: "AssociationDocument", entityId: document.id, label: document.title })

  return NextResponse.json(document, { status: 201 })
}, { roles: MANAGER_ROLES })
