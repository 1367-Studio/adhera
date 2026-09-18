import { NextResponse } from "next/server"
import { z } from "zod"
import Stripe from "stripe"
import { Prisma, type BoutiquePaymentMethod } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { stripe } from "@/lib/stripe"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { sendEmail } from "@/lib/mail"
import { boutiqueRefundEmail } from "@/lib/email"
import { pusherServer } from "@/lib/pusher-server"

// Narrower than boutique/commandes/[id]/route.ts's MANAGERS (which includes SECRETAIRE) —
// refunding money is a step up from managing orders, same role set as dons/[id]/encaisser.
const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

// Target quantities, not deltas — an item not listed keeps its current quantity. Every item
// at 0 is a full-order refund/cancel; anything else is a partial refund of just those units.
const bodySchema = z.object({
  items: z.array(z.object({ id: z.string(), quantity: z.number().int().min(0) })),
})

// Both boutique Income-creation call sites (webhook + dashboard PATCH) always write one of
// these two description prefixes — see LEGACY_BOUTIQUE_DESCRIPTION in
// src/lib/finance/income-statement.ts for the same convention used the other direction.
// categoryId alone can't distinguish a shipping row from a null-category product row (both
// have categoryId: null), so the description prefix is the only reliable signal.
const SHIPPING_INCOME_DESCRIPTION = /^Frais de livraison/

// Thrown (and caught) purely to abort the transaction below with a specific HTTP status —
// never actually surfaced past this file. A double-submit racing this same refund lands on
// OrderNotPayable (the loser's fresh re-read sees the winner's already-committed CANCELLED
// status, or — under Serializable isolation — its own read is invalidated by the winner's
// concurrent write and Prisma reports it as P2034 instead; both are handled below).
class OrderNotPayableError extends Error {}
class InvalidQuantityError extends Error {}
class NoChangeError extends Error {}
class ClosedExerciceError extends Error {}

type RefundResult = {
  refundCents:  number
  allItemsZero: boolean
  changedItems: { produitName: string; refundedQty: number; unitPrice: number }[]
  paymentMethod: BoutiquePaymentMethod
  snapshot: {
    items:       { id: string; quantity: number }[]
    incomes:     { id: string; amount: Prisma.Decimal; status: "PENDING" | "PAID" | "CANCELLED" }[]
    totalAmount: number
    status:      "PENDING" | "PAID" | "CANCELLED"
  }
  restockDeltas: { varianteId: string; delta: number }[]
}

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const body   = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  // Plain local so the applyRefund closure below keeps TS's narrowing — parsed.data accessed
  // through the `parsed` binding itself doesn't narrow inside a nested function declaration.
  const requestedItems = parsed.data.items

  // Scope + 404 check only — deliberately not used for anything that a concurrent request
  // could also be changing (items, totalAmount, status). Those are re-read fresh inside the
  // transaction below, which is what lets Serializable isolation actually catch a race
  // between two refund requests for the same commande (see the P2034 catch further down).
  const exists = await prisma.boutiqueCommande.findFirst({
    where:  { id, associationId: ctx.associationId },
    select: {
      id: true, paymentMethod: true, guestName: true, guestEmail: true, membreId: true,
      membre: { select: { firstName: true, lastName: true, user: { select: { email: true } } } },
    },
  })
  if (!exists) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  async function applyRefund(tx: Prisma.TransactionClient): Promise<RefundResult> {
    const commande = await tx.boutiqueCommande.findUniqueOrThrow({
      where:   { id },
      include: { items: { include: { produit: { select: { name: true } } } } },
    })
    if (commande.status !== "PAID") throw new OrderNotPayableError()

    const targetQty = new Map(commande.items.map(i => [i.id, i.quantity]))
    for (const upd of requestedItems) {
      const current = targetQty.get(upd.id)
      if (current === undefined) continue // item doesn't belong to this commande — ignore
      if (upd.quantity > current) throw new InvalidQuantityError()
      targetQty.set(upd.id, upd.quantity)
    }

    const changedItems = commande.items.filter(i => targetQty.get(i.id)! < i.quantity)
    if (changedItems.length === 0) throw new NoChangeError()

    const allItemsZero  = commande.items.every(i => (targetQty.get(i.id) ?? 0) === 0)
    const itemRefundCts = changedItems.reduce((sum, i) => sum + i.unitPrice * (i.quantity - targetQty.get(i.id)!), 0)
    const refundCents   = itemRefundCts + (allItemsZero ? commande.shippingCost : 0)

    const existingIncomes = await tx.income.findMany({ where: { commandeId: id, status: "PAID" } })

    // Block refunding into an already-closed fiscal period — same spirit as
    // closedExerciceGuard's use elsewhere, applied by hand here since these Income rows
    // already exist (there's nothing left to "create" for that helper's usual call shape).
    const exerciceIds = [...new Set(existingIncomes.map(i => i.exerciceId).filter((x): x is string => !!x))]
    if (exerciceIds.length) {
      const exercices = await tx.exerciceComptable.findMany({ where: { id: { in: exerciceIds } }, select: { status: true } })
      if (exercices.some(e => e.status === "CLOTURE")) throw new ClosedExerciceError()
    }

    const shippingIncome = existingIncomes.find(i => SHIPPING_INCOME_DESCRIPTION.test(i.description ?? ""))
    const productIncomes = existingIncomes.filter(i => i !== shippingIncome)

    // Snapshot of everything below is about to touch — restored verbatim by rollback() if a
    // STRIPE refund call fails after this transaction already committed. Mirrors
    // cancel-ticket's claim-then-revert-on-Stripe-failure shape, just with more moving parts
    // (several Income rows + item quantities instead of one field).
    const snapshot = {
      items:       commande.items.map(i => ({ id: i.id, quantity: i.quantity })),
      incomes:     existingIncomes.map(i => ({ id: i.id, amount: i.amount, status: i.status })),
      totalAmount: commande.totalAmount,
      status:      commande.status,
    }

    const restockDeltas: { varianteId: string; delta: number }[] = []
    for (const item of changedItems) {
      const newQty = targetQty.get(item.id)!
      const delta  = item.quantity - newQty
      await tx.boutiqueCommandeItem.update({ where: { id: item.id }, data: { quantity: newQty } })
      await tx.boutiqueVariante.update({ where: { id: item.varianteId }, data: { stock: { increment: delta } } })
      restockDeltas.push({ varianteId: item.varianteId, delta })
    }

    // Recompute each category's Income total from the items that remain after this refund —
    // same aggregation shape as the PAID-transition code that originally created these rows
    // (see webhook/stripe/route.ts and boutique/commandes/[id]/route.ts).
    const remaining  = commande.items.map(i => ({ ...i, quantity: targetQty.get(i.id)! })).filter(i => i.quantity > 0)
    const byCategory = new Map<string | null, number>()
    for (const item of remaining) {
      byCategory.set(item.categoryId, (byCategory.get(item.categoryId) ?? 0) + item.unitPrice * item.quantity)
    }
    for (const income of productIncomes) {
      const newAmountCts = byCategory.get(income.categoryId) ?? 0
      if (newAmountCts > 0) {
        await tx.income.update({ where: { id: income.id }, data: { amount: newAmountCts / 100 } })
      } else {
        // Soft-cancel, not delete — keeps the row for the audit trail, same convention as
        // every other refund path in Finances (Don, Cotisation, full-order webhook refund).
        await tx.income.update({ where: { id: income.id }, data: { status: "CANCELLED" } })
      }
    }

    if (allItemsZero && shippingIncome) {
      await tx.income.update({ where: { id: shippingIncome.id }, data: { status: "CANCELLED" } })
    }

    await tx.boutiqueCommande.update({
      where: { id },
      data: {
        totalAmount: Math.max(0, commande.totalAmount - refundCents),
        ...(allItemsZero ? { status: "CANCELLED" as const } : {}),
      },
    })

    return {
      refundCents,
      allItemsZero,
      changedItems: changedItems.map(item => ({
        produitName: item.produit.name,
        refundedQty: item.quantity - targetQty.get(item.id)!,
        unitPrice:   item.unitPrice,
      })),
      paymentMethod: commande.paymentMethod,
      snapshot,
      restockDeltas,
    }
  }

  let result: RefundResult
  try {
    result = await prisma.$transaction(applyRefund, { isolationLevel: "Serializable" })
  } catch (err) {
    if (err instanceof OrderNotPayableError)
      return NextResponse.json({ error: "Cette commande n'est plus remboursable (déjà annulée, ou remboursée entre-temps)." }, { status: 409 })
    if (err instanceof InvalidQuantityError)
      return NextResponse.json({ error: "Impossible d'augmenter la quantité d'un article remboursé." }, { status: 422 })
    if (err instanceof NoChangeError)
      return NextResponse.json({ error: "Aucune quantité à rembourser." }, { status: 422 })
    if (err instanceof ClosedExerciceError)
      return NextResponse.json({ error: "Cet exercice est clôturé — impossible de rembourser cette commande." }, { status: 409 })
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034")
      return NextResponse.json({ error: "Une autre opération est en cours sur cette commande — réessayez." }, { status: 409 })
    throw err
  }

  async function rollback() {
    await prisma.$transaction([
      ...result.snapshot.items.map(i => prisma.boutiqueCommandeItem.update({ where: { id: i.id }, data: { quantity: i.quantity } })),
      ...result.snapshot.incomes.map(i => prisma.income.update({ where: { id: i.id }, data: { amount: i.amount, status: i.status } })),
      prisma.boutiqueCommande.update({ where: { id }, data: { totalAmount: result.snapshot.totalAmount, status: result.snapshot.status } }),
      ...result.restockDeltas.map(r => prisma.boutiqueVariante.update({ where: { id: r.varianteId }, data: { stock: { decrement: r.delta } } })),
    ])
  }

  if (result.paymentMethod === "STRIPE") {
    // BoutiqueCommande.stripePaymentIntentId is, despite its name, a Checkout Session id
    // (see public/[slug]/boutique/checkout and portal/boutique/checkout) — the real
    // PaymentIntent id lives on Income.reference instead, written by the webhook at payment
    // time and identical across every Income row this commande produced.
    const referenceRow = await prisma.income.findFirst({ where: { commandeId: id, reference: { not: null } }, select: { reference: true } })
    const paymentIntentId = referenceRow?.reference
    if (!paymentIntentId) {
      await rollback()
      return NextResponse.json({ error: "Paiement Stripe introuvable pour cette commande." }, { status: 422 })
    }

    // Deterministic from the exact refund being requested (amount + which items changed by
    // how much) — a retry of this same call reuses the key so Stripe dedupes it, while a
    // later, different partial refund on the same commande naturally gets its own key.
    const idempotencyKey = `commande-refund-${id}-${result.refundCents}-${result.changedItems.map(i => `${i.produitName}:${i.refundedQty}`).sort().join(",")}`

    try {
      await stripe.refunds.create({
        payment_intent:         paymentIntentId,
        amount:                 result.refundCents,
        reverse_transfer:       true,
        refund_application_fee: true,
        // Lets the charge.refunded webhook (webhook/stripe/route.ts) recognize this refund
        // as already reconciled by this route — without it, that webhook's partial-refund
        // safety net would redundantly re-apply the same Income/totalAmount adjustment a
        // second time when this refund's own event arrives.
        metadata: { source: "boutique-refund-route" },
      }, { idempotencyKey })
    } catch (err) {
      await rollback()
      console.error(`[boutique-refund] Stripe refund failed for commande ${id}:`, err)
      const message = err instanceof Stripe.errors.StripeError
        ? err.message
        : "Le remboursement a échoué. Réessayez dans quelques instants ou contactez le support."
      return NextResponse.json({ error: message }, { status: 502 })
    }
  }

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "COMMANDE_REFUNDED",
    entity:        "BoutiqueCommande",
    entityId:      id,
    metadata:      { paymentMethod: result.paymentMethod, amount: result.refundCents / 100, partial: !result.allItemsZero },
  })

  const admins = await prisma.user.findMany({
    where:  { associationId: ctx.associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"] }, active: true },
    select: { id: true },
  })
  if (admins.length) {
    const amountLabel = (result.refundCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
    await prisma.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        title:  result.allItemsZero ? "Commande boutique remboursée" : "Remboursement partiel — commande boutique",
        body:   `${amountLabel} ont été remboursés pour cette commande.`,
        link:   `/dashboard/boutique?tab=commandes&commandeId=${id}`,
        scope:  "GESTION",
      })),
      skipDuplicates: true,
    })
    await pusherServer.trigger(`private-association-${ctx.associationId}`, "new-notification", {}).catch(() => {})
  }

  const recipientEmail = exists.membre?.user?.email ?? exists.guestEmail
  const recipientFirstName = exists.membre?.firstName ?? exists.guestName?.split(" ")[0] ?? "Client"
  if (recipientEmail) {
    const association = await prisma.association.findUnique({
      where:  { id: ctx.associationId },
      select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true },
    })
    sendEmail({
      ...boutiqueRefundEmail({
        firstName:       recipientFirstName,
        email:           recipientEmail,
        associationName: association?.name ?? "",
        refundedAmount:  result.refundCents,
        fullyCancelled:  result.allItemsZero,
        items: result.changedItems.map(item => ({
          name:      item.produitName,
          quantity:  item.refundedQty,
          unitPrice: item.unitPrice,
        })),
        branding: association ? resolveDocumentBranding(association) : undefined,
      }),
    }, { associationId: ctx.associationId, membreId: exists.membreId ?? undefined, source: "TRANSACTION", sourceId: id })
      .catch(err => console.error(`[boutique-refund] failed to email buyer for commande ${id}:`, err))
  }

  const updated = await prisma.boutiqueCommande.findUnique({
    where:   { id },
    include: {
      membre: { select: { firstName: true, lastName: true, email: true } },
      items:  {
        include: {
          produit:  { select: { name: true, imageUrl: true } },
          variante: { select: { label: true, price: true } },
        },
      },
    },
  })
  return NextResponse.json(updated)
})
