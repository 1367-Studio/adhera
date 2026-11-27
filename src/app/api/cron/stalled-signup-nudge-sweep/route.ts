import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { stalledSignupPaperFormEmail, stalledSignupMembershipFormEmail, stalledSignupGenericEmail } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { pusherServer } from "@/lib/pusher-server"
import { APP_URL } from "@/lib/env"
import { reportError } from "@/lib/monitoring"

// FORM-130 — traced from two real organic trials (ACFOM, Dac Academy) via ActivityLog: both
// did genuine setup work (accounting exercise, membership form, paper form template, branding)
// in a single session, then stalled right before importing their real member base, and the
// trial just expired in silence. This sweep catches that exact stall and nudges the admin back
// to the specific unfinished step, instead of relying on the generic adminWelcomeEmail.
// Vercel Cron always invokes the configured path with GET — this must stay a GET handler or
// the schedule silently 405s on every tick. POST is also exported for manual curl testing.

const STALL_MEMBRE_THRESHOLD = 2
const MS_HOUR = 60 * 60 * 1000

const DAY2_ACTION  = "STALLED_SIGNUP_NUDGE_SENT"
const FINAL_ACTION = "STALLED_SIGNUP_NUDGE_FINAL_SENT"

type NudgeAction = typeof DAY2_ACTION | typeof FINAL_ACTION

type Candidate = { id: string; name: string; slug: string }

async function billingAdmins(associationId: string) {
  return prisma.user.findMany({
    where:  { associationId, role: { in: ["ADMIN", "PRESIDENT"] }, active: true },
    select: { id: true, email: true },
  })
}

async function notifyAdmins(associationId: string, admins: { id: string }[], n: { title: string; body: string; link: string }) {
  await prisma.notification.createMany({
    data: admins.map(a => ({ userId: a.id, title: n.title, body: n.body, link: n.link, scope: "GESTION" as const })),
  })
  await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {}).catch(() => {})
}

// A candidate is "stalled" when it still has barely any real members AND the admin did more
// than just register. /api/register always writes exactly 2 ActivityLog rows itself
// (ASSOCIATION_REGISTERED + the founder's own MEMBRE_CREATED) for every single signup, with
// zero further action — so the threshold must be > 2, not > 1, or this never actually filters
// out the signups that never came back at all (a different problem, out of scope here).
async function isStalled(associationId: string): Promise<boolean> {
  const [membresCount, activityCount] = await Promise.all([
    prisma.membre.count({ where: { associationId } }),
    prisma.activityLog.count({ where: { associationId } }),
  ])
  return membresCount <= STALL_MEMBRE_THRESHOLD && activityCount > 2
}

async function alreadySent(associationId: string, action: NudgeAction): Promise<boolean> {
  const row = await prisma.activityLog.findFirst({ where: { associationId, action, entityId: associationId }, select: { id: true } })
  return row != null
}

// Picks the one template that matches what the admin actually started — see FORM-130's
// three fixed templates in src/lib/email.ts. Priority: a PaperFormTemplate (explicit intent
// to digitize a real roster) outranks a published MembershipForm, which outranks the generic
// fallback for an admin who configured something else entirely (branding, cotisation default).
async function sendNudge(assoc: Candidate, action: NudgeAction): Promise<void> {
  const admins = await billingAdmins(assoc.id)
  if (!admins.length) return

  const [paperForm, membershipForm] = await Promise.all([
    prisma.paperFormTemplate.findFirst({
      where:   { associationId: assoc.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select:  { name: true },
    }),
    prisma.membershipForm.findFirst({
      where:   { associationId: assoc.id, status: "PUBLISHED" },
      orderBy: { createdAt: "desc" },
      select:  { id: true, title: true, slug: true },
    }),
  ])

  let template: string
  let buildEmail: (email: string) => { to: string; subject: string; html: string }
  let notif: { title: string; body: string; link: string }

  if (paperForm) {
    template = "paper_form"
    const importUrl = `${APP_URL}/dashboard/membres/import-fiches`
    buildEmail = email => stalledSignupPaperFormEmail({ email, associationName: assoc.name, templateName: paperForm.name, importUrl })
    notif = {
      title: "Importez vos membres",
      body:  `Votre modèle « ${paperForm.name} » est prêt — il ne manque plus que l'import.`,
      link:  "/dashboard/membres/import-fiches",
    }
  } else if (membershipForm) {
    template = "membership_form"
    // The email's CTA is "share it" — that has to be the actual public page the admin would
    // forward, not the admin edit screen (which doesn't expose a copyable link by itself,
    // and would just add another click of friction on top of the one that caused the stall).
    // The in-app Notification link below stays on the admin edit screen instead, since
    // that's the useful landing spot once already logged into the dashboard.
    const formUrl = `${APP_URL}/${assoc.slug}/adhesion/${membershipForm.slug}`
    buildEmail = email => stalledSignupMembershipFormEmail({ email, associationName: assoc.name, formTitle: membershipForm.title, formUrl })
    notif = {
      title: "Votre formulaire d'adhésion attend ses premiers inscrits",
      body:  membershipForm.title,
      link:  `/dashboard/adhesions/${membershipForm.id}`,
    }
  } else {
    template = "generic"
    const dashboardUrl = `${APP_URL}/dashboard`
    buildEmail = email => stalledSignupGenericEmail({ email, associationName: assoc.name, dashboardUrl })
    notif = {
      title: "Reprenez où vous en étiez",
      body:  `${assoc.name} n'a encore aucun membre réel.`,
      link:  "/dashboard",
    }
  }

  for (const admin of admins) {
    if (!admin.email) continue
    await sendEmail(buildEmail(admin.email), { associationId: assoc.id, source: action, sourceId: assoc.id })
      .catch(error => reportError(error, { area: "email", action: "cron.stalled-signup-nudge", extra: { associationId: assoc.id, template } }))
  }
  await notifyAdmins(assoc.id, admins, notif)
  await writeActivityLog({ associationId: assoc.id, action, entity: "Association", entityId: assoc.id, metadata: { template } })
}

async function handler(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron/stalled-signup-nudge-sweep] CRON_SECRET is not configured — refusing to run")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()

  const [day2Pool, finalPool] = await Promise.all([
    prisma.association.findMany({
      where: {
        subscriptionStatus: "TRIAL",
        createdAt: { gte: new Date(now.getTime() - 48 * MS_HOUR), lte: new Date(now.getTime() - 24 * MS_HOUR) },
      },
      select: { id: true, name: true, slug: true },
    }),
    prisma.association.findMany({
      where: {
        subscriptionStatus: "TRIAL",
        trialEndsAt: { gte: now, lte: new Date(now.getTime() + 72 * MS_HOUR) },
      },
      select: { id: true, name: true, slug: true },
    }),
  ])

  let day2Sent = 0
  for (const assoc of day2Pool) {
    if (await alreadySent(assoc.id, DAY2_ACTION)) continue
    if (!(await isStalled(assoc.id))) continue
    await sendNudge(assoc, DAY2_ACTION)
    day2Sent++
  }

  let finalSent = 0
  for (const assoc of finalPool) {
    if (await alreadySent(assoc.id, FINAL_ACTION)) continue
    if (!(await isStalled(assoc.id))) continue
    await sendNudge(assoc, FINAL_ACTION)
    finalSent++
  }

  return NextResponse.json({ day2Sent, finalSent })
}

export const GET = handler
export const POST = handler
