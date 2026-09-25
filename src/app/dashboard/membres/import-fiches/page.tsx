import type { Metadata } from "next"
import { PaperFormScanWizard } from "@/components/membres/paper-form-scan/paper-form-scan-wizard"

export const metadata: Metadata = { title: "Importer des fiches papier" }

export default function PaperFormScanPage() {
  return <PaperFormScanWizard />
}
