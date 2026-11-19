import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { parseDashboardActionSnoozes } from "@/lib/dashboard-actions"

const snoozeSchema = z.object({
  actionKey: z.string().min(1),
  // Plain YYYY-MM-DD, same contract as DateField's onChange value — null cancels an active
  // snooze instead of setting one (the panel's "Annuler le report" action).
  until:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
})

// Snoozing is a personal dashboard preference, not an edit to the underlying dossier (the
// cotisation/membre/don rows it hides are untouched) — "read" on dashboard is enough, same
// reasoning as dashboardLayout's own save action needing no area gate at all.
export const POST = withAdminAuth(async (req, ctx) => {
  const body = await req.json()
  const parsed = snoozeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { dashboardActionSnoozes: true } })
  const snoozed = parseDashboardActionSnoozes(user?.dashboardActionSnoozes)

  if (parsed.data.until === null) {
    delete snoozed[parsed.data.actionKey]
  } else {
    // Start of the chosen day, not end of it: the ticket's own wording is "réapparaît à
    // cette date" — snoozing until the 20th must make the row visible again ON the 20th, not
    // only from the 21st. Storing end-of-day would hide it through the entire chosen date too.
    snoozed[parsed.data.actionKey] = new Date(`${parsed.data.until}T00:00:00.000Z`).toISOString()
  }

  await prisma.user.update({ where: { id: ctx.userId }, data: { dashboardActionSnoozes: snoozed } })

  return NextResponse.json({ ok: true })
}, { area: "dashboard", access: "read" })
