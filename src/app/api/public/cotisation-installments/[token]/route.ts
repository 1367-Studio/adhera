import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { rateLimit, requestIp } from "@/lib/rate-limit"
import { cancelInstallmentPlanByToken } from "@/lib/webhook/membership-installments"

// Self-service cancellation for a "payer en plusieurs fois" MembershipTier — accessed via
// the unguessable cancelToken emailed on a failed installment charge, not a login. Same
// convention as /api/public/cotisation-subscriptions/[token].

async function findByToken(token: string) {
  return prisma.cotisationInstallmentPlan.findUnique({
    where:  { cancelToken: token },
    select: {
      status: true, installmentsPaid: true, installmentsCount: true,
      cotisation:  { select: { amount: true, membre: { select: { firstName: true, lastName: true } } } },
      association: { select: { name: true } },
    },
  })
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!(await rateLimit(`cancel-cotisation-installment-info:${requestIp(req)}`, 30, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const { token } = await params
  const plan = await findByToken(token)
  if (!plan) return NextResponse.json({ error: "Lien invalide" }, { status: 404 })

  const perInstallment = Number(plan.cotisation.amount) / plan.installmentsCount

  return NextResponse.json({
    associationName: plan.association.name,
    firstName:       plan.cotisation.membre.firstName,
    lastName:        plan.cotisation.membre.lastName,
    amount:          perInstallment.toFixed(2),
    installmentsPaid: plan.installmentsPaid,
    installmentsCount: plan.installmentsCount,
    cancelled:       plan.status !== "ACTIVE",
  })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  if (!(await rateLimit(`cancel-cotisation-installment:${requestIp(req)}`, 10, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const result = await cancelInstallmentPlanByToken(token)
  if (result.status === "not-found") return NextResponse.json({ error: "Lien invalide" }, { status: 404 })
  if (result.status === "already-cancelled")
    return NextResponse.json({ error: "Ce paiement en plusieurs fois est déjà arrêté." }, { status: 409 })
  if (result.status === "error")
    return NextResponse.json({ error: "L'arrêt a échoué. Réessayez dans quelques instants ou contactez l'association." }, { status: 502 })

  return NextResponse.json({ ok: true })
}
