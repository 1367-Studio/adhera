import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

const ALLOWED_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const typeId = new URL(req.url).searchParams.get("typeId") ?? undefined

  const where = { associationId, status: "ACTIF" as const, deletedAt: null, ...(typeId ? { typeId } : {}) }

  const [total, withBirthDate] = await Promise.all([
    prisma.membre.count({ where }),
    prisma.membre.count({ where: { ...where, birthDate: { not: null } } }),
  ])

  return NextResponse.json({ total, withBirthDate })
}, { roles: ALLOWED_ROLES })
