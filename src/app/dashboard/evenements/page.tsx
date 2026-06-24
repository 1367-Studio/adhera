import type { Metadata } from "next"
import { EvenementsView } from "@/components/evenements/evenements-view"

export const metadata: Metadata = { title: "Événements" }

export default function EvenementsPage() {
  return <EvenementsView />
}
