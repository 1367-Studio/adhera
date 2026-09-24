// Writes DAC Academy's exact « FICHE D'INSCRIPTION 2026 2027 » template (see
// src/lib/paper-form/presets/dac-academy-2026-2027.ts) into one association, in strict mode:
// the extract route then refuses any scanned page that is not this form.
//
// Each commitment checkbox of page 2 is mapped to the association's live legal document
// whose title matches it (case and accents ignored, e.g. "Règlement intérieur"). Only
// documents that require acceptance are used — the import records nothing for the others —
// and an ambiguous match (several documents) is left unmapped. An unmapped commitment is
// still read, as "Oui"/"Non" in the member's notes.
//
// The template is matched by (association, name): updated when it exists, created otherwise.
//
// Usage:
//   npx tsx scripts/seed-paper-form-dac-academy.ts <association-slug> --dry-run  (prints the mapping, writes nothing)
//   npx tsx scripts/seed-paper-form-dac-academy.ts <association-slug>            (writes the template)
import * as dotenv from "dotenv"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { paperFormTemplateSchema } from "../src/lib/schemas/paper-form"
import {
  DAC_ACADEMY_ENGAGEMENTS,
  DAC_ACADEMY_TEMPLATE_NAME,
  buildDacAcademyTemplate,
  type DacAcademyEngagementKey,
} from "../src/lib/paper-form/presets/dac-academy-2026-2027"

dotenv.config({ path: ".env.local" })

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma  = new PrismaClient({ adapter })

const DRY_RUN          = process.argv.includes("--dry-run")
const associationSlug  = process.argv.slice(2).find((argument) => !argument.startsWith("--"))

// "Règlement  Intérieur" → "reglement interieur": no accents, no case, punctuation as spaces.
function normalizeTitle(title: string): string {
  return title
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

async function main() {
  if (!associationSlug) {
    console.error("Usage: npx tsx scripts/seed-paper-form-dac-academy.ts <association-slug> [--dry-run]")
    process.exit(1)
  }

  const association = await prisma.association.findUnique({
    where:  { slug: associationSlug },
    select: { id: true, name: true, deletedAt: true },
  })
  if (!association || association.deletedAt) {
    console.error(`No live association with slug "${associationSlug}".`)
    process.exit(1)
  }
  console.log(`Association: ${association.name} (${association.id})\n`)

  const documents = await prisma.associationDocument.findMany({
    where:   { associationId: association.id, deletedAt: null },
    select:  { id: true, title: true, requiresAcceptance: true },
    orderBy: { title: "asc" },
  })

  const legalDocumentIds: Partial<Record<DacAcademyEngagementKey, string>> = {}
  console.log("Commitment checkboxes:")
  for (const engagement of DAC_ACADEMY_ENGAGEMENTS) {
    const matchingDocuments = documents.filter((document) => {
      const normalizedTitle = normalizeTitle(document.title)
      return engagement.titleKeywords.some((keyword) => normalizedTitle.includes(keyword))
    })
    const acceptableDocuments = matchingDocuments.filter((document) => document.requiresAcceptance)

    if (acceptableDocuments.length === 1) {
      const [mappedDocument] = acceptableDocuments
      legalDocumentIds[engagement.key] = mappedDocument.id
      console.log(`  ${engagement.label} → legal document "${mappedDocument.title}" (${mappedDocument.id})`)
      continue
    }

    const reason = acceptableDocuments.length > 1
      ? `ambiguous: ${acceptableDocuments.map((document) => `"${document.title}"`).join(", ")}`
      : matchingDocuments.length > 0
        ? `"${matchingDocuments[0].title}" does not require acceptance`
        : "no matching document"
    console.log(`  ${engagement.label} → notes (Oui/Non) — ${reason}`)
  }

  // Same validation as POST /api/membres/paper-forms: the preset must pass it as-is.
  const parsed = paperFormTemplateSchema.safeParse(buildDacAcademyTemplate(legalDocumentIds))
  if (!parsed.success) {
    console.error("\nPreset rejected by paperFormTemplateSchema:")
    for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`)
    process.exit(1)
  }
  const { name, pagesPerForm, fields, identificationText } = parsed.data

  console.log(`\nTemplate "${name}": ${pagesPerForm} pages, ${fields.length} fields, strict identification:`)
  console.log(`  ${identificationText}`)

  const existingTemplate = await prisma.paperFormTemplate.findFirst({
    where:  { associationId: association.id, name: DAC_ACADEMY_TEMPLATE_NAME, deletedAt: null },
    select: { id: true },
  })

  if (DRY_RUN) {
    console.log(`\nDry run only — would ${existingTemplate ? `update template ${existingTemplate.id}` : "create the template"}. Nothing written.`)
    return
  }

  if (existingTemplate) {
    await prisma.paperFormTemplate.update({
      where: { id: existingTemplate.id },
      data:  { pagesPerForm, fields, identificationText },
    })
    console.log(`\nUpdated template ${existingTemplate.id}.`)
  } else {
    const createdTemplate = await prisma.paperFormTemplate.create({
      data:   { associationId: association.id, name, pagesPerForm, fields, identificationText },
      select: { id: true },
    })
    console.log(`\nCreated template ${createdTemplate.id}.`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
