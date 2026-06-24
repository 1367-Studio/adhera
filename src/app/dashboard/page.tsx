import type { Metadata } from "next"
import { TableauDeBord } from "@/components/dashboard/tableau-de-bord"

export const metadata: Metadata = { title: "Tableau de bord" }

export default function DashboardPage() {
  return <TableauDeBord />
}
