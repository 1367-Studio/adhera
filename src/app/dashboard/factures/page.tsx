import type { Metadata } from "next"
import { FacturesView } from "@/components/factures/factures-view"

export const metadata: Metadata = { title: "Factures" }

export default function FacturesPage() {
  return <FacturesView />
}
