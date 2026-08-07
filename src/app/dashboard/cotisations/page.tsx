import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { CotisationsView } from "@/components/cotisations/cotisations-view"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("cotisations.view")
  return { title: t("title") }
}

export default function CotisationsPage() {
  return <CotisationsView />
}
