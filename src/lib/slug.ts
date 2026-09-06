import type { PrismaClient } from "@prisma/client"

export function toSlug(str: string): string {
  return str
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// Top-level static routes (src/app/**) that would shadow `/[slug]`, `/portal/[slug]`
// and `/api/public/[slug]` if an association ever got one of these as its slug — Next.js
// resolves the static segment first, making the tenant's site/portal permanently
// unreachable with no error shown at signup. A few common conventions are blocked too.
const RESERVED_SLUGS = new Set([
  "api", "backoffice", "billet", "check-in", "dashboard", "login", "register",
  "forgot-password", "reset-password", "portal", "admin", "www", "app",
  // /dons/annulation/[token] is a static top-level route (self-service cancellation
  // for recurring donations) — an association slugged "dons" would make it unreachable.
  "dons",
])

export async function generateUniqueSlug(name: string, prisma: PrismaClient): Promise<string> {
  const base = toSlug(name)
  let slug    = base
  let attempt = 0
  while (true) {
    const taken = RESERVED_SLUGS.has(slug) || !!(await prisma.association.findUnique({ where: { slug } }))
    if (!taken) return slug
    slug = `${base}-${++attempt}`
  }
}

// Scoped to the association, like MembershipForm/DonationForm slugs (generateFormSlug in their
// routes): two associations may both have a "soiree-de-gala", one association may not. Falls
// back to "evenement" for a title with no latin letters or digits at all.
export async function generateEvenementSlug(
  associationId: string,
  title: string,
  db: Pick<PrismaClient, "evenement">,
): Promise<string> {
  const base = toSlug(title) || "evenement"
  let slug    = base
  let attempt = 0
  while (await db.evenement.findFirst({ where: { associationId, slug }, select: { id: true } })) {
    slug = `${base}-${++attempt}`
  }
  return slug
}

// The public event routes accept either the readable slug or the historical cuid in the same
// URL segment: cuid links are already in the wild (emails, printed QR codes, Stripe return
// URLs) and must keep resolving. The two cannot collide in practice — a cuid is 25 chars of
// [a-z0-9] starting with "c", a slug is derived from a title — and every caller scopes the
// lookup to the association anyway.
export function evenementRefWhere(ref: string) {
  return { OR: [{ slug: ref }, { id: ref }] }
}
