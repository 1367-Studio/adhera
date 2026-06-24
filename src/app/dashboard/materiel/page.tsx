import type { Metadata } from "next"
import { MaterielView } from "@/components/materiel/materiel-view"

export const metadata: Metadata = { title: "Matériel" }

export default function MaterielPage() {
  return <MaterielView />
}
