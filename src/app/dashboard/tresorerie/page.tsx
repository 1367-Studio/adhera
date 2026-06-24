import type { Metadata } from "next"
import { TresorerieView } from "@/components/tresorerie/tresorerie-view"

export const metadata: Metadata = { title: "Trésorerie" }

export default function TresoreriePage() {
  return <TresorerieView />
}
