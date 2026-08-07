import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { EvenementsView } from "@/components/evenements/evenements-view"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("evenements.view")
  return { title: t("title") }
}

export default function EvenementsPage() {
  return <EvenementsView />
}
