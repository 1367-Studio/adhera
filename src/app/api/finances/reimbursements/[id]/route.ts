import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { reimbursementRequestUpdateSchema } from "@/lib/schemas"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { canReadReimbursement } from "@/lib/finance/reimbursement-access"

const DETAIL_INCLUDE = {
  requester:  { select: { id: true, name: true } },
  decidedBy:  { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  project:    { select: { id: true, name: true } },
  event:      { select: { id: true, title: true } },
  items: {
    orderBy: { order: "asc" as const },
    include: { category: { select: { id: true, name: true, accountingCode: true } }, expense: { select: { id: true, status: true } } },
  },
  reimbursement: { include: { bankAccount: { select: { id: true, accountName: true } }, registeredBy: { select: { name: true } } } },
}

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId, permissions } = ctx

  const request = await prisma.reimbursementRequest.findFirst({
    where:   { id, associationId },
    include: DETAIL_INCLUDE,
  })
  if (!request) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 })
  if (!canReadReimbursement(permissions, userId, request.requesterId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  return NextResponse.json(request)
}, { module: "reimbursements" })

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.reimbursementRequest.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 })
  if (existing.requesterId !== userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  if (existing.status !== "DRAFT" && existing.status !== "NEEDS_CORRECTION") {
    return NextResponse.json({ error: "Cette demande ne peut plus être modifiée" }, { status: 409 })
  }

  const body   = await req.json()
  const parsed = reimbursementRequestUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { subject, comment, projectId, eventId } = parsed.data

  const request = await prisma.reimbursementRequest.update({
    where: { id },
    data: {
      ...(subject !== undefined ? { subject } : {}),
      ...(comment   !== undefined ? { comment:   comment   || null } : {}),
      ...(projectId !== undefined ? { projectId: projectId || null } : {}),
      ...(eventId   !== undefined ? { eventId:   eventId   || null } : {}),
    },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "REIMBURSEMENT_UPDATED", entity: "ReimbursementRequest", entityId: id, label: request.subject })
  return NextResponse.json(request)
}, { module: "reimbursements" })

// Only a DRAFT (never submitted) can be hard-deleted — anything that has been through
// PENDING_APPROVAL at least once is cancelled instead, never erased (see the cancel route).
export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.reimbursementRequest.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 })
  if (existing.requesterId !== userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  if (existing.status !== "DRAFT") {
    return NextResponse.json({ error: "Seul un brouillon peut être supprimé — annulez cette demande à la place" }, { status: 409 })
  }

  await prisma.reimbursementRequest.delete({ where: { id } })
  await writeActivityLog({ associationId, actorId: userId, action: "REIMBURSEMENT_DELETED", entity: "ReimbursementRequest", entityId: id, label: existing.subject })
  return new NextResponse(null, { status: 204 })
}, { module: "reimbursements" })
