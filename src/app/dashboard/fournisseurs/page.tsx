import type { Metadata } from "next"
import { FournisseursView } from "@/components/fournisseurs/fournisseurs-view"

export const metadata: Metadata = { title: "Fournisseurs" }

export default function FournisseursPage() {
  return <FournisseursView />
}
