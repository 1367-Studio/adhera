import type { Metadata } from "next"
import { MembreDuplicatesView } from "@/components/membres/membre-duplicates-view"

export const metadata: Metadata = { title: "Doublons potentiels" }

export default function MembreDuplicatesPage() {
  return <MembreDuplicatesView />
}
