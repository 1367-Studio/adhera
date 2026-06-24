import type { Metadata } from "next"
import { ParametresView } from "@/components/parametres/parametres-view"

export const metadata: Metadata = { title: "Paramètres" }

export default function ParametresPage() {
  return <ParametresView />
}
