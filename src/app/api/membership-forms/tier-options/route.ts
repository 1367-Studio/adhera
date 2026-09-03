import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

// Same role set as POST /api/membres — this feeds the tarif picker in the dashboard's
// add-member modal, so whoever can create a member must be able to list the choices
// (notably SECRETAIRE, who is excluded from the FINANCE-gated /api/membership-forms GET).
const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

// Tarifs an admin can charge through the "créer le membre, il paie de son côté" flow:
// published forms only, and only plain one-off fixed-price adhésion tiers — RECURRING needs
// a Stripe subscription the tokenized payment page doesn't do, free/freeAmount have no fixed
// amount to put on a payment link, ADDON/DONATION aren't adhésions at all.
export const GET = withAdminAuth(async (_req, ctx) => {
  const tiers = await prisma.membershipTier.findMany({
    where: {
      itemType:   "MEMBERSHIP",
      kind:       "ONE_OFF",
      free:       false,
      freeAmount: false,
      amount:     { not: null },
      form:       { associationId: ctx.associationId, status: "PUBLISHED" },
    },
    orderBy: [{ form: { createdAt: "desc" } }, { order: "asc" }],
    select:  {
      id:     true,
      label:  true,
      amount: true,
      form:   { select: { title: true } },
    },
  })

  return NextResponse.json({
    tiers: tiers.map(t => ({
      id:        t.id,
      label:     t.label,
      amount:    Number(t.amount),
      formTitle: t.form.title,
    })),
  })
}, { roles: MANAGERS, module: "cotisations" })
