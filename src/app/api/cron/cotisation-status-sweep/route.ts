import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { deriveCotisationStatus } from "@/lib/cotisation-status"

const BATCH_SIZE = 500

// Flips EN_ATTENTE/PARTIELLEMENT_PAYEE cotisations to EN_RETARD purely because a due date has
// passed — every other trigger (payment recorded/removed, cotisation edited, Stripe webhooks)
// recomputes status inline, but nothing else notices the pure passage of time. Runs daily,
// scheduled between purge-email-html (4am UTC) and automations (9am UTC) in vercel.json so
// any cotisation whose due date "yesterday" in Paris time has unambiguously rolled over
// before automations' EVENT_PAYMENT_OVERDUE targeting runs.
//
// Idempotent by construction (pure function of current DB state, re-checked in the `where` on
// every call) — no locking needed, unlike automations' nextRunAt CAS, since this never sends
// anything, only flips a column. EXONERE/ANNULEE (manual) and PAYE (terminal at sweep time)
// are never touched.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron/cotisation-status-sweep] CRON_SECRET is not configured — refusing to run")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const todayUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  // No-installment case: a plain column comparison covers it, no need to load rows into JS.
  const { count: flippedByDueDate } = await prisma.cotisation.updateMany({
    where: {
      status:       { in: ["EN_ATTENTE", "PARTIELLEMENT_PAYEE"] },
      installments: { none: {} },
      dueDate:      { lt: todayUtcMidnight },
    },
    data: { status: "EN_RETARD" },
  })

  // Installment case: lateness depends on a waterfall against amountPaid, not a plain column,
  // so batch-fetch and compute in JS (mirrors the cursor-pagination pattern in
  // src/app/api/cron/automations/route.ts).
  let flippedByInstallment = 0
  let cursor: string | undefined
  for (;;) {
    const batch = await prisma.cotisation.findMany({
      where:   { status: { in: ["EN_ATTENTE", "PARTIELLEMENT_PAYEE"] }, installments: { some: {} } },
      select:  { id: true, status: true, amount: true, amountPaid: true, dueDate: true, installments: { select: { amount: true, dueDate: true, order: true } } },
      take:    BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    })
    if (batch.length === 0) break

    const toFlip = batch
      .filter(c => deriveCotisationStatus({
        currentStatus: c.status,
        amount:        Number(c.amount),
        amountPaid:    Number(c.amountPaid),
        dueDate:       c.dueDate,
        installments:  c.installments.map(i => ({ amount: Number(i.amount), dueDate: i.dueDate, order: i.order })),
        now,
      }) === "EN_RETARD")
      .map(c => c.id)

    if (toFlip.length > 0) {
      await prisma.cotisation.updateMany({ where: { id: { in: toFlip } }, data: { status: "EN_RETARD" } })
      flippedByInstallment += toFlip.length
    }

    cursor = batch[batch.length - 1].id
    if (batch.length < BATCH_SIZE) break
  }

  return NextResponse.json({ flipped: flippedByDueDate + flippedByInstallment })
}
