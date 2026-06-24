import type { Metadata } from "next"
import { MembresView } from "@/components/membres/membres-view"

export const metadata: Metadata = { title: "Membres" }

export default function MembresPage() {
  return <MembresView />
}
