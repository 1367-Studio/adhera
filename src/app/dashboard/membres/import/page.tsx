import type { Metadata } from "next"
import { MembreImportWizard } from "@/components/membres/membre-import-wizard"

export const metadata: Metadata = { title: "Importer des membres" }

export default function MembreImportPage() {
  return <MembreImportWizard />
}
