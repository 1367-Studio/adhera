import type { Metadata } from "next"
import { ChamadaView } from "@/components/grupos/chamada-view"

export const metadata: Metadata = { title: "Appel" }

export default async function ChamadaPage({ params }: { params: Promise<{ id: string; chamadaId: string }> }) {
  const { id, chamadaId } = await params
  return <ChamadaView grupoId={id} chamadaId={chamadaId} />
}
