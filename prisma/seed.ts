import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import bcrypt from "bcryptjs"
import * as dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma  = new PrismaClient({ adapter })

// Real inbox — password reset only works by email, and the old super@adhera.fr placeholder
// didn't exist anywhere, so a lost/forgotten super admin password had no recovery path.
const SUPER_ADMIN_EMAIL = "hello@1367studio.com"

// No fallback here: a production seed must never be able to silently fall back to a
// well-known dev default password for the one account with backoffice access to every
// association. Demo account passwords (below) do fall back, since demo data only ever
// exists in dev/staging, gated behind SEED_DEMO_DATA.
function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name} — set it before seeding.`)
  return value
}

async function main() {
  const hashSuper = await bcrypt.hash(requiredEnv("SEED_SUPER_ADMIN_PASSWORD"), 12)

  const superExists = await prisma.user.findFirst({ where: { email: SUPER_ADMIN_EMAIL, associationId: null } })
  if (!superExists) {
    await prisma.user.create({
      data: {
        email:        SUPER_ADMIN_EMAIL,
        name:         "Super Admin",
        passwordHash: hashSuper,
        role:         "SUPER_ADMIN",
        active:       true,
      },
    })
    console.log(`Super admin created: ${SUPER_ADMIN_EMAIL}`)
  } else {
    console.log(`Super admin already exists: ${SUPER_ADMIN_EMAIL}`)
  }

  // Demo association + accounts are dev/staging fixtures — never created unless explicitly
  // requested, so a production seed run only ever provisions the super admin above.
  if (process.env.SEED_DEMO_DATA !== "true") {
    console.log('SEED_DEMO_DATA is not "true" — skipping demo association/users.')
    return
  }

  const [hashAdmin, hashMembre] = await Promise.all([
    bcrypt.hash(process.env.SEED_ADMIN_PASSWORD  ?? "admin123",  12),
    bcrypt.hash(process.env.SEED_MEMBRE_PASSWORD ?? "membre123", 12),
  ])

  const association = await prisma.association.upsert({
    where:  { slug: "demo" },
    update: {},
    create: {
      name:    "Association Démo",
      slug:    "demo",
      city:    "Paris",
      country: "France",
    },
  })

  await prisma.user.upsert({
    where:  { email_associationId: { email: "admin@demo.fr", associationId: association.id } },
    update: {},
    create: {
      email:         "admin@demo.fr",
      name:          "Admin Demo",
      passwordHash:  hashAdmin,
      role:          "ADMIN",
      active:        true,
      associationId: association.id,
    },
  })

  // MEMBRE user — for testing the portal
  const membreUser = await prisma.user.upsert({
    where:  { email_associationId: { email: "membre@demo.fr", associationId: association.id } },
    update: {},
    create: {
      email:         "membre@demo.fr",
      name:          "Marie Dupont",
      passwordHash:  hashMembre,
      role:          "MEMBRE",
      active:        true,
      associationId: association.id,
    },
  })

  const [typeAdulte, typeJunior, typeHonoraire] = await Promise.all([
    prisma.membreType.upsert({
      where:  { name_associationId: { name: "Adulte", associationId: association.id } },
      update: {},
      create: { name: "Adulte", color: "blue", associationId: association.id },
    }),
    prisma.membreType.upsert({
      where:  { name_associationId: { name: "Junior", associationId: association.id } },
      update: {},
      create: { name: "Junior", color: "green", associationId: association.id },
    }),
    prisma.membreType.upsert({
      where:  { name_associationId: { name: "Honoraire", associationId: association.id } },
      update: {},
      create: { name: "Honoraire", color: "yellow", associationId: association.id },
    }),
  ])

  await prisma.membre.upsert({
    where:  { userId: membreUser.id },
    update: {},
    create: {
      firstName:     "Marie",
      lastName:      "Dupont",
      email:         "membre@demo.fr",
      status:        "ACTIF",
      associationId: association.id,
      userId:        membreUser.id,
      typeId:        typeAdulte.id,
    },
  })

  console.log("Demo seed done — association:", association.slug)
  console.log("  admin@demo.fr   (ADMIN)  — password from SEED_ADMIN_PASSWORD or the dev default")
  console.log("  membre@demo.fr  (MEMBRE) — password from SEED_MEMBRE_PASSWORD or the dev default")
}

main()
  .catch(err => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
