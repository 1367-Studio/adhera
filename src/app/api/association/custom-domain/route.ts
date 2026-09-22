import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { addProjectDomain, removeProjectDomain } from "@/lib/vercel-domains"

const ADMINS = ["ADMIN", "PRESIDENT"]

// Accepts a bare hostname only (no scheme, no path) — same shape Vercel's Domains API
// expects for `name`. Lowercased so `WWW.Assoc.fr` and `www.assoc.fr` aren't treated as
// two different domains by the @unique constraint.
const domainSchema = z.object({
  domain: z.string().trim().toLowerCase().min(4).max(255)
    .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/, "Domaine invalide"),
})

export const GET = withAdminAuth(async (req, ctx) => {
  const association = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { customDomain: true, customDomainStatus: true, customDomainVerifiedAt: true, customDomainDnsRecords: true },
  })
  if (!association) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json(association)
}, { roles: ADMINS })

export const POST = withAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = domainSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { domain } = parsed.data

  const taken = await prisma.association.findUnique({ where: { customDomain: domain }, select: { id: true } })
  if (taken && taken.id !== ctx.associationId)
    return NextResponse.json({ error: "Ce domaine est déjà utilisé par une autre association" }, { status: 409 })

  const { ok, data } = await addProjectDomain(domain)
  if (!ok) {
    return NextResponse.json({ error: data.error?.message ?? "Impossible d'ajouter ce domaine" }, { status: 422 })
  }

  await prisma.association.update({
    where: { id: ctx.associationId },
    data: {
      customDomain:           domain,
      customDomainStatus:     "PENDING",
      customDomainVerifiedAt: null,
      customDomainDnsRecords: data.verification ? (data.verification as object) : Prisma.JsonNull,
    },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "ASSOCIATION_UPDATED",
    entity:        "Association",
    label:         `Domaine personnalisé ajouté : ${domain}`,
  })

  return NextResponse.json({ ok: true, domain, dnsRecords: data.verification ?? [] })
}, { roles: ADMINS })

export const DELETE = withAdminAuth(async (req, ctx) => {
  const association = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { customDomain: true },
  })
  if (!association?.customDomain) return NextResponse.json({ error: "Aucun domaine configuré" }, { status: 404 })

  await removeProjectDomain(association.customDomain)

  await prisma.association.update({
    where: { id: ctx.associationId },
    data: {
      customDomain:           null,
      customDomainStatus:     null,
      customDomainVerifiedAt: null,
      customDomainDnsRecords: Prisma.JsonNull,
    },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "ASSOCIATION_UPDATED",
    entity:        "Association",
    label:         `Domaine personnalisé retiré : ${association.customDomain}`,
  })

  return NextResponse.json({ ok: true })
}, { roles: ADMINS })
