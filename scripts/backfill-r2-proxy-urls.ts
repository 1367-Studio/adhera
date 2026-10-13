// One-off backfill for H1 (security audit): uploadToR2 (src/lib/r2.ts) used to return the raw
// R2_PUBLIC_URL — a publicly reachable bucket URL with no auth, no expiry, and (for
// AssociationDocument) no way to revoke access once a document is unpublished. It now returns
// an app-domain proxy URL instead. Rows written before that change still carry the old
// R2_PUBLIC_URL-shaped value; this rewrites them to the new shape so the R2 bucket's public
// access can eventually be turned off in the Cloudflare dashboard without breaking them.
//
// Only the stored string changes — the R2 object itself, and its key, are untouched.
//
// Usage:
//   npx tsx scripts/backfill-r2-proxy-urls.ts          (dry run, lists every row that would change)
//   npx tsx scripts/backfill-r2-proxy-urls.ts --apply  (writes the new URLs)
import * as dotenv from "dotenv"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { toProxiedAssetUrl } from "@/lib/r2"

dotenv.config({ path: ".env.local" })

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma  = new PrismaClient({ adapter })

const apply = process.argv.includes("--apply")

type Row = { table: string; id: string; label: string; oldUrl: string; newUrl: string }

async function collectRows(): Promise<Row[]> {
  const rows: Row[] = []

  const membres = await prisma.membre.findMany({
    where:  { photoUrl: { not: null } },
    select: { id: true, firstName: true, lastName: true, photoUrl: true },
  })
  for (const membre of membres) {
    const oldUrl = membre.photoUrl!
    const newUrl = toProxiedAssetUrl(oldUrl)
    if (newUrl !== oldUrl) {
      rows.push({ table: "Membre.photoUrl", id: membre.id, label: `${membre.firstName} ${membre.lastName}`, oldUrl, newUrl })
    }
  }

  const documents = await prisma.associationDocument.findMany({
    where:  { fileUrl: { not: null } },
    select: { id: true, title: true, fileUrl: true },
  })
  for (const document of documents) {
    const oldUrl = document.fileUrl!
    const newUrl = toProxiedAssetUrl(oldUrl)
    if (newUrl !== oldUrl) {
      rows.push({ table: "AssociationDocument.fileUrl", id: document.id, label: document.title, oldUrl, newUrl })
    }
  }

  const revisions = await prisma.associationDocumentRevision.findMany({
    where:  { fileUrl: { not: null } },
    select: { id: true, documentId: true, fileUrl: true },
  })
  for (const revision of revisions) {
    const oldUrl = revision.fileUrl!
    const newUrl = toProxiedAssetUrl(oldUrl)
    if (newUrl !== oldUrl) {
      rows.push({ table: "AssociationDocumentRevision.fileUrl", id: revision.id, label: `document ${revision.documentId}`, oldUrl, newUrl })
    }
  }

  return rows
}

async function main() {
  const rows = await collectRows()

  console.log(`${rows.length} row(s) still on the legacy direct R2_PUBLIC_URL shape.\n`)
  for (const row of rows) {
    console.log(`  [${row.table}] ${row.id} (${row.label})`)
    console.log(`    ${row.oldUrl}`)
    console.log(`    -> ${row.newUrl}`)
  }

  if (!apply) {
    console.log("\nDry run — pass --apply to write.")
    return
  }

  for (const row of rows) {
    if (row.table === "Membre.photoUrl") {
      await prisma.membre.update({ where: { id: row.id }, data: { photoUrl: row.newUrl } })
    } else if (row.table === "AssociationDocument.fileUrl") {
      await prisma.associationDocument.update({ where: { id: row.id }, data: { fileUrl: row.newUrl } })
    } else {
      await prisma.associationDocumentRevision.update({ where: { id: row.id }, data: { fileUrl: row.newUrl } })
    }
  }
  console.log(`\nApplied — ${rows.length} row(s) updated.`)
}

main().finally(() => prisma.$disconnect())
