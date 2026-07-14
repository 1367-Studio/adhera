import type { Metadata } from "next"
import { MembreDetailView } from "@/components/membres/membre-detail-view"

export const metadata: Metadata = { title: "Membre" }

export default function MembreDetailPage() {
  return <MembreDetailView />
}
