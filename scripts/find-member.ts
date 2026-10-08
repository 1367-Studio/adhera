// One-off lookup: find a Membre by first/last name and show how/when they were created,
// which association they belong to, and whether they have a linked User (portal) account.
//
// Usage (reads DATABASE_URL from .env.local, same as the app — uncomment the DB block
// you want to search, e.g. Prod, before running):
//   npx tsx scripts/find-member.ts "Ocean Rabevolo"
import * as dotenv from "dotenv"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

dotenv.config({ path: ".env.local" })

const query = process.argv[2]
if (!query) {
  console.error('Usage: npx tsx scripts/find-member.ts "<name>"')
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const terms = query.split(/\s+/).filter(Boolean)

  const membres = await prisma.membre.findMany({
    where: {
      OR: terms.flatMap((term) => [
        { firstName: { contains: term, mode: "insensitive" as const } },
        { lastName: { contains: term, mode: "insensitive" as const } },
      ]),
    },
    include: {
      association: true,
      user: true,
      cotisations: { orderBy: { createdAt: "desc" } },
      controlAlert: true,
    },
  })

  console.log(JSON.stringify(membres, null, 2))
}

main().finally(() => prisma.$disconnect())
