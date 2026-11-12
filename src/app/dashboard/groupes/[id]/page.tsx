import type { Metadata } from "next"
import { GrupoDetailView } from "@/components/grupos/grupo-detail-view"

export const metadata: Metadata = { title: "Groupe" }

export default async function GroupeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <GrupoDetailView grupoId={id} />
}
