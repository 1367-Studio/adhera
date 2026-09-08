import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"

// Cancels abandoned "pay on pickup" storefront orders and restores their stock. Scoped
// deliberately narrow — PENDING + MANUAL + STOREFRONT + no membreId — because this is the
// one order type with no built-in expiry: a Stripe checkout releases its stock hold itself
// via `checkout.session.expired` (30 min), and a portal member's own MANUAL order is tied to
// an identifiable, accountable account. An anonymous storefront guest can otherwise reserve
// stock under a made-up name/email and never show up, silently locking inventory. 48h gives
// a genuine pickup arrangement (e.g. "I'll swing by this weekend") room to still land, while
// bounding how long a fake reservation can sit.
// Runs daily, clustered with the other early-morning crons in vercel.json.
const ABANDON_AFTER_MS = 48 * 60 * 60 * 1000

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron/boutique-storefront-sweep] CRON_SECRET is not configured — refusing to run")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - ABANDON_AFTER_MS)

  const abandoned = await prisma.boutiqueCommande.findMany({
    where: {
      status:        "PENDING",
      paymentMethod: "MANUAL",
      source:        "STOREFRONT",
      membreId:      null,
      createdAt:     { lt: cutoff },
    },
    select: { id: true, associationId: true, items: { select: { varianteId: true, quantity: true } } },
  })

  let cancelled = 0
  for (const commande of abandoned) {
    // Same "on cancel: restore stock" logic as the admin PATCH route
    // (src/app/api/boutique/commandes/[id]/route.ts) — status flip and stock restore in one
    // transaction so a failure partway through doesn't leave stock silently un-restored.
    const { count } = await prisma.$transaction(async tx => {
      const result = await tx.boutiqueCommande.updateMany({
        where: { id: commande.id, status: "PENDING" },
        data:  { status: "CANCELLED" },
      })
      if (result.count === 0) return { count: 0 }
      for (const item of commande.items) {
        await tx.boutiqueVariante.update({
          where: { id: item.varianteId },
          data:  { stock: { increment: item.quantity } },
        })
      }
      return result
    })
    if (count === 0) continue
    cancelled++
    await writeActivityLog({
      associationId: commande.associationId,
      action:        "BOUTIQUE_COMMANDE_UPDATED",
      entity:        "BoutiqueCommande",
      entityId:      commande.id,
      label:         "Annulée automatiquement (retrait jamais confirmé après 48h)",
    })
  }

  return NextResponse.json({ cancelled })
}
