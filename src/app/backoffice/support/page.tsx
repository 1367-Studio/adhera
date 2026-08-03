import type { Metadata } from "next"
import { APP_NAME } from "@/config/brand"
import { BackofficeSupportTicketsView } from "@/components/backoffice/support-tickets-view"

export const metadata: Metadata = {
  title: `Support — Backoffice ${APP_NAME}`,
}

export default function BackofficeSupportPage() {
  return <BackofficeSupportTicketsView />
}
