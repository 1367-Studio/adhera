import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { hasAccess } from "@/lib/permissions"
import { grupoSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"

// FORM-97 — la liste n'est pas gatée par { area: "groupes" } au niveau de withAdminAuth :
// un utilisateur sans l'accès général mais responsable d'au moins un groupe doit tout de
// même voir ses propres groupes (voir src/lib/grupos/access.ts).
export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId, userId, permissions } = ctx
  const { searchParams } = new URL(req.url)
  const statusFilter = searchParams.get("status") // "ativo" | "arquivado" | null
  const search        = searchParams.get("search")?.trim()

  const canSeeAll = hasAccess(permissions, "groupes", "read")

  const grupos = await prisma.grupo.findMany({
    where: {
      associationId,
      ...(statusFilter === "arquivado" ? { archivedAt: { not: null } } : {}),
      ...(statusFilter === "ativo" ? { archivedAt: null } : {}),
      ...(search ? { nome: { contains: search, mode: "insensitive" } } : {}),
      ...(canSeeAll ? {} : { responsaveis: { some: { userId } } }),
    },
    orderBy: { nome: "asc" },
    include: {
      _count:      { select: { membros: true, chamadas: true } },
      responsaveis: { select: { user: { select: { id: true, name: true, email: true } } } },
      chamadas:     { take: 1, orderBy: { data: "desc" }, select: { data: true } },
    },
  })

  return NextResponse.json(grupos)
}, { module: "groupes" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json().catch(() => null)
  const parsed = grupoSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 422 })

  const grupo = await prisma.grupo.create({
    data: {
      associationId,
      nome:      parsed.data.nome,
      descricao: parsed.data.descricao || null,
    },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "GRUPO_CREATED", entity: "Grupo", entityId: grupo.id, label: grupo.nome })
  return NextResponse.json(grupo, { status: 201 })
}, { area: "groupes", access: "edit", module: "groupes" })
