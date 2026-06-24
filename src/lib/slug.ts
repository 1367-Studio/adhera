import type { PrismaClient } from "@prisma/client"

export function toSlug(str: string): string {
  return str
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export async function generateUniqueSlug(name: string, prisma: PrismaClient): Promise<string> {
  const base = toSlug(name)
  let slug    = base
  let attempt = 0
  while (true) {
    const existing = await prisma.association.findUnique({ where: { slug } })
    if (!existing) return slug
    slug = `${base}-${++attempt}`
  }
}
