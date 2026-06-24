import type { Metadata } from "next"
import { CotisationsView } from "@/components/cotisations/cotisations-view"

export const metadata: Metadata = { title: "Cotisations" }

export default function CotisationsPage() {
  return <CotisationsView />
}
