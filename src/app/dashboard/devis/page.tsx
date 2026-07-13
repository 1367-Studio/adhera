import type { Metadata } from "next"
import { DevisView } from "@/components/devis/devis-view"

export const metadata: Metadata = { title: "Devis" }

export default function DevisPage() {
  return <DevisView />
}
