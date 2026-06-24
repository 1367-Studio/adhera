import { defineConfig } from "prisma/config"
import * as dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

export default defineConfig({
  migrations: {
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
  },
})
