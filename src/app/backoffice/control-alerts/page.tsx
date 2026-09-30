import type { Metadata } from "next"
import { APP_NAME } from "@/config/brand"
import { ControlAlertsView } from "@/components/backoffice/control-alerts-view"

export const metadata: Metadata = {
  title: `Contrôle adhésion — Backoffice ${APP_NAME}`,
}

export default function BackofficeControlAlertsPage() {
  return <ControlAlertsView />
}
