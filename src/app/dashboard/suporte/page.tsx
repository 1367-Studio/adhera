import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { SupportTicketsView } from "@/components/support/support-tickets-view"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("support")
  return { title: t("title") }
}

export default function SupportTicketsPage() {
  return <SupportTicketsView />
}
