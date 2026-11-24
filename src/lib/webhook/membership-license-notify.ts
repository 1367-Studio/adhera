import { prisma } from "@/lib/prisma/client"
import { pusherServer } from "@/lib/pusher-server"

// FORM-114 — called once per newly-created MembershipLicense that isn't a renewal copy (the
// renewal itself is a routine yearly event already surfaced via the signup's normal payment
// notification; A_SOLICITAR/EM_ANDAMENTO are the states that actually need a human to act —
// request the license from the federation, or verify a member's declared existing one). Until
// this existed, the only way an admin found out was by opening the member's fiche or the new
// /dashboard/licencas list — nothing ever pointed them there.
export async function notifyNewMembershipLicense(params: {
  associationId:    string
  membreId:         string
  memberName:       string
  federation:       string
  season:           string
  declaredByMembre: boolean
}): Promise<void> {
  const admins = await prisma.user.findMany({
    where:  { associationId: params.associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER"] }, active: true },
    select: { id: true },
  })
  if (!admins.length) return

  const title = params.declaredByMembre ? "Licence fédérative à vérifier" : "Licence fédérative à demander"
  const body  = params.declaredByMembre
    ? `${params.memberName} a déclaré posséder déjà une licence ${params.federation} (${params.season}) — à vérifier auprès de la fédération.`
    : `${params.memberName} a besoin d'une licence ${params.federation} (${params.season}) — à demander auprès de la fédération.`

  await prisma.notification.createMany({
    data: admins.map(a => ({ userId: a.id, title, body, link: `/dashboard/membres/${params.membreId}`, scope: "GESTION" })),
    skipDuplicates: true,
  })
  await pusherServer.trigger(`private-association-${params.associationId}`, "new-notification", {}).catch(() => {})
}
