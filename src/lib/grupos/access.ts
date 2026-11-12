// FORM-97 — l'accès à un groupe donné n'est pas décidé uniquement par la permission d'aire
// "groupes" (comme pour tout le reste du dashboard, voir src/lib/permissions.ts). Le ticket
// demande explicitement qu'un responsable désigné pour un groupe précis puisse voir et faire
// l'appel de CE groupe même sans l'accès général à l'aire — c'est la seule exception de ce
// genre dans l'app, donc elle vit dans ce fichier dédié plutôt que dans permissions.ts /
// dashboard-access.ts, qui ne connaissent que des aires entières.

import { prisma } from "@/lib/prisma/client"
import { hasAccess, type ResolvedPermissions } from "@/lib/permissions"

async function isGrupoResponsavel(grupoId: string, userId: string): Promise<boolean> {
  const link = await prisma.grupoResponsavel.findFirst({ where: { grupoId, userId } })
  return !!link
}

/** Peut voir le groupe (page détail, historique des appels) : aire "groupes" en lecture, ou responsable de CE groupe. */
export async function canReadGrupo(
  permissions: ResolvedPermissions, userId: string, grupoId: string,
): Promise<boolean> {
  if (hasAccess(permissions, "groupes", "read")) return true
  return isGrupoResponsavel(grupoId, userId)
}

/** Peut créer/modifier un appel (ChamadaSessao + ChamadaPresenca) de CE groupe : aire "groupes" en édition, ou responsable. */
export async function canActOnGrupoChamada(
  permissions: ResolvedPermissions, userId: string, grupoId: string,
): Promise<boolean> {
  if (hasAccess(permissions, "groupes", "edit")) return true
  return isGrupoResponsavel(grupoId, userId)
}
