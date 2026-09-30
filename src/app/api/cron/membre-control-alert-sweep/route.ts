import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { notifyStaffOfControlAlerts } from "@/lib/membre-control-alerts"

const GRACE_PERIOD_MS = 30 * 60 * 1000

const AUTO_RESOLVE_NOTE = "Résolu automatiquement : une cotisation valide a été ajoutée, ou le membre n'est plus actif."

// Superadmin watchdog: an ACTIF member still has zero valid Cotisation 30 minutes after last
// being touched. This codebase has hit this failure mode from several unrelated causes
// (portal self-registration, a Stripe webhook silently dropping a Cotisation, a subscription-
// renewal race) — each fixed individually, none of them predicted in advance. This sweep is
// the generic net so the next unknown cause gets noticed instead of surfacing weeks later.
// Runs every 15 minutes (vercel.json), comfortably inside the 30-minute grace period.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron/membre-control-alert-sweep] CRON_SECRET is not configured — refusing to run")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - GRACE_PERIOD_MS)

  // Auto-resolve stale alerts first: nothing else in the app clears one once the underlying
  // situation changes (a cotisation gets added by hand, the member is deactivated or
  // deleted) — without this an "Ouverte" alert sits there forever even after it stops being
  // true, and staff end up re-checking cases that already fixed themselves.
  const staleAlerts = await prisma.membreControlAlert.findMany({
    where: {
      status: "OUVERT",
      membre: {
        OR: [
          { status: { not: "ACTIF" } },
          { deletedAt: { not: null } },
          { cotisations: { some: { status: { not: "ANNULEE" } } } },
        ],
      },
    },
    select: { id: true },
  })
  if (staleAlerts.length > 0) {
    await prisma.membreControlAlert.updateMany({
      where: { id: { in: staleAlerts.map(a => a.id) } },
      data:  { status: "RESOLU", resolvedAt: new Date(), autoResolved: true, note: AUTO_RESOLVE_NOTE },
    })
  }

  const candidates = await prisma.membre.findMany({
    where: {
      status:    "ACTIF",
      deletedAt: null,
      // updatedAt, not createdAt: a member approved from PENDING to ACTIF after sitting for
      // weeks bumps updatedAt to that moment, so it still gets the full 30-minute grace period
      // before being flagged — using createdAt here would flag it on the very next sweep,
      // right when an admin just acted on it. updatedAt is always >= createdAt (Prisma sets
      // both on insert), so this also covers the brand-new-member case exactly as before.
      updatedAt: { lte: cutoff },
      // "none" over a sub-filter, not "none: {}": a Cotisation that was created and then
      // cancelled (ANNULEE) still counts as "no valid billing" — checking for zero rows at
      // all let a cancelled-and-never-redone cotisation mask the alert forever.
      cotisations:  { none: { status: { not: "ANNULEE" } } },
      controlAlert: null,
    },
    select: {
      id:            true,
      associationId: true,
      firstName:     true,
      lastName:      true,
      createdAt:     true,
      association:   { select: { name: true } },
    },
  })

  // Individual create + catch the unique-constraint violation, rather than createMany +
  // skipDuplicates: this is the only way to know exactly which rows THIS run inserted, which
  // is also exactly what the staff email must list. With createMany there's no way to tell
  // inserted from skipped, so two overlapping sweep invocations (Vercel Cron doesn't
  // guarantee mutual exclusion) could both read the same candidates and both email about them.
  const raised: typeof candidates = []
  for (const candidate of candidates) {
    try {
      await prisma.membreControlAlert.create({ data: { membreId: candidate.id, associationId: candidate.associationId } })
      raised.push(candidate)
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue
      throw error
    }
  }

  if (raised.length > 0) await notifyStaffOfControlAlerts(raised)

  return NextResponse.json({ raised: raised.length, autoResolved: staleAlerts.length })
}
