// src/app/api/finances/immobilisations/route.ts
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { immobilisationSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { postImmobilisationAcquisition } from "@/lib/finance/journal/post-facture-recue-payment"

// FORM-107 Fase 2/3 — scoped to this one asset class (see immobilisationSchema's doc comment).
const ASSET_ACCOUNT_CODE        = "218300"
const DEPRECIATION_ACCOUNT_CODE = "281830"
const EXPENSE_ACCOUNT_CODE      = "681120"

export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const immobilisations = await prisma.immobilisation.findMany({
    where:   { associationId },
    include: {
      depreciations: { orderBy: { exercice: { startDate: "asc" } } },
      expense:       { select: { id: true, description: true, vendor: true } },
      factureRecue:  { select: { id: true, number: true, amount: true, amountPaid: true } },
    },
    orderBy: { acquisitionDate: "desc" },
  })
  return NextResponse.json(immobilisations)
}, { area: "comptabilite", module: "finances" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = immobilisationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { label, expenseId, factureRecueId, residualValue, acquisitionDate, usageStartDate, usefulLifeMonths } = parsed.data

  let entryValue: number
  let createData: { expenseId?: string; factureRecueId?: string }

  if (expenseId) {
    const expense = await prisma.expense.findFirst({
      where:   { id: expenseId, associationId },
      include: { category: true, immobilisation: true },
    })
    if (!expense) return NextResponse.json({ error: "Dépense introuvable" }, { status: 404 })
    if (!expense.isImmobilisation) {
      return NextResponse.json({ error: "Cette dépense n'est pas marquée comme immobilisation." }, { status: 422 })
    }
    if (expense.immobilisation) {
      return NextResponse.json({ error: "Cette dépense est déjà liée à une immobilisation." }, { status: 409 })
    }
    if (expense.category?.accountingCode !== ASSET_ACCOUNT_CODE) {
      return NextResponse.json({
        error: `Seul le matériel de bureau et informatique (${ASSET_ACCOUNT_CODE}) est pris en charge pour le moment — la catégorie de cette dépense doit pointer vers ce compte.`,
      }, { status: 422 })
    }
    entryValue = Number(expense.amount)
    createData = { expenseId }
  } else {
    const factureRecue = await prisma.factureRecue.findFirst({
      where:   { id: factureRecueId, associationId, deletedAt: null },
      include: { immobilisation: true },
    })
    if (!factureRecue) return NextResponse.json({ error: "Facture reçue introuvable" }, { status: 404 })
    if (factureRecue.immobilisation) {
      return NextResponse.json({ error: "Cette facture reçue est déjà liée à une immobilisation." }, { status: 409 })
    }
    if (factureRecue.status === "ANNULEE") {
      return NextResponse.json({ error: "Cette facture reçue est annulée." }, { status: 422 })
    }
    entryValue = Number(factureRecue.amount)
    createData = { factureRecueId: factureRecue.id }
  }

  if (residualValue >= entryValue) {
    return NextResponse.json({ error: "La valeur résiduelle doit être inférieure à la valeur d'entrée." }, { status: 422 })
  }

  const immobilisation = await prisma.immobilisation.create({
    data: {
      associationId,
      label,
      assetAccountCode:        ASSET_ACCOUNT_CODE,
      depreciationAccountCode: DEPRECIATION_ACCOUNT_CODE,
      expenseAccountCode:      EXPENSE_ACCOUNT_CODE,
      // Taken from the Expense/FactureRecue, never user-submitted — see immobilisationSchema.
      entryValue,
      residualValue,
      acquisitionDate:  new Date(acquisitionDate),
      usageStartDate:   new Date(usageStartDate),
      usefulLifeMonths,
      ...createData,
    },
  })

  // Only the factureRecueId path needs an acquisition entry posted here — the expenseId path's
  // acquisition is already covered by the existing generic Expense journal posting (Fase 1/2).
  if (factureRecueId) {
    await postImmobilisationAcquisition(immobilisation.id)
  }

  await writeActivityLog({
    associationId, actorId: userId, action: "IMMOBILISATION_CREATED",
    entity: "Immobilisation", entityId: immobilisation.id, label: immobilisation.label,
  })
  return NextResponse.json(immobilisation, { status: 201 })
}, { area: "comptabilite", module: "finances" })
