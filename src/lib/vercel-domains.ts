import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"

const VERCEL_API_BASE = "https://api.vercel.com"

function vercelHeaders() {
  return { Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`, "Content-Type": "application/json" }
}

function withTeam(path: string) {
  const teamId = process.env.VERCEL_TEAM_ID
  return teamId ? `${path}${path.includes("?") ? "&" : "?"}teamId=${teamId}` : path
}

export type DnsRecord = { type: string; domain: string; value: string }

// The DNS instruction the admin needs to see is NOT the same thing as Vercel's own
// `verification` field on a domain (that's only populated for the rare ownership-conflict
// case — a TXT record proving you own a domain someone else already claimed). The routine
// "point this at Vercel" record is a fixed, well-known value that never changes per domain,
// so it's computed here rather than fetched — a bare apex domain (2 labels) needs an A
// record, anything else (a subdomain like www.assoc.fr) needs a CNAME. This doesn't handle
// multi-part public suffixes (assoc.co.uk would misdetect as a 3-label subdomain) — a
// tradeoff accepted for now since the audience is French associations, almost all on plain
// .fr/.org/.com domains.
export function standardDnsRecord(domain: string): DnsRecord {
  const labels = domain.split(".")
  return labels.length <= 2
    ? { type: "A", domain: "@", value: "76.76.21.21" }
    : { type: "CNAME", domain: labels[0], value: "cname.vercel-dns.com" }
}

async function vercelRequest<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  const res  = await fetch(`${VERCEL_API_BASE}${withTeam(path)}`, { ...init, headers: vercelHeaders() })
  const data = (await res.json().catch(() => ({}))) as T
  return { ok: res.ok, status: res.status, data }
}

// Registers the domain on the adhera Vercel project. The response's `verification` array
// (present when the domain isn't already pointed correctly) is what gets cached in
// customDomainDnsRecords and shown to the admin — see checkAndUpdateCustomDomainStatus below
// for the normal "domain not verified yet" path, which comes back from the /config endpoint
// instead, not this one.
export async function addProjectDomain(domain: string) {
  const projectId = process.env.VERCEL_PROJECT_ID
  return vercelRequest<{
    name?: string
    error?: { code: string; message: string }
    verification?: { type: string; domain: string; value: string; reason: string }[]
  }>(`/v10/projects/${projectId}/domains`, { method: "POST", body: JSON.stringify({ name: domain }) })
}

export async function removeProjectDomain(domain: string) {
  const projectId = process.env.VERCEL_PROJECT_ID
  return vercelRequest(`/v9/projects/${projectId}/domains/${domain}`, { method: "DELETE" })
}

export async function getDomainConfig(domain: string) {
  return vercelRequest<{ misconfigured: boolean }>(`/v6/domains/${domain}/config`)
}

export async function getProjectDomain(domain: string) {
  const projectId = process.env.VERCEL_PROJECT_ID
  return vercelRequest<{
    verified: boolean
    verification?: { type: string; domain: string; value: string; reason: string }[]
  }>(`/v9/projects/${projectId}/domains/${domain}`)
}

// Shared between the admin-triggered "Verificar agora" endpoint and the 15-minute cron sweep
// so status logic (what counts as VERIFIED vs FAILED, what gets cached for the DNS
// instructions screen) never drifts between the two call sites.
export async function checkAndUpdateCustomDomainStatus(associationId: string) {
  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { customDomain: true },
  })
  if (!association?.customDomain) return null

  const [{ ok: getOk, data: projectDomain }, { data: config }] = await Promise.all([
    getProjectDomain(association.customDomain),
    getDomainConfig(association.customDomain),
  ])

  if (!getOk) {
    await prisma.association.update({
      where: { id: associationId },
      data:  { customDomainStatus: "FAILED", customDomainDnsRecords: projectDomain as object },
    })
    return "FAILED" as const
  }

  const isVerified = projectDomain.verified && !config.misconfigured
  const records: DnsRecord[] = [standardDnsRecord(association.customDomain), ...(projectDomain.verification ?? [])]
  await prisma.association.update({
    where: { id: associationId },
    data: {
      customDomainStatus:     isVerified ? "VERIFIED" : "PENDING",
      customDomainVerifiedAt: isVerified ? new Date() : null,
      customDomainDnsRecords: records,
    },
  })
  return isVerified ? ("VERIFIED" as const) : ("PENDING" as const)
}
