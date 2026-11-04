import type { Metadata } from "next"
import { APP_NAME } from "@/config/brand"
import { BackofficeMembreDuplicatesView } from "@/components/backoffice/backoffice-membre-duplicates-view"

export const metadata: Metadata = {
  title: `Doublons de membres — Backoffice ${APP_NAME}`,
}

export default function BackofficeMembreDuplicatesPage() {
  return <BackofficeMembreDuplicatesView />
}
