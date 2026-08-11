import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { SupportPageTabs } from "@/components/support/support-page-tabs"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("support")
  return { title: t("title") }
}

export default function SupportTicketsPage() {
  return <SupportPageTabs />
}
