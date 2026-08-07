import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { FacturesView } from "@/components/factures/factures-view"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("factures.view")
  return { title: t("title") }
}

export default function FacturesPage() {
  return <FacturesView />
}
