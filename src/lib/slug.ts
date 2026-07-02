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
  "api", "backoffice", "check-in", "dashboard", "login", "register",
  "forgot-password", "reset-password", "portal", "admin", "www", "app",
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
