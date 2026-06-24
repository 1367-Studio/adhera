import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import bcrypt from "bcryptjs"
import * as dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma  = new PrismaClient({ adapter })

async function main() {
  const [hashAdmin, hashMembre, hashSuper] = await Promise.all([
    bcrypt.hash("admin123", 12),
    bcrypt.hash("membre123", 12),
    bcrypt.hash("super123", 12),
  ])

  const superExists = await prisma.user.findFirst({ where: { email: "super@adhera.fr", associationId: null } })
  if (!superExists) {
    await prisma.user.create({
      data: {
        email:        "super@adhera.fr",
        name:         "Super Admin",
        passwordHash: hashSuper,
        role:         "SUPER_ADMIN",
        active:       true,
      },
    })
  }

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

  console.log("Seed done — association:", association.slug)
  console.log("  super@adhera.fr / super123  (SUPER_ADMIN → backoffice)")
  console.log("  admin@demo.fr   / admin123  (ADMIN)")
  console.log("  membre@demo.fr  / membre123 (MEMBRE → portal)")
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
