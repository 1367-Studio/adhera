import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"
import { withAdminAuth } from "@/lib/api-wrapper"
import { nextBoutiqueReceiptNumber } from "@/lib/document-numbering"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE", "TRESORIER"]

const updateSchema = z.object({
  status:            z.enum(["PENDING", "PAID", "CANCELLED"]),
  note:              z.string().trim().max(500).optional().nullable(),
  items:             z.array(z.object({ id: z.string(), quantity: z.number().int().min(0) })).optional(),
  manualPaymentType: z.enum(["ESPECES", "CHEQUE", "CB", "VIREMENT"]).optional(),
})

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const commande = await prisma.boutiqueCommande.findFirst({
    where:   { id, associationId: ctx.associationId },
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
  if (!commande) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  return NextResponse.json(commande)
})

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const commande = await prisma.boutiqueCommande.findFirst({
    where:  { id, associationId: ctx.associationId },
    select: { id: true, status: true, totalAmount: true, paymentMethod: true, manualPaymentType: true, membreId: true, membre: { select: { firstName: true, lastName: true } } },
  })
  if (!commande) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { status, note, items: itemUpdates, manualPaymentType } = parsed.data

  // A PAID MANUAL order can still have its payment sub-type corrected (e.g. the admin
  // picked "Chèque" when it was actually "Espèces") without reopening the order itself —
  // nothing else about a settled sale is editable through this route. This does NOT touch
  // the Income row(s) already posted to Finances; those are the system of record for
  // accounting and are corrected there directly, same as any other financial entry.
  const isPaymentTypeCorrection =
    commande.status === "PAID" &&
    status === "PAID" &&
    commande.paymentMethod === "MANUAL" &&
    !!manualPaymentType &&
    !itemUpdates?.length &&
    note === undefined

  if (commande.status === "CANCELLED")
    return NextResponse.json({ error: "Impossible de modifier une commande annulée" }, { status: 422 })
  if (commande.status === "PAID" && !isPaymentTypeCorrection)
    return NextResponse.json({ error: "Impossible de modifier une commande déjà payée" }, { status: 422 })
  if (!isPaymentTypeCorrection && commande.status === status)
    return NextResponse.json({ error: "Statut déjà appliqué" }, { status: 422 })
  if (!isPaymentTypeCorrection && status === "PAID" && commande.paymentMethod === "MANUAL" && !manualPaymentType)
    return NextResponse.json({ error: "Le moyen de paiement est requis" }, { status: 422 })

  if (isPaymentTypeCorrection) {
    // No-op guard: re-saving the same value (e.g. re-opening the modal and clicking
    // "Enregistrer" without changing the selection) shouldn't write a redundant activity
    // log entry claiming a correction happened.
    if (manualPaymentType !== commande.manualPaymentType) {
      await prisma.boutiqueCommande.update({ where: { id }, data: { manualPaymentType } })
      await writeActivityLog({
        associationId: ctx.associationId,
        actorId:       ctx.userId,
        action:        "BOUTIQUE_COMMANDE_UPDATED",
        entity:        "BoutiqueCommande",
        entityId:      id,
        label:         `Moyen de paiement corrigé → ${manualPaymentType}`,
      })
    }
    const corrected = await prisma.boutiqueCommande.findUnique({
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
    return NextResponse.json(corrected)
  }

  try {
    // Retried up to 5x on a receiptNumber collision, same pattern as the Devis/Facture
    // numbering call sites — the whole attempt (including the status flip) is one
    // interactive transaction, so a collision rolls everything back and the next attempt
    // starts clean with a freshly computed number, instead of surfacing a raw 422 that
    // forces the admin to manually retry the whole "Encaisser" action.
    for (let attempt = 0; attempt < 5; attempt++) {
      const receiptNumber = status === "PAID" ? await nextBoutiqueReceiptNumber(ctx.associationId) : undefined
      // Set once alongside receiptNumber and kept out of `note`/`manualPaymentType`-only
      // updates (e.g. the payment-type correction flow above) — see paidAt's schema comment.
      const paidAt = status === "PAID" ? new Date() : undefined

      try {
        await prisma.$transaction(async tx => {
          // Adjust item quantities for manual payments being marked as PAID
          if (itemUpdates?.length && status === "PAID" && commande.paymentMethod === "MANUAL") {
            const currentItems = await tx.boutiqueCommandeItem.findMany({
              where:  { commandeId: id },
              select: { id: true, quantity: true, unitPrice: true, varianteId: true },
            })

            let newTotal = 0
            for (const upd of itemUpdates) {
              const cur = currentItems.find(i => i.id === upd.id)
              if (!cur) continue
              const newQty = Math.min(Math.max(0, upd.quantity), cur.quantity)
              if (newQty < cur.quantity) {
                await tx.boutiqueVariante.update({
                  where: { id: cur.varianteId },
                  data:  { stock: { increment: cur.quantity - newQty } },
                })
                await tx.boutiqueCommandeItem.update({
                  where: { id: upd.id },
                  data:  { quantity: newQty },
                })
              }
              newTotal += cur.unitPrice * newQty
            }

            if (newTotal === 0)
              throw new Error("Le montant encaissé ne peut pas être nul — annulez la commande si aucun article n'a été retiré")

            await tx.boutiqueCommande.update({ where: { id }, data: { totalAmount: newTotal } })
          }

          await tx.boutiqueCommande.update({
            where: { id },
            data:  {
              status,
              ...(note !== undefined ? { note: note ?? null } : {}),
              ...(manualPaymentType ? { manualPaymentType } : {}),
              ...(receiptNumber ? { receiptNumber } : {}),
              ...(paidAt ? { paidAt } : {}),
            },
          })

          // On cancel: restore current stock quantities
          if (status === "CANCELLED") {
            const currentItems = await tx.boutiqueCommandeItem.findMany({ where: { commandeId: id } })
            for (const item of currentItems) {
              if (item.quantity > 0) {
                await tx.boutiqueVariante.update({
                  where: { id: item.varianteId },
                  data:  { stock: { increment: item.quantity } },
                })
              }
            }
          }

          if (status === "PAID") {
            const paidItems = await tx.boutiqueCommandeItem.findMany({
              where:  { commandeId: id, quantity: { gt: 0 } },
              select: { quantity: true, unitPrice: true, categoryId: true, produit: { select: { name: true } } },
            })

            // One Income row per accounting category — a mixed-category order posts
            // several partial rows instead of forcing one row into a single category. Grouped
            // by the category snapshot taken when the item was ordered, not the product's
            // current category, so recategorizing a product doesn't retroactively change how
            // an already-placed order books once it's encaissé.
            const byCategory = new Map<string | null, { amount: number; names: Set<string> }>()
            for (const item of paidItems) {
              const key   = item.categoryId
              const group = byCategory.get(key) ?? { amount: 0, names: new Set<string>() }
              group.amount += item.unitPrice * item.quantity
              group.names.add(item.produit.name)
              byCategory.set(key, group)
            }

            const buyerLabel          = commande.membre ? `${commande.membre.firstName} ${commande.membre.lastName}` : null
            const incomePaymentMethod = commande.paymentMethod === "STRIPE" ? "STRIPE" : manualPaymentType

            for (const [categoryId, group] of byCategory) {
              const itemsLabel = [...group.names].join(", ")
              await tx.income.create({
                data: {
                  associationId: ctx.associationId,
                  memberId:      commande.membreId ?? undefined,
                  amount:        group.amount / 100,
                  categoryId:    categoryId ?? undefined,
                  description:   buyerLabel ? `Vente boutique — ${buyerLabel} — ${itemsLabel}` : `Vente boutique — ${itemsLabel}`,
                  paymentMethod: incomePaymentMethod,
                  source:        "MANUAL",
                  status:        "PAID",
                  // Non-null: this branch only runs when status === "PAID", which is what
                  // makes `paidAt` (declared above, keyed off the same condition) a Date.
                  date:          paidAt!,
                },
              })
            }
          }
        })
        break
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && attempt < 4) continue
        throw err
      }
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur" }, { status: 422 })
  }

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "BOUTIQUE_COMMANDE_UPDATED",
    entity:        "BoutiqueCommande",
    entityId:      id,
    label:         `Statut → ${status}`,
  })

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
