import type { Metadata } from "next"
import { FournisseurDetailView } from "@/components/fournisseurs/fournisseur-detail-view"

export const metadata: Metadata = { title: "Fournisseur" }

export default function FournisseurDetailPage() {
  return <FournisseurDetailView />
}
