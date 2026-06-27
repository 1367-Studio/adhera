import { NextResponse }    from "next/server"
import { auth }            from "@/lib/auth/config"
import { prisma }          from "@/lib/prisma/client"
import { z }               from "zod"
import type { SessionUser } from "@/lib/user-context"

const ASSIGNABLE_ROLES = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE", "MEMBRE"] as const

function superadminOnly(user: SessionUser | undefined) {
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 })
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  const user    = session?.user as SessionUser | undefined
  const guard   = superadminOnly(user)
  if (guard) return guard

  const { id } = await params

  const exists = await prisma.association.findUnique({
    where:  { id, deletedAt: null },
    select: { id: true },
  })
  if (!exists) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const membres = await prisma.membre.findMany({
    where:   { associationId: id, deletedAt: null },
    orderBy: { firstName: "asc" },
    select: {
      id:        true,
      firstName: true,
      lastName:  true,
      email:     true,
      status:    true,
      userId:    true,
      user: {
        select: { id: true, email: true, role: true },
      },
    },
  })

  return NextResponse.json(membres)
}

const patchSchema = z.object({
  userId: z.string().min(1),
  role:   z.enum(ASSIGNABLE_ROLES),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  const user    = session?.user as SessionUser | undefined
  const guard   = superadminOnly(user)
  if (guard) return guard

  const { id } = await params

  const body   = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides" }, { status: 422 })
  }

  const { userId, role } = parsed.data

  const target = await prisma.user.findUnique({
    where:  { id: userId },
    select: { id: true, role: true, associationId: true },
  })

  if (!target || target.associationId !== id) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 })
  }

  if (target.role === "SUPER_ADMIN") {
    return NextResponse.json({ error: "Impossible de modifier un super admin" }, { status: 403 })
  }

  if (target.role === "ADMIN" && role !== "ADMIN") {
    const remainingAdmins = await prisma.user.count({
      where: { associationId: id, role: "ADMIN", deletedAt: null, id: { not: userId } },
    })
    if (remainingAdmins === 0) {
      return NextResponse.json(
        { error: "Impossible de rétrograder le seul administrateur de l'association" },
        { status: 422 },
      )
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data:  { role },
  })

  return NextResponse.json({ ok: true })
}
