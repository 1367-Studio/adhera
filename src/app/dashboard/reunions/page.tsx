import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { ReunionsView } from "@/components/reunions/reunions-view"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reunions.view")
  return { title: t("title") }
}

export default function ReunionsPage() {
  return <ReunionsView />
}
