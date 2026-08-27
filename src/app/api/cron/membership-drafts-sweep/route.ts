import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"

// Deletes MembershipCheckoutDraft rows (see checkout/route.ts's "Ajouter un autre adhérent"
// multi-registrant flow) that were never consumed and are now past expiresAt — an abandoned
// checkout (closed tab, expired Stripe session, someone who just changed their mind) shouldn't
// sit in the table forever. Never touches a consumed row (consumedAt set): those are the
// permanent record of what a real payment/signup actually contained.
// Runs daily, clustered with the other early-morning crons in vercel.json.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron/membership-drafts-sweep] CRON_SECRET is not configured — refusing to run")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { count } = await prisma.membershipCheckoutDraft.deleteMany({
    where: { consumedAt: null, expiresAt: { lt: new Date() } },
  })

  return NextResponse.json({ deleted: count })
}
