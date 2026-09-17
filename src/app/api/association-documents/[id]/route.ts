import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { associationDocumentUpdateSchema } from "@/lib/schemas"
import { writeActivityLog, computeDiff } from "@/lib/activity-log"
import { MANAGER_ROLES } from "@/lib/roles"

const DOCUMENT_SELECT = {
  id:               true,
  title:            true,
  content:          true,
  visibleToMembers: true,
  createdAt:        true,
  updatedAt:        true,
} as const

// `content` is deliberately left out of the diff — its HTML can run to 200 000 characters,
// so storing old + new in the log metadata would bloat every entry. A content edit is
// recorded as a bare marker instead, same as ACTUALITE_UPDATED.
const ASSOCIATION_DOCUMENT_FIELDS = ["title", "visibleToMembers"] as const

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const document = await prisma.associationDocument.findFirst({
    where:  { id, associationId, deletedAt: null },
    select: DOCUMENT_SELECT,
  })

  if (!document) return NextResponse.json({ error: "Document introuvable" }, { status: 404 })
  return NextResponse.json(document)
}, { roles: MANAGER_ROLES })

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.associationDocument.findFirst({ where: { id, associationId, deletedAt: null }, select: DOCUMENT_SELECT })
  if (!existing) return NextResponse.json({ error: "Document introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = associationDocumentUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { title, content, visibleToMembers } = parsed.data

  const data = {
    ...(title            !== undefined ? { title }            : {}),
    ...(content          !== undefined ? { content }          : {}),
    ...(visibleToMembers !== undefined ? { visibleToMembers } : {}),
  }
  if (Object.keys(data).length === 0) return NextResponse.json(existing)

  // Conditional write instead of update({ where: { id } }) — a DELETE landing between the
  // findFirst above and this write would otherwise let the PATCH edit (and log) a document
  // that is already soft-deleted, and still answer 200.
  const { count } = await prisma.associationDocument.updateMany({
    where: { id, associationId, deletedAt: null },
    data,
  })
  if (count === 0) return NextResponse.json({ error: "Document introuvable" }, { status: 404 })

  const document = await prisma.associationDocument.findFirst({ where: { id, associationId }, select: DOCUMENT_SELECT })
  if (!document) return NextResponse.json({ error: "Document introuvable" }, { status: 404 })

  const changes = computeDiff(
    existing as unknown as Record<string, unknown>,
    document as unknown as Record<string, unknown>,
    ASSOCIATION_DOCUMENT_FIELDS,
  )
  if (document.content !== existing.content) changes.content = { old: null, new: null }

  if (Object.keys(changes).length > 0) {
    await writeActivityLog({ associationId, actorId: userId, action: "ASSOCIATION_DOCUMENT_UPDATED", entity: "AssociationDocument", entityId: id, label: document.title, metadata: { changes } })
  }

  return NextResponse.json(document)
}, { roles: MANAGER_ROLES })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.associationDocument.findFirst({ where: { id, associationId, deletedAt: null }, select: { id: true, title: true } })
  if (!existing) return NextResponse.json({ error: "Document introuvable" }, { status: 404 })

  // Same conditional write as PATCH — of two concurrent DELETEs only one matches the
  // deletedAt: null row, so only one answers 204 and writes the DELETED log entry.
  const { count } = await prisma.associationDocument.updateMany({
    where: { id, associationId, deletedAt: null },
    data:  { deletedAt: new Date() },
  })
  if (count === 0) return NextResponse.json({ error: "Document introuvable" }, { status: 404 })

  await writeActivityLog({ associationId, actorId: userId, action: "ASSOCIATION_DOCUMENT_DELETED", entity: "AssociationDocument", entityId: id, label: existing.title })

  return new NextResponse(null, { status: 204 })
}, { roles: MANAGER_ROLES })
